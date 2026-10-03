import crypto from 'node:crypto';
import sharp from 'sharp';
import { StudioError, notFound } from './errors.js';
import { S } from './states.js';
import { loadPrompt, fill } from './prompts.js';
import { assertStoryId, cleanText } from './safety.js';
import { paragraphs } from './text.js';

const MAX_CANDIDATES_KEPT = 6;
const MAX_WIDTH = 1600;
const MAX_BYTES = 600 * 1024;
export const CANDIDATE_FILE_RE = /^scene-\d{2}-c[a-f0-9]{6}\.webp$/;

export const candidateFile = (sceneId, candId) => `${sceneId}-${candId}.webp`;

export async function toWebp(buf) {
  let quality = 82;
  const base = sharp(buf).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true });
  let out = await base.clone().webp({ quality }).toBuffer();
  while (out.length > MAX_BYTES && quality > 40) {
    quality -= 12;
    out = await base.clone().webp({ quality }).toBuffer();
  }
  const meta = await sharp(out).metadata();
  return { buffer: out, width: meta.width, height: meta.height };
}

export function buildImagePrompt(scene, characters) {
  const tpl = loadPrompt('image-style.v1');
  const wanted = new Set((scene.characters ?? []).map((n) => n.toLowerCase()));
  const relevant = characters.filter((c) => !wanted.size || wanted.has(c.name.toLowerCase()));
  const list = (relevant.length ? relevant : characters).map((c) => `- ${c.name}: ${c.description}`).join('\n');
  return { version: tpl.version, prompt: fill(tpl.template, { scene: scene.imagePrompt || scene.description, characters: list || '- (no named characters)' }) };
}

// Any change to pictures means Tashini should look at the story again before publishing.
function resetApproval(s) {
  if (s.status === S.READY_TO_PUBLISH || s.status === S.PUBLISHED) s.status = S.REVIEWING;
  s.approvedAt = null;
}

export class ImageService {
  constructor({ stories, store, imageGen, jobs, log, config }) {
    Object.assign(this, { stories, store, imageGen, jobs, log, config });
  }

  async checkDailyLimit(n) {
    const today = new Date().toISOString().slice(0, 10);
    return this.store.update('usage.json', (u) => {
      const usage = u?.date === today ? u : { date: today, images: 0 };
      if (usage.images + n > this.config.images.dailyLimit) {
        throw new StudioError('rate_limited', `Daily image limit (${this.config.images.dailyLimit}) reached`, {
          status: 429,
          friendly: "We've made lots of pictures today! Let's make more tomorrow.",
        });
      }
      usage.images += n;
      return usage;
    });
  }

  // Start generating pictures. By default only scenes without pictures (or
  // that failed) are drawn; pass sceneIds to redraw specific scenes.
  async start(id, { sceneIds } = {}) {
    const story = await this.stories.get(id);
    if (!story.scenes.length) {
      throw new StudioError('invalid_state', 'No scenes yet — finish the story review first', {
        status: 409,
        friendly: 'We need to check your story first, then we can make pictures.',
      });
    }
    const targets = story.scenes
      .filter((sc) => (sceneIds?.length ? sceneIds.includes(sc.id) : !sc.candidates.length || sc.status === 'failed'))
      .map((sc) => sc.id);
    if (!targets.length) return { story, job: Promise.resolve({ generated: 0 }) };
    const updated = await this.stories.mutate(id, (s) => {
      if (s.status === S.PUBLISHING) throw new StudioError('invalid_state', 'Story is publishing', { status: 409 });
      if (s.status === S.IMAGE_GENERATION_FAILED) s.status = S.REVIEWING;
      for (const sc of s.scenes) if (targets.includes(sc.id)) Object.assign(sc, { status: 'queued', error: null });
    });
    const job = this.jobs.run(`images:${id}`, () => this.run(id));
    return { story: updated, job };
  }

  async run(id) {
    let generated = 0;
    let failed = 0;
    // Keep drawing while scenes are queued (new requests can queue more while we run).
    for (;;) {
      const story = await this.stories.get(id);
      const scene = story.scenes.find((sc) => sc.status === 'queued');
      if (!scene) break;
      await this.stories.mutate(id, (s) => {
        const sc = s.scenes.find((x) => x.id === scene.id);
        if (sc) sc.status = 'generating';
      });
      try {
        const n = this.config.images.candidatesPerScene;
        await this.checkDailyLimit(n);
        const { prompt, version } = buildImagePrompt(scene, story.characters);
        const buffers = await this.imageGen.generate({ prompt, n });
        const made = [];
        for (const buf of buffers) {
          const candId = `c${crypto.randomBytes(3).toString('hex')}`;
          const { buffer, width, height } = await toWebp(buf);
          await this.store.writeBuffer(`images/${assertStoryId(id)}/${candidateFile(scene.id, candId)}`, buffer);
          made.push({ id: candId, width, height, createdAt: new Date().toISOString(), promptVersion: version });
        }
        generated += made.length;
        const dropped = [];
        await this.stories.mutate(id, (s) => {
          const sc = s.scenes.find((x) => x.id === scene.id);
          if (!sc) return;
          sc.candidates = [...made, ...sc.candidates];
          while (sc.candidates.length > MAX_CANDIDATES_KEPT) {
            const idx = sc.candidates.findLastIndex((c) => c.id !== sc.selected);
            dropped.push(...sc.candidates.splice(idx, 1));
          }
          if (!sc.selected || !sc.candidates.some((c) => c.id === sc.selected)) sc.selected = made[0]?.id ?? null;
          sc.status = 'ready';
          sc.error = null;
          resetApproval(s);
        });
        for (const c of dropped) await this.store.remove(`images/${id}/${candidateFile(scene.id, c.id)}`);
        this.log.info('images.scene_done', { id, scene: scene.id, count: made.length });
      } catch (err) {
        failed += 1;
        this.log.error('images.scene_failed', { id, scene: scene.id, err });
        await this.stories.mutate(id, (s) => {
          const sc = s.scenes.find((x) => x.id === scene.id);
          if (sc) Object.assign(sc, { status: 'failed', error: err.friendly ?? "We couldn't make this picture." });
          s.lastError = { code: 'images_failed', message: err.message, at: new Date().toISOString() };
          // A limit stop applies to every remaining scene.
          if (err.code === 'rate_limited') {
            for (const x of s.scenes) if (x.status === 'queued') Object.assign(x, { status: 'failed', error: err.friendly });
          }
        });
      }
    }
    await this.stories.mutate(id, (s) => {
      const anyFailed = s.scenes.some((sc) => sc.status === 'failed');
      if (anyFailed && s.status === S.REVIEWING) s.status = S.IMAGE_GENERATION_FAILED;
      if (!anyFailed && s.status === S.IMAGE_GENERATION_FAILED) s.status = S.REVIEWING;
    });
    return { generated, failed };
  }

  async select(id, sceneId, candidateId) {
    return this.stories.mutate(id, (s) => {
      const sc = s.scenes.find((x) => x.id === sceneId);
      if (!sc) throw notFound('Scene');
      if (candidateId !== null && !sc.candidates.some((c) => c.id === candidateId)) throw notFound('Picture');
      sc.selected = candidateId;
      resetApproval(s);
    });
  }

  async updateScene(id, sceneId, { description, beforeParagraph, imagePrompt, title }) {
    return this.stories.mutate(id, (s) => {
      const sc = s.scenes.find((x) => x.id === sceneId);
      if (!sc) throw notFound('Scene');
      if (description !== undefined) {
        sc.description = cleanText(description).slice(0, 500);
        // A child-edited description becomes the drawing instruction.
        if (imagePrompt === undefined) sc.imagePrompt = sc.description;
      }
      if (imagePrompt !== undefined) sc.imagePrompt = cleanText(imagePrompt).slice(0, 1200);
      if (title !== undefined) sc.title = cleanText(title).slice(0, 80);
      if (beforeParagraph !== undefined) {
        const last = Math.max(0, paragraphs(s.content).length - 1);
        const n = Number(beforeParagraph);
        if (!Number.isInteger(n)) throw new StudioError('invalid_input', 'beforeParagraph must be an integer');
        sc.beforeParagraph = Math.min(Math.max(0, n), last);
      }
      s.scenes.sort((a, b) => a.beforeParagraph - b.beforeParagraph);
      resetApproval(s);
    });
  }

  async addScene(id, { description, beforeParagraph = 0, title }) {
    if (!description?.trim()) throw new StudioError('invalid_input', 'description required', { friendly: 'Tell us what the picture should show.' });
    return this.stories.mutate(id, (s) => {
      if (s.scenes.length >= this.config.images.maxScenes) {
        throw new StudioError('invalid_state', 'Too many scenes', { status: 409, friendly: `A story can have up to ${this.config.images.maxScenes} pictures.` });
      }
      const used = new Set(s.scenes.map((x) => x.id));
      let n = 1;
      while (used.has(`scene-${String(n).padStart(2, '0')}`)) n += 1;
      const last = Math.max(0, paragraphs(s.content).length - 1);
      const desc = cleanText(description).slice(0, 500);
      s.scenes.push({
        id: `scene-${String(n).padStart(2, '0')}`,
        number: n,
        title: cleanText(title ?? `Picture ${n}`).slice(0, 80),
        description: desc,
        imagePrompt: desc,
        characters: [],
        beforeParagraph: Math.min(Math.max(0, Number(beforeParagraph) || 0), last),
        status: 'idle',
        candidates: [],
        selected: null,
        error: null,
      });
      s.scenes.sort((a, b) => a.beforeParagraph - b.beforeParagraph);
      resetApproval(s);
    });
  }

  async removeScene(id, sceneId) {
    let removed;
    const story = await this.stories.mutate(id, (s) => {
      const idx = s.scenes.findIndex((x) => x.id === sceneId);
      if (idx === -1) throw notFound('Scene');
      [removed] = s.scenes.splice(idx, 1);
      resetApproval(s);
    });
    for (const c of removed.candidates) await this.store.remove(`images/${id}/${candidateFile(sceneId, c.id)}`);
    return story;
  }

  async readCandidate(id, file) {
    assertStoryId(id);
    if (!CANDIDATE_FILE_RE.test(file)) throw notFound('Picture');
    try {
      return await this.store.readBuffer(`images/${id}/${file}`);
    } catch {
      throw notFound('Picture');
    }
  }
}
