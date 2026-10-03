import { get, put, post, ApiError } from './api.js';
import { getLocal, putLocal, newStoryId, syncDirty } from './local.js';
import { el, $, storyIdFromUrl, renderSteps, toast, confirmDialog, wordCount, timeAgo } from './ui.js';

const DEBOUNCE_MS = 1500;
const titleEl = $('#title');
const contentEl = $('#content');
const statusEl = $('#save-status');

let id = storyIdFromUrl();
let baseRevision = null;
let serverStatus = 'DRAFT';
let timer = null;
let saving = null;
let pending = false;
let lastSaved = { title: '', content: '' };

function setStatus(kind, text) {
  statusEl.className = `save-status ${kind}`;
  statusEl.textContent = text;
}

function updateCounts() {
  const words = wordCount(contentEl.value);
  $('#counts').textContent = `${words} word${words === 1 ? '' : 's'} · ${contentEl.value.length} letters`;
}

function current() {
  return { title: titleEl.value, content: contentEl.value };
}

function isDirty() {
  const c = current();
  return c.title !== lastSaved.title || c.content !== lastSaved.content;
}

// Save locally first (instant, survives refresh), then to the studio server.
async function save({ keepalive = false } = {}) {
  clearTimeout(timer);
  if (saving) {
    pending = true;
    return saving;
  }
  if (!isDirty()) return;
  const snapshot = current();
  saving = (async () => {
    const now = new Date().toISOString();
    await putLocal({ id, ...snapshot, baseRevision, updatedAt: now, dirty: true });
    setStatus('', 'Saving…');
    try {
      const saved = await put(`/api/stories/${id}`, { ...snapshot, baseRevision }, { keepalive });
      baseRevision = saved.revision;
      serverStatus = saved.status;
      lastSaved = snapshot;
      await putLocal({ id, ...snapshot, baseRevision, updatedAt: saved.updatedAt, dirty: false });
      setStatus('saved', '✓ Saved');
      if (saved.conflictResolved) toast('✓ Saved. We also kept a copy of the other version in “Older versions”.');
      showStateNote();
    } catch (err) {
      lastSaved = snapshot; // stored locally; sync later
      if (err instanceof ApiError && err.offline) {
        setStatus('local', '💾 Saved on this device');
      } else {
        setStatus('error', "Couldn't save right now. Your latest writing is still stored on this device.");
        if (err.message) toast(err.message, { oops: true });
      }
      // Remember that the server still needs this version.
      await putLocal({ id, ...snapshot, baseRevision, updatedAt: new Date().toISOString(), dirty: true });
    }
  })();
  try {
    await saving;
  } finally {
    saving = null;
    if (pending) {
      pending = false;
      if (isDirty()) await save();
    }
  }
}

function scheduleSave() {
  updateCounts();
  setStatus('', 'Writing…');
  clearTimeout(timer);
  timer = setTimeout(() => save(), DEBOUNCE_MS);
}

function showStateNote() {
  const note = $('#state-note');
  const msgs = {
    REVIEWING: 'You are checking this story. Changes you make here are saved, and you can check it again any time.',
    READY_TO_PUBLISH: 'This story was ready to publish. If you change it, you will look at the preview again before publishing.',
    PUBLISHED: 'This story is published. If you change it, you can publish the new version from the preview.',
  };
  note.textContent = msgs[serverStatus] ?? '';
  note.hidden = !msgs[serverStatus];
}

async function load() {
  if (!id) {
    id = newStoryId();
    history.replaceState(null, '', `?id=${id}`);
  }
  renderSteps($('#steps'), id, 'write');
  const local = await getLocal(id);
  let server = null;
  try {
    server = await get(`/api/stories/${id}`);
  } catch (err) {
    if (err.offline) setStatus('local', '💾 Working on this device');
  }
  // Prefer the device copy if it has writing the server hasn't seen yet.
  const useLocal = local?.dirty && (!server || (local.updatedAt ?? '') >= (server.updatedAt ?? ''));
  const src = useLocal ? local : server ?? local ?? { title: '', content: '' };
  titleEl.value = src.title ?? '';
  contentEl.value = src.content ?? '';
  baseRevision = useLocal ? local.baseRevision ?? server?.revision ?? null : server?.revision ?? null;
  serverStatus = server?.status ?? 'DRAFT';
  lastSaved = server ? { title: server.title, content: server.content } : { title: '', content: '' };
  updateCounts();
  showStateNote();
  if (useLocal) await save();
  else setStatus('saved', server ? '✓ Saved' : 'Ready to write');
  (titleEl.value ? contentEl : titleEl).focus();
}

async function finish() {
  if (wordCount(contentEl.value) < 5) {
    toast('Write a little more of your story first!');
    contentEl.focus();
    return;
  }
  const ok = await confirmDialog({
    title: 'Are you finished with your story?',
    body: ["We'll check your writing and prepare some pictures.", 'You can still make changes before publishing.'],
    yes: 'Continue',
    no: 'Go Back',
    yesClass: 'btn-green',
  });
  if (!ok) return;
  await save();
  if (isDirty() || statusEl.classList.contains('local') || statusEl.classList.contains('error')) {
    toast("We need to reach the story studio to check your story. Your writing is safe — please try again in a moment.", { oops: true });
    return;
  }
  $('#finish').disabled = true;
  try {
    await post(`/api/stories/${id}/finish`, {});
    location.href = `/review.html?id=${id}`;
  } catch (err) {
    toast(err.message, { oops: true });
    $('#finish').disabled = false;
  }
}

async function showHistory() {
  await save();
  let revisions = [];
  try {
    revisions = (await get(`/api/stories/${id}/revisions`)).revisions;
  } catch (err) {
    toast(err.message, { oops: true });
    return;
  }
  const list = revisions.length
    ? el(
        'ul',
        { class: 'nice' },
        revisions.map((r) =>
          el(
            'li',
            {},
            el('strong', {}, r.note),
            ` — ${timeAgo(r.savedAt)}, ${r.words} words `,
            el('button', { type: 'button', class: 'btn-small btn-soft', onclick: () => restore(r) }, 'Go back to this'),
          ),
        ),
      )
    : el('p', {}, 'No older versions yet. We save copies while you write and before your story is checked.');
  const d = el(
    'dialog',
    { 'aria-labelledby': 'hist-title' },
    el('h2', { id: 'hist-title' }, '🕘 Older versions'),
    list,
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn-soft', onclick: () => d.close() }, 'Close')),
  );
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();

  async function restore(r) {
    const ok = await confirmDialog({
      title: 'Go back to this version?',
      body: ['Your story will change back to how it was then. We will keep a copy of what you have now, just in case.'],
      yes: 'Yes, go back',
    });
    if (!ok) return;
    try {
      const s = await post(`/api/stories/${id}/revisions/${r.revision}/restore`);
      titleEl.value = s.title;
      contentEl.value = s.content;
      baseRevision = s.revision;
      lastSaved = { title: s.title, content: s.content };
      await putLocal({ id, title: s.title, content: s.content, baseRevision, updatedAt: s.updatedAt, dirty: false });
      updateCounts();
      d.close();
      toast('✓ Your story is back to that version.');
    } catch (err) {
      toast(err.message, { oops: true });
    }
  }
}

titleEl.addEventListener('input', scheduleSave);
contentEl.addEventListener('input', scheduleSave);
titleEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    contentEl.focus();
  }
});
titleEl.addEventListener('blur', () => save());
contentEl.addEventListener('blur', () => save());
$('#save').addEventListener('click', () => save());
$('#finish').addEventListener('click', finish);
$('#history').addEventListener('click', showHistory);
$('#undo').addEventListener('click', () => {
  contentEl.focus();
  document.execCommand('undo');
});
$('#redo').addEventListener('click', () => {
  contentEl.focus();
  document.execCommand('redo');
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') save({ keepalive: true });
});
window.addEventListener('pagehide', () => save({ keepalive: true }));
window.addEventListener('beforeunload', (e) => {
  if (isDirty()) {
    save({ keepalive: true });
    e.preventDefault();
  }
});
async function retrySync() {
  const n = await syncDirty((rec) => put(`/api/stories/${rec.id}`, { title: rec.title, content: rec.content, baseRevision: rec.baseRevision }));
  if (n) {
    const local = await getLocal(id);
    if (local) baseRevision = local.baseRevision;
    setStatus('saved', '✓ Saved');
  }
}
window.addEventListener('online', retrySync);
// Keep trying quietly while the studio can't be reached.
setInterval(() => {
  if (statusEl.classList.contains('local') || statusEl.classList.contains('error')) retrySync();
}, 30_000);

load();
