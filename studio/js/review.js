import { get, post } from './api.js';
import { el, $, storyIdFromUrl, renderSteps, toast, poll } from './ui.js';

const id = storyIdFromUrl();
const main = $('#main');
let story;
let review;

// Highlight what changed between the child's sentence and the suggestion (word level).
function diffWords(a, b) {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const yours = [];
  const theirs = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      yours.push(A[i]);
      theirs.push(B[j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) yours.push(el('del', {}, A[i++]));
    else theirs.push(el('ins', {}, B[j++]));
  }
  while (i < A.length) yours.push(el('del', {}, A[i++]));
  while (j < B.length) theirs.push(el('ins', {}, B[j++]));
  return { yours, theirs };
}

const TYPE_LABEL = { grammar: 'Grammar', spelling: 'Spelling', punctuation: 'Punctuation', sentence: 'Clearer sentence' };

function suggestionCard(g) {
  const { yours, theirs } = diffWords(g.original, g.suggestion);
  const done = g.status !== 'pending';
  const result = {
    accepted: '✓ You used this suggestion.',
    kept: '👍 You kept your sentence.',
    stale: '👍 This sentence has already changed — nothing to do here.',
  }[g.status];
  return el(
    'article',
    { class: `card suggestion${done ? ' done' : ''}` },
    el('h3', {}, TYPE_LABEL[g.type] ?? 'Suggestion'),
    el('p', { class: 'label' }, 'Your sentence'),
    el('p', { class: 'yours' }, yours),
    el('p', { class: 'label' }, 'Suggestion'),
    el('p', { class: 'theirs' }, theirs),
    el('p', { class: 'label' }, 'Why?'),
    el('p', { class: 'why' }, g.explanation),
    done
      ? el(
          'div',
          { class: 'row' },
          el('p', { class: 'result' }, result),
          g.status === 'kept' ? el('button', { type: 'button', class: 'btn-link', onclick: () => decide(g, 'undo') }, 'Change my mind') : null,
        )
      : el(
          'div',
          { class: 'row', style: null },
          el('button', { type: 'button', class: 'btn-green', onclick: () => decide(g, 'accept') }, 'Use Suggestion'),
          el('button', { type: 'button', class: 'btn-soft', onclick: () => decide(g, 'keep') }, 'Keep My Sentence'),
        ),
  );
}

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

function list(items) {
  return el('ul', { class: 'nice' }, items.map((t) => el('li', {}, t)));
}

function render() {
  const pending = review.grammarSuggestions.filter((g) => g.status === 'pending');
  const ideas = review.writingIdeas ?? [];
  const vocab = review.vocabularySuggestions ?? [];
  main.replaceChildren(
    el('h1', {}, `🔍 ${story.title || 'Your story'}`),
    el('section', { class: 'card sun' }, el('p', { style: null }, el('strong', {}, '🌟 '), review.summary)),

    el('section', { class: 'card good', 'aria-labelledby': 'h-well' }, el('h2', { id: 'h-well' }, '⭐ What You Did Well'), list(review.strengths)),

    el(
      'section',
      { 'aria-labelledby': 'h-fix' },
      el('h2', { id: 'h-fix' }, '✏️ Spelling & Grammar'),
      review.grammarSuggestions.length
        ? el(
            'p',
            {},
            pending.length
              ? `${pending.length} little fix${pending.length === 1 ? '' : 'es'} to look at. You choose!`
              : 'All done! 🎉',
          )
        : el('p', { class: 'card good' }, 'Wow — we didn’t find any spelling or grammar mistakes! 🎉'),
      review.grammarSuggestions.map(suggestionCard),
      pending.length > 1 ? el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn-soft btn-small', onclick: acceptAll }, 'Use all suggestions')) : null,
    ),

    review.improvements.length
      ? el('section', { class: 'card', 'aria-labelledby': 'h-improve' }, el('h2', { id: 'h-improve' }, '🌱 Things You Could Improve'), list(review.improvements))
      : null,

    el('section', { class: 'card sky', 'aria-labelledby': 'h-tip' }, el('h2', { id: 'h-tip' }, '💡 One Writing Tip'), list(review.writingTips)),

    ideas.length || vocab.length || review.structureFeedback
      ? el(
          'details',
          { class: 'card' },
          el('summary', {}, '✨ Optional Writing Ideas'),
          el('p', { class: 'muted' }, 'These are just ideas. Your story is yours — use them only if you like them!'),
          review.structureFeedback ? el('p', {}, el('strong', {}, 'Beginning, middle and end: '), review.structureFeedback) : null,
          ideas.length
            ? el(
                'ul',
                { class: 'nice' },
                ideas.map((w) => el('li', {}, w.idea, w.example ? el('div', { class: 'muted' }, `For example: “${w.example}”`) : null)),
              )
            : null,
          vocab.length
            ? el(
                'div',
                {},
                el('h3', {}, 'Fun words to try'),
                el('ul', { class: 'nice' }, vocab.map((v) => el('li', {}, el('strong', {}, v.word), ' → ', v.alternatives.join(', '), v.explanation ? el('div', { class: 'muted' }, v.explanation) : null))),
              )
            : null,
        )
      : null,

    el('details', { class: 'card soft', id: 'original' }, el('summary', {}, '📜 See my original story'), el('div', { class: 'original-text', id: 'original-text' }, 'Loading…')),

    el(
      'div',
      { class: 'row' },
      el('a', { class: 'btn btn-soft', href: `/editor.html?id=${id}` }, '✏️ Edit my story'),
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
  main.replaceChildren(el('div', { class: 'working' }, el('span', { class: 'bounce', 'aria-hidden': 'true' }, '🔍'), el('p', {}, 'Checking your story…'), el('div', { class: 'muted' }, 'This can take a little while. Stretch your fingers! 🖐️')));
}

function renderFailed() {
  main.replaceChildren(
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
  main.replaceChildren(
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
