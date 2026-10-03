// "My Feedback": every check of a story, kept so Tashini can look back at what she learned.
import { get } from './api.js';
import { cacheFeedback, cachedFeedback } from './local.js';
import { el, setChildren, $, storyIdFromUrl, renderSteps, toast } from './ui.js';
import { makeText, pinyinToggle, suggestionCard, summaryCard, strengthsCard, improveCard, tipCard, ideasCard } from './feedback-view.js';

const id = storyIdFromUrl();
const main = $('#main');
let info; // { story, checks }
let selected = 'current';
let review;
let offline = false;

function when(iso) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

async function loadInfo() {
  try {
    info = await get(`/api/stories/${id}/feedback`);
    await cacheFeedback(`${id}:index`, info);
  } catch (err) {
    info = await cachedFeedback(`${id}:index`);
    if (!info) throw err;
    offline = true;
  }
}

async function loadCheck(key) {
  try {
    if (offline) throw new Error('offline');
    review = await get(`/api/stories/${id}/feedback/${key}`);
    await cacheFeedback(`${id}:${key}`, review);
  } catch (err) {
    review = await cachedFeedback(`${id}:${key}`);
    if (!review) throw err;
    offline = true;
  }
  selected = key;
}

function checkPicker() {
  if (info.checks.length < 2) return null;
  return el(
    'nav',
    { class: 'card soft', 'aria-label': 'Choose a check' },
    el('p', { class: 'label' }, 'Your checks'),
    el(
      'div',
      { class: 'row' },
      info.checks.map((c, i) =>
        el(
          'button',
          {
            type: 'button',
            class: `btn-small ${c.key === selected ? '' : 'btn-soft'}`,
            'aria-pressed': String(c.key === selected),
            onclick: async () => {
              try {
                await loadCheck(c.key);
                render();
              } catch (err) {
                toast(err.message, { oops: true });
              }
            },
          },
          i === 0 ? `Latest · ${when(c.generatedAt)}` : when(c.generatedAt),
        ),
      ),
    ),
  );
}

function learnedSection(t) {
  const g = review.grammarSuggestions ?? [];
  if (!g.length) return el('section', { class: 'card good' }, el('h2', {}, '✏️ Spelling & Grammar'), el('p', {}, 'No spelling or grammar mistakes in this check! 🎉'));
  const used = g.filter((x) => x.status === 'accepted').length;
  const pending = g.filter((x) => x.status === 'pending').length;
  return el(
    'section',
    { 'aria-labelledby': 'h-learn' },
    el('h2', { id: 'h-learn' }, '✏️ Spelling & Grammar I Learned'),
    el('p', { class: 'muted' }, `${g.length} things to learn · you used ${used}${pending ? ` · ${pending} still to decide` : ''}`),
    g.map((x) => suggestionCard(x, t)),
    pending && selected === 'current' ? el('a', { class: 'btn btn-small', href: `/review.html?id=${id}` }, 'Decide the rest →') : null,
  );
}

async function originalSection() {
  if (!review.originalRevision || offline) return null;
  const box = el('div', { class: 'original-text' }, 'Loading…');
  const d = el('details', { class: 'card soft' }, el('summary', {}, '📜 My story when it was checked'), box);
  d.addEventListener(
    'toggle',
    async () => {
      try {
        const r = await get(`/api/stories/${id}/revisions/${review.originalRevision}`);
        box.textContent = r.content;
      } catch {
        box.textContent = 'We couldn’t find that version.';
      }
    },
    { once: true },
  );
  return d;
}

async function render() {
  const t = makeText(review);
  setChildren(main, 
    el('div', { class: 'row' }, el('h1', {}, `💡 My Feedback`), el('span', { class: 'spacer' }), pinyinToggle(review, render)),
    el('p', { class: 'muted' }, `“${info.story.title || 'Untitled story'}” · checked ${when(review.generatedAt)}`),
    offline ? el('p', { class: 'card sky' }, '💾 Showing the copy saved on this device.') : null,
    checkPicker(),
    summaryCard(review, t),
    strengthsCard(review, t),
    improveCard(review, t),
    tipCard(review, t),
    learnedSection(t),
    ideasCard(review, t, { open: true }),
    await originalSection(),
    el(
      'div',
      { class: 'row' },
      el('a', { class: 'btn btn-soft', href: `/editor.html?id=${id}` }, '✏️ Open my story'),
      el('span', { class: 'spacer' }),
      el('a', { class: 'btn', href: '/' }, '📚 My Stories'),
    ),
  );
}

(async () => {
  if (!id) return void (location.href = '/');
  renderSteps($('#steps'), id, 'feedback');
  try {
    await loadInfo();
    if (!info.checks.length) {
      setChildren(main, 
        el('h1', {}, '💡 My Feedback'),
        el('div', { class: 'card' }, el('p', {}, 'This story hasn’t been checked yet. When you press “I’m Finished”, your feedback will be saved here so you can look back at it any time.'), el('a', { class: 'btn', href: `/editor.html?id=${id}` }, '✏️ Back to my story')),
      );
      return;
    }
    await loadCheck(info.checks[0].key);
    await render();
  } catch (err) {
    setChildren(main, el('div', { class: 'card oops' }, err.message));
  }
})();
