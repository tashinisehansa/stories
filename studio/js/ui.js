// Tiny DOM helpers. Text always goes in via textContent — never innerHTML with user/AI text.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function storyIdFromUrl() {
  return new URLSearchParams(location.search).get('id');
}

let toastTimer;
export function toast(message, { oops = false, ms = 3500 } = {}) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: `toast${oops ? ' oops' : ''}`, role: 'status' }, message);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

// Friendly confirmation dialog. Resolves true/false.
export function confirmDialog({ title, body = [], yes = 'Continue', no = 'Go Back', yesClass = '' }) {
  return new Promise((resolve) => {
    const d = el(
      'dialog',
      { 'aria-labelledby': 'dlg-title' },
      el('h2', { id: 'dlg-title' }, title),
      ...body.map((p) => el('p', {}, p)),
      el(
        'div',
        { class: 'row end' },
        el('button', { type: 'button', class: 'btn-soft', onclick: () => close(false) }, no),
        el('button', { type: 'button', class: yesClass, onclick: () => close(true) }, yes),
      ),
    );
    function close(v) {
      d.close();
      d.remove();
      resolve(v);
    }
    d.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(false);
    });
    document.body.append(d);
    d.showModal();
    d.querySelector('button:last-child').focus();
  });
}

// Step navigation shown on every story page.
export function renderSteps(container, id, current) {
  const steps = [
    ['write', '✏️', 'Write', `editor.html?id=${encodeURIComponent(id)}`],
    ['check', '🔍', 'Check', `review.html?id=${encodeURIComponent(id)}`],
    ['pictures', '🎨', 'Pictures', `pictures.html?id=${encodeURIComponent(id)}`],
    ['preview', '📖', 'Preview', `preview.html?id=${encodeURIComponent(id)}`],
  ];
  container.replaceChildren(
    ...steps.map(([key, icon, label, href]) =>
      el('li', {}, el('a', { href, 'aria-current': key === current ? 'page' : null }, el('span', { 'aria-hidden': 'true' }, icon), label)),
    ),
  );
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

// Same rules as src/core/text.js: each Chinese/Japanese/Korean character counts as a word.
export function wordCount(text) {
  const t = String(text ?? '');
  const cjk = t.match(CJK)?.length ?? 0;
  return cjk + (t.replace(CJK, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

// Short excerpt that works with or without spaces between words.
export function excerpt(text, n = 7) {
  const t = String(text ?? '').trim();
  if (CJK.test(t)) {
    CJK.lastIndex = 0;
    const c = t.replace(/\s+/g, '');
    return c.length > n * 2 ? `${c.slice(0, n * 2)}…` : c;
  }
  const w = t.split(/\s+/);
  return w.length > n ? `${w.slice(0, n).join(' ')}…` : t;
}

export function paragraphs(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
}

// Poll `fn` every `ms` until it returns true (or the page is left).
export function poll(fn, ms = 2500) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    let done = false;
    try {
      done = await fn();
    } catch {
      /* keep trying */
    }
    if (!done && !stopped) setTimeout(tick, ms);
  };
  tick();
  return () => {
    stopped = true;
  };
}

export const STATUS_ICON = {
  DRAFT: '✏️',
  REVIEWING: '🔍',
  READY_TO_PUBLISH: '🌟',
  PUBLISHING: '🚀',
  PUBLISHED: '📚',
  REVIEW_FAILED: '🔁',
  IMAGE_GENERATION_FAILED: '🔁',
  PUBLISH_FAILED: '🔁',
};
