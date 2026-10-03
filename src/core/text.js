// Text helpers shared by the server, the renderer and the browser-independent tests.
// Any newline starts a new paragraph: children often press Enter once between paragraphs.

export function paragraphs(content) {
  return String(content ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
}

export function wordCount(content) {
  const m = String(content ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

// Young readers read slower than adults; 150 wpm keeps estimates honest.
export function readingTimeMinutes(content) {
  return Math.max(1, Math.round(wordCount(content) / 150));
}

export function slugify(title) {
  const s = String(title ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return s || 'story';
}

export function firstWords(text, n = 8) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ') + (words.length > n ? '…' : '');
}
