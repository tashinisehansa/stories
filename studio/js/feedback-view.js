// Shared rendering for the review page (choose fixes) and the feedback page (look back).
// Chinese text gets pinyin above each character when the pinyin switch is on.
import { el } from './ui.js';

const HAN = /\p{Script=Han}/u;
const PINYIN_KEY = 'story-studio:pinyin';

export function pinyinWanted() {
  try {
    return localStorage.getItem(PINYIN_KEY) !== 'off';
  } catch {
    return true;
  }
}

function setPinyinWanted(on) {
  try {
    localStorage.setItem(PINYIN_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

// A switch shown only when the feedback has Chinese in it.
export function pinyinToggle(review, onChange) {
  if (!review.pinyin || !Object.keys(review.pinyin).length) return null;
  const on = pinyinWanted();
  return el(
    'button',
    {
      type: 'button',
      class: 'btn-soft btn-small pinyin-toggle',
      'aria-pressed': String(on),
      onclick: () => {
        setPinyinWanted(!on);
        onChange();
      },
    },
    on ? '拼音 Pinyin: on' : '拼音 Pinyin: off',
  );
}

// Text renderer bound to a review's pinyin map: t("小明") → <ruby>小<rt>xiǎo</rt></ruby>…
export function makeText(review) {
  const map = review.pinyin ?? {};
  const on = pinyinWanted();
  const t = (text) => {
    const s = String(text ?? '');
    const py = on ? map[s] : null;
    return py ? rubyRange([...s], py, 0, [...s].length) : s;
  };
  t.units = (text) => {
    const s = String(text ?? '');
    const chars = [...s];
    const py = on ? map[s] : null;
    return chars.map((c, i) => ({ c, p: py?.[i] || '' }));
  };
  return t;
}

function rubyRange(chars, py, start, end) {
  const frag = document.createDocumentFragment();
  let plain = '';
  for (let i = start; i < end; i++) {
    if (py[i] && HAN.test(chars[i])) {
      if (plain) frag.append(plain);
      plain = '';
      frag.append(el('ruby', {}, chars[i], el('rt', {}, py[i])));
    } else plain += chars[i];
  }
  if (plain) frag.append(plain);
  return frag;
}

function renderUnits(units) {
  const frag = document.createDocumentFragment();
  let plain = '';
  for (const u of units) {
    if (u.p && HAN.test(u.c)) {
      if (plain) frag.append(plain);
      plain = '';
      frag.append(el('ruby', {}, u.c, el('rt', {}, u.p)));
    } else plain += u.c;
  }
  if (plain) frag.append(plain);
  return frag;
}

// Split into diff tokens: each Chinese character alone, other text by words/spaces.
function tokens(units) {
  const out = [];
  let cur = null;
  const kind = (c) => (HAN.test(c) ? 'han' : /\s/.test(c) ? 'space' : 'word');
  for (const u of units) {
    const k = kind(u.c);
    if (k === 'han' || !cur || cur.k !== k) {
      cur = { k, units: [u] };
      out.push(cur);
      if (k === 'han') cur = null;
    } else cur.units.push(u);
  }
  return out.map((x) => ({ key: x.units.map((u) => u.c).join(''), units: x.units }));
}

// Highlight what changed between her sentence and the suggestion.
export function diffNodes(t, a, b) {
  const A = tokens(t.units(a));
  const B = tokens(t.units(b));
  const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i].key === B[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const yours = [];
  const theirs = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i].key === B[j].key) {
      yours.push(renderUnits(A[i++].units));
      theirs.push(renderUnits(B[j++].units));
    } else if (dp[i + 1][j] >= dp[i][j + 1]) yours.push(el('del', {}, renderUnits(A[i++].units)));
    else theirs.push(el('ins', {}, renderUnits(B[j++].units)));
  }
  while (i < A.length) yours.push(el('del', {}, renderUnits(A[i++].units)));
  while (j < B.length) theirs.push(el('ins', {}, renderUnits(B[j++].units)));
  return { yours, theirs };
}

const TYPE_LABEL = { grammar: 'Grammar', spelling: 'Spelling', punctuation: 'Punctuation', sentence: 'Clearer sentence' };

const RESULT = {
  accepted: '✓ You used this suggestion.',
  kept: '👍 You kept your sentence.',
  stale: '👍 This sentence has already changed.',
  pending: '⏳ Not decided yet.',
};

// One grammar suggestion. With `onDecide` it has Use/Keep buttons; without, it's read-only.
export function suggestionCard(g, t, { onDecide } = {}) {
  const { yours, theirs } = diffNodes(t, g.original, g.suggestion);
  const decided = g.status !== 'pending';
  let footer;
  if (onDecide && !decided) {
    footer = el(
      'div',
      { class: 'row' },
      el('button', { type: 'button', class: 'btn-green', onclick: () => onDecide(g, 'accept') }, 'Use Suggestion'),
      el('button', { type: 'button', class: 'btn-soft', onclick: () => onDecide(g, 'keep') }, 'Keep My Sentence'),
    );
  } else {
    footer = el(
      'div',
      { class: 'row' },
      el('p', { class: 'result' }, RESULT[g.status] ?? ''),
      onDecide && g.status === 'kept' ? el('button', { type: 'button', class: 'btn-link', onclick: () => onDecide(g, 'undo') }, 'Change my mind') : null,
    );
  }
  return el(
    'article',
    { class: `card suggestion${decided ? ' done' : ''}` },
    el('h3', {}, TYPE_LABEL[g.type] ?? 'Suggestion'),
    el('p', { class: 'label' }, 'Your sentence'),
    el('p', { class: 'yours' }, yours),
    el('p', { class: 'label' }, 'Suggestion'),
    el('p', { class: 'theirs' }, theirs),
    el('p', { class: 'label' }, 'Why?'),
    el('p', { class: 'why' }, t(g.explanation)),
    footer,
  );
}

export function list(items, t) {
  return el('ul', { class: 'nice' }, (items ?? []).map((x) => el('li', {}, t(x))));
}

export const summaryCard = (review, t) => el('section', { class: 'card sun' }, el('p', {}, el('strong', {}, '🌟 '), t(review.summary)));

export const strengthsCard = (review, t) =>
  el('section', { class: 'card good', 'aria-labelledby': 'h-well' }, el('h2', { id: 'h-well' }, '⭐ What You Did Well'), list(review.strengths, t));

export const improveCard = (review, t) =>
  review.improvements?.length
    ? el('section', { class: 'card', 'aria-labelledby': 'h-improve' }, el('h2', { id: 'h-improve' }, '🌱 Things You Could Improve'), list(review.improvements, t))
    : null;

export const tipCard = (review, t) =>
  el('section', { class: 'card sky', 'aria-labelledby': 'h-tip' }, el('h2', { id: 'h-tip' }, '💡 One Writing Tip'), list(review.writingTips, t));

// Optional ideas (never mixed with grammar fixes). `open` shows them expanded.
export function ideasCard(review, t, { open = false } = {}) {
  const ideas = review.writingIdeas ?? [];
  const vocab = review.vocabularySuggestions ?? [];
  if (!ideas.length && !vocab.length && !review.structureFeedback) return null;
  return el(
    'details',
    { class: 'card', open: open ? true : null },
    el('summary', {}, '✨ Optional Writing Ideas'),
    el('p', { class: 'muted' }, 'These are just ideas. Your story is yours — use them only if you like them!'),
    review.structureFeedback ? el('p', {}, el('strong', {}, 'Beginning, middle and end: '), t(review.structureFeedback)) : null,
    ideas.length
      ? el(
          'ul',
          { class: 'nice' },
          ideas.map((w) => el('li', {}, t(w.idea), w.example ? el('div', { class: 'muted' }, 'For example: “', t(w.example), '”') : null)),
        )
      : null,
    vocab.length
      ? el(
          'div',
          {},
          el('h3', {}, 'Fun words to try'),
          el(
            'ul',
            { class: 'nice' },
            vocab.map((v) =>
              el('li', {}, el('strong', {}, t(v.word)), ' → ', ...v.alternatives.flatMap((a, i) => (i ? [', ', t(a)] : [t(a)])), v.explanation ? el('div', { class: 'muted' }, t(v.explanation)) : null),
            ),
          ),
        )
      : null,
  );
}
