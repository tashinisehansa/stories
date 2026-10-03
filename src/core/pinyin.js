import { pinyin } from 'pinyin-pro';
import { hasCjk } from './text.js';

// Per-character pinyin for every Chinese string in a value (e.g. a review).
// Returns { "<text>": ["xiǎo", "míng", "", …] } aligned with [...text]; non-Han characters get "".
// Readings are worked out in context, so polyphones like 行 (háng/xíng) come out right.
export function pinyinMap(value) {
  const texts = new Set();
  collect(value, texts);
  const out = {};
  for (const text of texts) {
    if (!hasCjk(text)) continue;
    const chars = [...text];
    const all = pinyin(text, { type: 'all' });
    out[text] =
      all.length === chars.length
        ? all.map((x) => (x.isZh ? x.pinyin : ''))
        : chars.map((c) => (hasCjk(c) ? pinyin(c) : ''));
  }
  return out;
}

const SKIP_KEYS = new Set(['id', 'status', 'type', 'storyId', 'model', 'provider', 'reviewVersion', 'generatedAt', 'imagePrompt']);

function collect(value, into, key) {
  if (typeof value === 'string') {
    if (!SKIP_KEYS.has(key)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, into, key);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, into, k);
  }
}
