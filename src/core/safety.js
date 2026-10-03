import net from 'node:net';
import { StudioError } from './errors.js';

export const STORY_ID_RE = /^story-[a-z0-9]{6,40}$/;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function assertStoryId(id) {
  if (typeof id !== 'string' || !STORY_ID_RE.test(id)) {
    throw new StudioError('invalid_input', `Invalid story id: ${JSON.stringify(id)}`);
  }
  return id;
}

export function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new StudioError('invalid_input', `Invalid slug: ${JSON.stringify(slug)}`);
  }
  return slug;
}

// The publisher may only ever write these paths in the public repository.
const ALLOWED_SITE_PATH =
  /^site\/(?:index\.html|stories\.json|stories\/[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?\/(?:index\.html|story\.json|images\/scene-\d{2}\.webp))$/;

export function assertPublishPath(p) {
  if (typeof p !== 'string' || p.includes('..') || !ALLOWED_SITE_PATH.test(p)) {
    throw new StudioError('forbidden', `Refusing to write outside the story site: ${p}`, { status: 403 });
  }
  return p;
}

export function checkStoryText({ title = '', content = '' }, limits) {
  if (typeof title !== 'string' || typeof content !== 'string') {
    throw new StudioError('invalid_input', 'title and content must be strings');
  }
  if (title.length > limits.maxTitleChars) {
    throw new StudioError('too_long', `Title longer than ${limits.maxTitleChars} characters`, {
      friendly: 'That title is very long! Try a shorter one.',
    });
  }
  if (content.length > limits.maxStoryChars) {
    throw new StudioError('too_long', `Story longer than ${limits.maxStoryChars} characters`, { status: 413 });
  }
}

// Strip control characters (keep newlines and tabs) from user/AI text.
export function cleanText(s) {
  return String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

// ---- Private information scan -------------------------------------------------
// Hard blocks: things that should never appear in a child's public story.
const PII_PATTERNS = [
  { kind: 'email address', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g },
  { kind: 'phone number', re: /(?:\+?\d[\d\s().-]{7,}\d)/g, test: (m) => m.replace(/\D/g, '').length >= 8 },
  {
    kind: 'street address',
    re: /\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][\w'-]*\s+){1,4}(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Drive|Dr|Mawatha|Place|Pl|Crescent|Close|Court|Way|Terrace|Boulevard|Blvd)\b\.?/g,
  },
  { kind: 'website or social link', re: /\b(?:https?:\/\/|www\.)\S+/gi },
];

export function scanPrivateInfo(text) {
  const findings = [];
  for (const { kind, re, test } of PII_PATTERNS) {
    for (const m of String(text ?? '').matchAll(re)) {
      if (!test || test(m[0])) findings.push({ kind, match: m[0].trim() });
    }
  }
  return findings;
}

// ---- Network allowlist --------------------------------------------------------
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function ipv6ToBigInt(ip) {
  let [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : [];
  const parts = [...h, ...fill, ...t];
  return parts.reduce((acc, p) => (acc << 16n) + BigInt(Number.parseInt(p || '0', 16)), 0n);
}

export function ipInCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  if (net.isIPv4(ip) && net.isIPv4(range)) {
    const bits = Number(bitsStr ?? 32);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
  }
  if (net.isIPv6(ip) && net.isIPv6(range)) {
    const bits = BigInt(bitsStr ?? 128);
    const mask = bits === 0n ? 0n : ((1n << 128n) - 1n) ^ ((1n << (128n - bits)) - 1n);
    return (ipv6ToBigInt(ip) & mask) === (ipv6ToBigInt(range) & mask);
  }
  return false;
}

export function isAllowedAddress(remote, networks) {
  if (!remote) return false;
  const ip = remote.startsWith('::ffff:') && net.isIPv4(remote.slice(7)) ? remote.slice(7) : remote;
  return networks.some((c) => ipInCidr(ip, c));
}

// ---- Rate limiting ------------------------------------------------------------
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  check(key, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      throw new StudioError('rate_limited', `Rate limit exceeded for ${key}`, { status: 429 });
    }
    recent.push(now);
    this.hits.set(key, recent);
  }
}
