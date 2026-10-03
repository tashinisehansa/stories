import crypto from 'node:crypto';
import { StudioError, notFound } from './errors.js';
import { S, assertTransition, STATUS_LABEL } from './states.js';
import { assertStoryId, checkStoryText, cleanText } from './safety.js';
import { wordCount, paragraphs } from './text.js';

const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;

export function newStoryId() {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `story-${d}${crypto.randomBytes(4).toString('hex')}`;
}

export class StoryService {
  constructor({ store, config, log }) {
    this.store = store;
    this.config = config;
    this.log = log;
  }

  rel(id) {
    return `stories/${assertStoryId(id)}.json`;
  }

  async get(id) {
    const story = await this.store.read(this.rel(id));
    if (!story) throw notFound();
    return story;
  }

  async exists(id) {
    return Boolean(await this.store.read(this.rel(id)));
  }

  async list() {
    const files = await this.store.list('stories');
    const stories = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const s = await this.store.read(`stories/${f}`);
      if (s) stories.push(summarize(s));
    }
    return stories.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  // Locked mutation of one story. `fn` mutates a copy and may return extra data.
  async mutate(id, fn) {
    let extra;
    const story = await this.store.update(this.rel(id), async (current) => {
      if (!current) throw notFound();
      const draft = structuredClone(current);
      extra = await fn(draft);
      return draft;
    });
    return extra === undefined ? story : { story, ...extra };
  }

  async create({ id, title = '', content = '', author } = {}) {
    id = id ? assertStoryId(id) : newStoryId();
    checkStoryText({ title, content }, this.config.limits);
    const now = new Date().toISOString();
    const story = {
      id,
      title: cleanText(title),
      content: cleanText(content),
      author: author || this.config.authorName,
      description: '',
      status: S.DRAFT,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      lastSnapshotAt: null,
      review: { status: 'none' },
      characters: [],
      scenes: [],
      approvedAt: null,
      slug: null,
      publishedAt: null,
      publishedUrl: null,
      hidden: false,
      lastError: null,
    };
    return this.store.withLock(this.rel(id), async () => {
      if (await this.store.read(this.rel(id))) {
        throw new StudioError('invalid_state', `Story ${id} already exists`, { status: 409 });
      }
      await this.store.write(this.rel(id), story);
      return story;
    });
  }

  // Autosave entry point. Creates the story if the browser made it offline.
  // If the caller edited an older revision, the newer server copy is kept as a
  // snapshot so no writing is ever lost, then the caller's text wins.
  async save(id, { title, content, description, baseRevision }, { actor = 'studio' } = {}) {
    assertStoryId(id);
    if (!(await this.exists(id))) return this.create({ id, title, content });
    const patch = {};
    if (title !== undefined) patch.title = cleanText(title);
    if (content !== undefined) patch.content = cleanText(content);
    if (description !== undefined) patch.description = cleanText(description).slice(0, 300);
    checkStoryText({ title: patch.title ?? '', content: patch.content ?? '' }, this.config.limits);

    let conflict = false;
    const story = await this.mutate(id, async (s) => {
      if (s.status === S.PUBLISHING) {
        throw new StudioError('invalid_state', 'Story is being published', {
          status: 409,
          friendly: 'Your story is being published right now. You can edit it again in a moment.',
        });
      }
      const changed =
        (patch.title !== undefined && patch.title !== s.title) ||
        (patch.content !== undefined && patch.content !== s.content) ||
        (patch.description !== undefined && patch.description !== s.description);
      if (!changed) return;

      if (Number.isInteger(baseRevision) && baseRevision < s.revision) {
        conflict = true;
        await this.writeSnapshot(s, 'Kept a copy from another device');
      } else if (!s.lastSnapshotAt || Date.now() - Date.parse(s.lastSnapshotAt) > SNAPSHOT_EVERY_MS) {
        await this.writeSnapshot(s, 'Autosaved copy');
        s.lastSnapshotAt = new Date().toISOString();
      }
      Object.assign(s, patch);
      s.revision += 1;
      s.updatedAt = new Date().toISOString();
      // Editing an approved or published story sends it back for a fresh look.
      if (s.status === S.READY_TO_PUBLISH || s.status === S.PUBLISHED) {
        s.status = S.REVIEWING;
        s.approvedAt = null;
      }
      this.log?.info('story.saved', { id, revision: s.revision, actor });
    });
    return conflict ? { ...story, conflictResolved: true } : story;
  }

  async setStatus(id, to, extra = {}) {
    return this.mutate(id, (s) => {
      assertTransition(s.status, to);
      s.status = to;
      Object.assign(s, extra);
      s.updatedAt = new Date().toISOString();
    });
  }

  async approve(id, { by = 'tashini' } = {}) {
    return this.mutate(id, (s) => {
      if (!s.title.trim() || !paragraphs(s.content).length) {
        throw new StudioError('invalid_state', 'Story needs a title and some writing before it can be approved', {
          status: 409,
          friendly: 'Your story needs a title and some writing first.',
        });
      }
      if (s.status === S.DRAFT) {
        throw new StudioError('invalid_state', 'Finish the story before approving it', {
          status: 409,
          friendly: 'Press "I\'m Finished" first so we can check your story.',
        });
      }
      if (s.status !== S.READY_TO_PUBLISH) assertTransition(s.status, S.READY_TO_PUBLISH);
      s.status = S.READY_TO_PUBLISH;
      s.approvedAt = new Date().toISOString();
      s.approvedBy = by;
      s.updatedAt = s.approvedAt;
    });
  }

  async remove(id) {
    await this.store.withLock(this.rel(id), async () => {
      await this.store.remove(this.rel(id));
    });
    await this.store.remove(`revisions/${id}`);
    await this.store.remove(`reviews/${id}.json`);
    await this.store.remove(`review-history/${id}`);
    await this.store.remove(`images/${id}`);
  }

  // ---- revisions --------------------------------------------------------------
  async writeSnapshot(story, note) {
    const snap = {
      revision: story.revision,
      title: story.title,
      content: story.content,
      note,
      savedAt: new Date().toISOString(),
    };
    await this.store.write(`revisions/${story.id}/${String(story.revision).padStart(6, '0')}.json`, snap);
    return snap;
  }

  async snapshot(id, note) {
    const story = await this.get(id);
    await this.writeSnapshot(story, note);
    await this.mutate(id, (s) => {
      s.lastSnapshotAt = new Date().toISOString();
    });
    return story;
  }

  async listRevisions(id) {
    assertStoryId(id);
    const files = (await this.store.list(`revisions/${id}`)).filter((f) => f.endsWith('.json')).sort();
    const out = [];
    for (const f of files) {
      const r = await this.store.read(`revisions/${id}/${f}`);
      if (r) out.push({ revision: r.revision, note: r.note, savedAt: r.savedAt, title: r.title, words: wordCount(r.content) });
    }
    return out.reverse();
  }

  async getRevision(id, revision) {
    assertStoryId(id);
    const r = await this.store.read(`revisions/${id}/${String(Number(revision)).padStart(6, '0')}.json`);
    if (!r) throw notFound('Revision');
    return r;
  }

  // The original text Tashini wrote before any AI suggestions were used.
  async getOriginal(id) {
    const story = await this.get(id);
    const rev = story.review?.originalRevision;
    if (!rev) return null;
    return this.getRevision(id, rev).catch(() => null);
  }

  async restoreRevision(id, revision) {
    const r = await this.getRevision(id, revision);
    const current = await this.get(id);
    await this.writeSnapshot(current, `Before going back to revision ${r.revision}`);
    return this.save(id, { title: r.title, content: r.content });
  }
}

export function summarize(s) {
  const selected = s.scenes?.find((sc) => sc.selected);
  return {
    id: s.id,
    title: s.title,
    status: s.status,
    statusLabel: STATUS_LABEL[s.status] ?? s.status,
    updatedAt: s.updatedAt,
    createdAt: s.createdAt,
    wordCount: wordCount(s.content),
    revision: s.revision,
    coverImage: selected ? `/api/stories/${s.id}/images/${selected.id}-${selected.selected}.webp` : null,
    publishedUrl: s.publishedUrl,
    hidden: Boolean(s.hidden),
    approved: Boolean(s.approvedAt),
    hasFeedback: Boolean(s.review?.generatedAt),
  };
}

export function publicView(s) {
  return { ...s, statusLabel: STATUS_LABEL[s.status] ?? s.status, wordCount: wordCount(s.content) };
}
