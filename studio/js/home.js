import { get, put } from './api.js';
import { allLocal, syncDirty } from './local.js';
import { el, $, timeAgo, wordCount, STATUS_ICON, toast } from './ui.js';

const WORKING = new Set(['REVIEWING', 'READY_TO_PUBLISH', 'PUBLISHING', 'REVIEW_FAILED', 'IMAGE_GENERATION_FAILED', 'PUBLISH_FAILED']);

function nextPage(s) {
  switch (s.status) {
    case 'DRAFT':
      return ['Continue writing', `/editor.html?id=${s.id}`];
    case 'REVIEWING':
    case 'REVIEW_FAILED':
      return ['Continue', `/review.html?id=${s.id}`];
    case 'IMAGE_GENERATION_FAILED':
      return ['See pictures', `/pictures.html?id=${s.id}`];
    default:
      return ['View', `/preview.html?id=${s.id}`];
  }
}

function badgeClass(status) {
  if (status === 'PUBLISHED') return 'badge published';
  if (status === 'READY_TO_PUBLISH') return 'badge ready';
  if (status.endsWith('FAILED')) return 'badge failed';
  return 'badge';
}

function card(s) {
  const [label, href] = nextPage(s);
  return el(
    'li',
    { class: 'story-card' },
    el('div', { class: 'cover', 'aria-hidden': s.coverImage ? null : 'true' }, s.coverImage ? el('img', { src: s.coverImage, alt: '', loading: 'lazy' }) : '📝'),
    el(
      'div',
      { class: 'body' },
      el('h3', { class: 'title' }, s.title || 'Untitled story'),
      el('span', { class: badgeClass(s.status) }, el('span', { 'aria-hidden': 'true' }, STATUS_ICON[s.status] ?? '•'), s.statusLabel),
      el('span', { class: 'meta' }, `${s.wordCount} words · edited ${timeAgo(s.updatedAt)}`),
      s.localOnly ? el('span', { class: 'meta' }, '💾 Saved on this device') : null,
      el(
        'div',
        { class: 'actions row' },
        el('a', { class: 'btn btn-small', href }, label),
        s.hasFeedback ? el('a', { class: 'btn btn-small btn-soft', href: `/feedback.html?id=${s.id}` }, '💡 Feedback') : null,
        s.publishedUrl && s.status === 'PUBLISHED' ? el('a', { class: 'btn btn-small btn-soft', href: s.publishedUrl, target: '_blank', rel: 'noopener' }, 'Read') : null,
      ),
    ),
  );
}

async function load() {
  let stories = [];
  let offline = false;
  try {
    stories = (await get('/api/stories')).stories;
  } catch {
    offline = true;
  }
  // Drafts that only exist on this device (written while offline).
  const known = new Set(stories.map((s) => s.id));
  for (const rec of await allLocal()) {
    if (rec?.id && !known.has(rec.id) && (rec.content || rec.title)) {
      stories.push({ id: rec.id, title: rec.title, status: 'DRAFT', statusLabel: 'Draft', wordCount: wordCount(rec.content), updatedAt: rec.updatedAt, localOnly: true });
    }
  }
  const groups = { drafts: [], working: [], published: [] };
  for (const s of stories) {
    if (s.status === 'DRAFT') groups.drafts.push(s);
    else if (WORKING.has(s.status)) groups.working.push(s);
    else groups.published.push(s);
  }
  const empty = {
    drafts: 'No drafts yet. Press “New Story” to start one!',
    working: 'When you finish a story, it will wait here while you check it and choose pictures.',
    published: 'Your published stories will appear here.',
  };
  for (const [key, list] of Object.entries(groups)) {
    const ul = $(`#${key}`);
    ul.replaceChildren(...(list.length ? list.map(card) : [el('li', { class: 'empty-note' }, empty[key])]));
  }
  if (offline) toast("We can't reach the story studio right now. Stories on this device are still here.", { oops: true, ms: 6000 });
}

async function init() {
  get('/api/health')
    .then((h) => h.siteUrl && ($('#site-link').href = h.siteUrl))
    .catch(() => {});
  const synced = await syncDirty((rec) => put(`/api/stories/${rec.id}`, { title: rec.title, content: rec.content, baseRevision: rec.baseRevision }));
  if (synced) toast(`✓ Saved ${synced} stor${synced === 1 ? 'y' : 'ies'} from this device`);
  await load();
}

init();
