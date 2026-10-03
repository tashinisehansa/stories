import { get, post } from './api.js';
import { el, setChildren, $, storyIdFromUrl, renderSteps, toast, poll } from './ui.js';
import { makeText, pinyinToggle, suggestionCard, summaryCard, strengthsCard, improveCard, tipCard, ideasCard } from './feedback-view.js';

const id = storyIdFromUrl();
const main = $('#main');
let story;
let review;

async function decide(g, action) {
  try {
    const r = await post(`/api/stories/${id}/suggestions/${g.id}`, { action });
    Object.assign(g, r.suggestion);
    story = r.story;
    if (action === 'accept' && !r.applied) toast('That sentence has already changed, so there is nothing to fix. 👍');
    render();
  } catch (err) {
    toast(err.message, { oops: true });
  }
}

async function acceptAll() {
  try {
    await post(`/api/stories/${id}/suggestions/accept-all`);
    review = await get(`/api/stories/${id}/review`);
    toast('✓ All suggestions used.');
    render();
  } catch (err) {
    toast(err.message, { oops: true });
  }
}

async function checkAgain() {
  try {
    await post(`/api/stories/${id}/finish`, {});
    review = null;
    start();
  } catch (err) {
    toast(err.message, { oops: true });
  }
}

function render() {
  const t = makeText(review);
  const pending = review.grammarSuggestions.filter((g) => g.status === 'pending');
  setChildren(main, 
    el('div', { class: 'row' }, el('h1', {}, `🔍 ${story.title || 'Your story'}`), el('span', { class: 'spacer' }), pinyinToggle(review, render)),
    summaryCard(review, t),
    strengthsCard(review, t),
    el(
      'section',
      { 'aria-labelledby': 'h-fix' },
      el('h2', { id: 'h-fix' }, '✏️ Spelling & Grammar'),
      review.grammarSuggestions.length
        ? el('p', {}, pending.length ? `${pending.length} little fix${pending.length === 1 ? '' : 'es'} to look at. You choose!` : 'All done! 🎉')
        : el('p', { class: 'card good' }, 'Wow — we didn’t find any spelling or grammar mistakes! 🎉'),
      review.grammarSuggestions.map((g) => suggestionCard(g, t, { onDecide: decide })),
      pending.length > 1 ? el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn-soft btn-small', onclick: acceptAll }, 'Use all suggestions')) : null,
    ),
    improveCard(review, t),
    tipCard(review, t),
    ideasCard(review, t),
    el('details', { class: 'card soft', id: 'original' }, el('summary', {}, '📜 See my original story'), el('div', { class: 'original-text', id: 'original-text' }, 'Loading…')),
    el(
      'div',
      { class: 'row' },
      el('a', { class: 'btn btn-soft', href: `/editor.html?id=${id}` }, '✏️ Edit my story'),
      el('a', { class: 'btn btn-soft', href: `/feedback.html?id=${id}` }, '💡 All my feedback'),
      el('button', { type: 'button', class: 'btn-link', onclick: checkAgain }, 'Check my story again'),
      el('span', { class: 'spacer' }),
      el('a', { class: 'btn btn-big', href: `/pictures.html?id=${id}` }, '🎨 Next: Pictures →'),
    ),
  );
  $('#original').addEventListener('toggle', loadOriginal, { once: true });
}

async function loadOriginal() {
  try {
    const o = await get(`/api/stories/${id}/original`);
    $('#original-text').textContent = o.content ?? 'Your original story will appear here.';
  } catch {
    $('#original-text').textContent = 'We couldn’t load it right now.';
  }
}

function renderWorking() {
  setChildren(main, el('div', { class: 'working' }, el('span', { class: 'bounce', 'aria-hidden': 'true' }, '🔍'), el('p', {}, 'Checking your story…'), el('div', { class: 'muted' }, 'This can take a little while. Stretch your fingers! 🖐️')));
}

function renderFailed() {
  setChildren(main, 
    el(
      'div',
      { class: 'card oops' },
      el('h2', {}, 'Oh no!'),
      el('p', {}, "We couldn't check your story right now. Your writing is safe."),
      el(
        'div',
        { class: 'row' },
        el('button', { type: 'button', onclick: checkAgain }, 'Try Again'),
        el('a', { class: 'btn btn-soft', href: `/editor.html?id=${id}` }, '✏️ Back to my story'),
        el('a', { class: 'btn btn-soft', href: `/preview.html?id=${id}` }, 'Skip to Preview'),
      ),
    ),
  );
}

function renderNotFinished() {
  setChildren(main, 
    el(
      'div',
      { class: 'card' },
      el('h2', {}, 'Not checked yet'),
      el('p', {}, 'When you finish writing, press “I’m Finished” and we will check your story.'),
      el('div', { class: 'row' }, el('a', { class: 'btn', href: `/editor.html?id=${id}` }, '✏️ Back to writing'), el('button', { type: 'button', class: 'btn-green', onclick: checkAgain }, 'Check it now')),
    ),
  );
}

function start() {
  renderWorking();
  poll(async () => {
    story = await get(`/api/stories/${id}`);
    const st = story.review?.status;
    if (st === 'running') {
      renderWorking();
      return false;
    }
    if (st === 'failed') renderFailed();
    else if (st !== 'done') renderNotFinished();
    else {
      review = await get(`/api/stories/${id}/review`);
      render();
    }
    return true;
  });
}

if (!id) location.href = '/';
renderSteps($('#steps'), id, 'check');
start();
