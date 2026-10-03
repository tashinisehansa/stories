import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { ROOT } from '../config.js';
import { StudioError, notFound } from './errors.js';
import { S } from './states.js';
import { loadPrompt, fill } from './prompts.js';
import { paragraphs, wordCount } from './text.js';
import { assertStoryId, cleanText } from './safety.js';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateReview = ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/review.schema.json'), 'utf8')));

export function sceneRangeFor(words) {
  if (words < 250) return '2';
  if (words < 600) return '2 to 3';
  if (words < 1200) return '3 to 4';
  return '4 to 5';
}

// Pull the JSON object out of a model reply (tolerates code fences / chatter).
export function extractJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in reply');
  return JSON.parse(t.slice(start, end + 1));
}

export function parseReview(text) {
  let data;
  try {
    data = extractJson(text);
  } catch (err) {
    return { ok: false, errors: [`not valid JSON: ${err.message}`] };
  }
  if (!validateReview(data)) {
    return { ok: false, errors: validateReview.errors.map((e) => `${e.instancePath || '/'} ${e.message}`) };
  }
  return { ok: true, data };
}

// Locate `needle` in `haystack`, tolerating differences in whitespace — including
// stray spaces between Chinese characters, which children often type by accident.
export function findLoose(haystack, needle) {
  const exact = haystack.indexOf(needle);
  if (exact !== -1) return { index: exact, length: needle.length };
  const chars = [...needle.replace(/\s+/g, '')];
  if (!chars.length) return null;
  const pattern = chars.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const m = new RegExp(pattern, 'u').exec(haystack);
  return m ? { index: m.index, length: m[0].length } : null;
}

export class ReviewService {
  constructor({ stories, store, llm, jobs, log, config, onReviewed }) {
    Object.assign(this, { stories, store, llm, jobs, log, config, onReviewed });
  }

  rel(id) {
    return `reviews/${assertStoryId(id)}.json`;
  }

  async get(id) {
    const r = await this.store.read(this.rel(id));
    if (!r) throw notFound('Review');
    // A suggestion is "stale" only while its sentence can't be found in the current text.
    const story = await this.stories.get(id).catch(() => null);
    if (story) {
      for (const g of r.grammarSuggestions) {
        const found = Boolean(findLoose(story.content, g.original));
        if (g.status === 'stale' && found) g.status = 'pending';
        else if (g.status === 'pending' && !found) g.status = 'stale';
      }
    }
    return r;
  }

  // "I'm Finished": snapshot the original, move to REVIEWING and start the AI check.
  async finish(id, { autoImages = true } = {}) {
    const story = await this.stories.get(id);
    if (wordCount(story.content) < 5) {
      throw new StudioError('invalid_state', 'Story too short to review', {
        status: 409,
        friendly: 'Write a little more of your story first!',
      });
    }
    if (this.jobs.isRunning(`review:${id}`)) return { story, job: this.jobs.run(`review:${id}`) };
    await this.stories.writeSnapshot(story, 'My story before checking');
    const updated = await this.stories.mutate(id, (s) => {
      if (s.status === S.PUBLISHING) throw new StudioError('invalid_state', 'Story is publishing', { status: 409 });
      s.status = S.REVIEWING;
      s.approvedAt = null;
      s.review = { ...s.review, status: 'running', startedAt: new Date().toISOString(), originalRevision: s.revision, error: null };
      s.lastSnapshotAt = new Date().toISOString();
      s.lastError = null;
      s.updatedAt = new Date().toISOString();
    });
    const job = this.jobs.run(`review:${id}`, () => this.runReview(id, { autoImages }));
    return { story: updated, job };
  }

  async runReview(id, { autoImages }) {
    const story = await this.stories.get(id);
    const paras = paragraphs(story.content);
    const prompt = loadPrompt('story-review.v2');
    const system = fill(prompt.template, {
      author: story.author || this.config.authorName,
      sceneRange: sceneRangeFor(wordCount(story.content)),
    });
    const user = [
      `Title: ${story.title || '(no title yet)'}`,
      '',
      'Story (paragraphs are numbered from 0):',
      ...paras.map((p, i) => `[${i}] ${p}`),
    ].join('\n');
    const context = { title: story.title, paragraphs: paras, author: story.author };
    // Reply holds the corrected story plus feedback, so size the budget to the story.
    // (wordCount counts each Chinese character, so CJK stories get a matching budget.)
    const maxTokens = Math.min(12_000, 2500 + wordCount(story.content) * 4);

    try {
      let reply = await this.llm.complete({ system, user, context, maxTokens });
      let parsed = parseReview(reply.text);
      if (!parsed.ok) {
        const truncated = reply.finishReason === 'length';
        this.log.warn('review.invalid_output', { id, truncated, maxTokens, errors: parsed.errors.slice(0, 8) });
        reply = await this.llm.complete({
          system,
          // A cut-off reply needs more room, not a second identical attempt.
          maxTokens: truncated ? Math.min(maxTokens * 2, 16_000) : maxTokens,
          user: `${user}\n\nYour previous reply was not valid. Problems: ${parsed.errors.slice(0, 8).join('; ')}.\nReturn ONLY the JSON object described in the instructions.`,
          context,
        });
        parsed = parseReview(reply.text);
      }
      if (!parsed.ok) {
        throw new StudioError('review_failed', `AI review failed validation: ${parsed.errors.slice(0, 5).join('; ')}`, { status: 502 });
      }
      const review = this.normalize(parsed.data, story, paras);
      const record = {
        storyId: id,
        reviewVersion: prompt.version,
        model: reply.model ?? this.llm.model,
        provider: this.llm.name,
        generatedAt: new Date().toISOString(),
        reviewedRevision: story.revision,
        ...review,
      };
      await this.store.write(this.rel(id), record);

      const updated = await this.stories.mutate(id, (s) => {
        s.review = {
          ...s.review,
          status: 'done',
          reviewVersion: record.reviewVersion,
          model: record.model,
          generatedAt: record.generatedAt,
          pendingSuggestions: record.grammarSuggestions.filter((g) => g.status === 'pending').length,
          error: null,
        };
        s.characters = review.characters;
        const hasPictures = s.scenes.some((sc) => sc.candidates?.length);
        if (!hasPictures) s.scenes = review.scenes;
        else s.suggestedScenes = review.scenes;
        if (!s.title.trim() && review.suggestedTitle) s.title = cleanText(review.suggestedTitle);
        if (!s.description && review.suggestedDescription) s.description = cleanText(review.suggestedDescription);
        if (s.status === S.REVIEW_FAILED) s.status = S.REVIEWING;
        s.updatedAt = new Date().toISOString();
      });
      this.log.info('review.done', { id, model: record.model, suggestions: record.grammarSuggestions.length, scenes: review.scenes.length });
      if (autoImages) await this.onReviewed?.(updated);
      return record;
    } catch (err) {
      this.log.error('review.failed', { id, err });
      await this.stories.mutate(id, (s) => {
        s.review = { ...s.review, status: 'failed', error: err.message };
        if (s.status === S.REVIEWING) s.status = S.REVIEW_FAILED;
        s.lastError = { code: 'review_failed', message: err.message, at: new Date().toISOString() };
      });
      throw err instanceof StudioError ? err : new StudioError('review_failed', err.message, { status: 502 });
    }
  }

  normalize(data, story, paras) {
    const last = Math.max(0, paras.length - 1);
    const grammarSuggestions = data.grammarSuggestions
      .filter((g) => g.original.trim() !== g.suggestion.trim())
      .map((g) => ({
        id: `g${crypto.randomBytes(3).toString('hex')}`,
        type: g.type,
        original: cleanText(g.original),
        suggestion: cleanText(g.suggestion),
        explanation: cleanText(g.explanation),
        status: findLoose(story.content, g.original) ? 'pending' : 'stale',
      }));
    const seen = new Set();
    const scenes = data.scenes
      .slice(0, this.config.images.maxScenes)
      .map((sc) => ({ ...sc, beforeParagraph: Math.min(Math.max(0, sc.beforeParagraph), last) }))
      .sort((a, b) => a.beforeParagraph - b.beforeParagraph)
      .filter((sc) => (seen.has(sc.beforeParagraph) ? false : seen.add(sc.beforeParagraph)))
      .map((sc, i) => ({
        id: `scene-${String(i + 1).padStart(2, '0')}`,
        number: i + 1,
        title: cleanText(sc.title ?? `Picture ${i + 1}`),
        description: cleanText(sc.description),
        imagePrompt: cleanText(sc.imagePrompt),
        characters: sc.characters ?? [],
        beforeParagraph: sc.beforeParagraph,
        status: 'idle',
        candidates: [],
        selected: null,
        error: null,
      }));
    return {
      summary: data.summary,
      suggestedTitle: data.suggestedTitle ?? null,
      suggestedDescription: data.suggestedDescription ?? null,
      correctedStory: data.correctedStory ?? null,
      strengths: data.strengths,
      improvements: data.improvements,
      writingTips: data.writingTips,
      structureFeedback: data.structureFeedback ?? null,
      grammarSuggestions,
      writingIdeas: data.writingIdeas.map((w, i) => ({ id: `w${i + 1}`, ...w })),
      vocabularySuggestions: data.vocabularySuggestions ?? [],
      characters: data.characters.map((c) => ({ name: cleanText(c.name), description: cleanText(c.description) })),
      scenes,
      safetyConcerns: data.safetyConcerns ?? [],
    };
  }

  // Tashini chooses: "Use Suggestion" (accept) or "Keep My Sentence" (keep).
  async decide(id, suggestionId, action) {
    if (!['accept', 'keep', 'undo'].includes(action)) throw new StudioError('invalid_input', `Unknown action ${action}`);
    return this.store.withLock(this.rel(id), async () => {
      const review = await this.get(id);
      const g = review.grammarSuggestions.find((x) => x.id === suggestionId);
      if (!g) throw notFound('Suggestion');
      let applied = false;
      if (action === 'accept' && g.status !== 'accepted') {
        const story = await this.stories.get(id);
        const hit = findLoose(story.content, g.original);
        if (!hit) {
          g.status = 'stale';
        } else {
          const content = story.content.slice(0, hit.index) + g.suggestion + story.content.slice(hit.index + hit.length);
          await this.stories.save(id, { content, baseRevision: story.revision }, { actor: 'review' });
          g.status = 'accepted';
          applied = true;
        }
      } else if (action === 'keep') {
        g.status = 'kept';
      } else if (action === 'undo' && g.status === 'kept') {
        g.status = 'pending';
      }
      await this.store.write(this.rel(id), review);
      await this.stories.mutate(id, (s) => {
        s.review = { ...s.review, pendingSuggestions: review.grammarSuggestions.filter((x) => x.status === 'pending').length };
      });
      return { suggestion: g, applied };
    });
  }

  async acceptAll(id) {
    const review = await this.get(id);
    const results = [];
    for (const g of review.grammarSuggestions.filter((x) => x.status === 'pending')) {
      results.push(await this.decide(id, g.id, 'accept'));
    }
    return results;
  }
}
