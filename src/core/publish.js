import { StudioError } from './errors.js';
import { S } from './states.js';
import { assertSlug, scanPrivateInfo } from './safety.js';
import { slugify } from './text.js';
import { storyDocument, renderStoryPage, renderLibrary, mergeIndex } from './render.js';
import { candidateFile } from './images.js';

const MAX_ATTEMPTS = 3;

export class PublishService {
  constructor({ stories, store, repo, jobs, log, config }) {
    Object.assign(this, { stories, store, repo, jobs, log, config });
  }

  renderOpts() {
    return { siteTitle: this.config.siteTitle, siteUrl: this.config.siteUrl, authorName: this.config.authorName };
  }

  async readIndex() {
    const buf = await this.repo.getFile('site/stories.json');
    if (!buf) return [];
    try {
      const data = JSON.parse(buf.toString('utf8'));
      return Array.isArray(data.stories) ? data.stories : [];
    } catch {
      return [];
    }
  }

  indexFiles(entries) {
    return [
      { path: 'site/stories.json', content: `${JSON.stringify({ generatedBy: 'story-studio', stories: entries }, null, 2)}\n` },
      { path: 'site/index.html', content: renderLibrary(entries, this.renderOpts()) },
    ];
  }

  async chooseSlug(story) {
    if (story.slug) return assertSlug(story.slug);
    const base = slugify(story.title);
    for (let i = 1; i < 100; i++) {
      const slug = i === 1 ? base : `${base}-${i}`;
      if (!(await this.repo.getFile(`site/stories/${slug}/story.json`))) return assertSlug(slug);
    }
    throw new StudioError('publish_failed', 'Could not find a free slug', { status: 500 });
  }

  privateInfo(story) {
    return scanPrivateInfo([story.title, story.description, story.content].join('\n'));
  }

  // Preview document (same renderer as publish). Images map to studio files.
  async preview(id) {
    const story = await this.stories.get(id);
    const { doc, images } = storyDocument(story, {
      slug: story.slug ?? slugify(story.title),
      publishedAt: story.publishedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: story.author,
    });
    return { story, doc, images, html: renderStoryPage(doc, { ...this.renderOpts(), preview: true }) };
  }

  async previewImage(id, name) {
    const { images } = await this.preview(id);
    const img = images.find((i) => i.path === `images/${name}`);
    if (!img) return null;
    return this.store.readBuffer(`images/${id}/${candidateFile(img.sceneId, img.candidateId)}`);
  }

  // Publish an approved story. `actor` is studio | agent | parent.
  // Parents may override approval and the private-info check explicitly.
  async publish(id, { actor = 'studio', override = false, allowPrivateInfo = false } = {}) {
    const story = await this.stories.get(id);
    const isParent = actor === 'parent';
    if (!story.approvedAt && !(isParent && override)) {
      throw new StudioError('not_approved', `Story ${id} has not been approved by Tashini`, { status: 409 });
    }
    if (![S.READY_TO_PUBLISH, S.PUBLISH_FAILED].includes(story.status) && !(isParent && override)) {
      throw new StudioError('invalid_state', `Story is ${story.status}, not ready to publish`, { status: 409 });
    }
    const pii = this.privateInfo(story);
    if (pii.length && !(isParent && allowPrivateInfo)) {
      throw new StudioError('private_info', `Possible private info: ${pii.map((p) => p.kind).join(', ')}`, {
        status: 422,
        details: pii,
      });
    }
    if (this.jobs.isRunning(`publish:${id}`)) return this.jobs.run(`publish:${id}`);

    await this.stories.mutate(id, (s) => {
      if (s.status !== S.PUBLISHING) {
        if (s.status === S.READY_TO_PUBLISH || s.status === S.PUBLISH_FAILED) s.status = S.PUBLISHING;
        else if (isParent && override) {
          s.status = S.PUBLISHING;
          s.approvedAt ??= new Date().toISOString();
          s.approvedBy ??= 'parent';
        }
      }
      s.lastError = null;
    });
    return this.jobs.run(`publish:${id}`, () => this.doPublish(id));
  }

  async doPublish(id) {
    try {
      let lastErr;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          return await this.commitStory(id);
        } catch (err) {
          lastErr = err;
          if (err.code !== 'ref_conflict') throw err;
          this.log.warn('publish.ref_conflict', { id, attempt });
        }
      }
      throw lastErr;
    } catch (err) {
      this.log.error('publish.failed', { id, err });
      await this.stories.mutate(id, (s) => {
        s.status = S.PUBLISH_FAILED;
        s.lastError = { code: 'publish_failed', message: err.message, at: new Date().toISOString() };
      });
      throw err instanceof StudioError && err.code !== 'ref_conflict'
        ? err
        : new StudioError('publish_failed', err.message, { status: 502 });
    }
  }

  async commitStory(id) {
    const story = await this.stories.get(id);
    const slug = await this.chooseSlug(story);
    const now = new Date().toISOString();
    const isUpdate = Boolean(story.publishedAt);
    const { doc, images } = storyDocument(story, {
      slug,
      publishedAt: story.publishedAt ?? now,
      updatedAt: now,
      author: story.author,
    });
    const dir = `site/stories/${slug}`;
    const files = [
      { path: `${dir}/story.json`, content: `${JSON.stringify(doc, null, 2)}\n` },
      { path: `${dir}/index.html`, content: renderStoryPage(doc, this.renderOpts()) },
    ];
    for (const img of images) {
      files.push({
        path: `${dir}/${img.path}`,
        content: await this.store.readBuffer(`images/${id}/${candidateFile(img.sceneId, img.candidateId)}`),
      });
    }
    // Remove pictures from an earlier version that are no longer used.
    const existing = await this.repo.listTree(`${dir}/images/`);
    const keep = new Set(files.map((f) => f.path));
    const deletes = existing.filter((p) => !keep.has(p));

    const index = mergeIndex(await this.readIndex(), doc);
    files.push(...this.indexFiles(index));

    const commit = await this.repo.commit({
      message: `${isUpdate ? 'Update' : 'Add'} story: ${doc.title}`,
      files,
      deletes,
    });
    const publishedUrl = this.config.siteUrl ? new URL(`stories/${slug}/`, this.config.siteUrl).href : `stories/${slug}/`;
    const updated = await this.stories.mutate(id, (s) => {
      Object.assign(s, {
        status: S.PUBLISHED,
        slug,
        publishedAt: doc.publishedAt,
        lastPublishedAt: now,
        publishedUrl,
        publishCommit: commit.sha,
        publishCommitUrl: commit.url,
        lastPublishedRevision: s.revision,
        hidden: false,
        lastError: null,
      });
    });
    await this.stories.writeSnapshot(updated, 'Published version');
    this.log.info('publish.done', { id, slug, commit: commit.sha });
    return { status: 'published', url: publishedUrl, slug, commit: commit.sha, story: updated };
  }

  async deploymentStatus(id) {
    const story = await this.stories.get(id);
    if (!story.publishCommit) return { state: 'not_published' };
    try {
      return { ...(await this.repo.deployment(story.publishCommit, this.config.github.pagesWorkflow)), url: story.publishedUrl };
    } catch (err) {
      this.log.warn('publish.status_failed', { id, err });
      return { state: 'unknown', url: story.publishedUrl };
    }
  }

  // Parent tools: hide from the library (page stays reachable) or remove entirely.
  async setHidden(id, hidden) {
    const story = await this.stories.get(id);
    if (!story.slug || !story.publishedAt) throw new StudioError('invalid_state', 'Story is not published', { status: 409 });
    const dir = `site/stories/${story.slug}`;
    const buf = await this.repo.getFile(`${dir}/story.json`);
    if (!buf) throw new StudioError('invalid_state', 'Published story not found in repository', { status: 409 });
    const doc = { ...JSON.parse(buf.toString('utf8')), hidden: Boolean(hidden) };
    const index = mergeIndex(await this.readIndex(), doc);
    const commit = await this.repo.commit({
      message: `${hidden ? 'Hide' : 'Show'} story: ${doc.title}`,
      files: [
        { path: `${dir}/story.json`, content: `${JSON.stringify(doc, null, 2)}\n` },
        { path: `${dir}/index.html`, content: renderStoryPage(doc, this.renderOpts()) },
        ...this.indexFiles(index),
      ],
    });
    this.log.info('publish.hidden', { id, hidden, commit: commit.sha });
    return this.stories.mutate(id, (s) => {
      s.hidden = Boolean(hidden);
      s.publishCommit = commit.sha;
    });
  }

  async unpublish(id) {
    const story = await this.stories.get(id);
    if (!story.slug || !story.publishedAt) throw new StudioError('invalid_state', 'Story is not published', { status: 409 });
    const dir = `site/stories/${story.slug}`;
    const deletes = await this.repo.listTree(`${dir}/`);
    const entries = (await this.readIndex()).filter((e) => e.id !== story.slug);
    const commit = await this.repo.commit({ message: `Remove story: ${story.title}`, files: this.indexFiles(entries), deletes });
    this.log.info('publish.removed', { id, commit: commit.sha });
    return this.stories.mutate(id, (s) => {
      Object.assign(s, { status: S.REVIEWING, publishedAt: null, publishedUrl: null, publishCommit: commit.sha, hidden: false, approvedAt: null });
    });
  }
}

