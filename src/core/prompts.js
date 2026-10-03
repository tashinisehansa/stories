import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

const cache = new Map();

// Prompts live in prompts/<name>.md with a `version:` front-matter line.
// The version is stored with every review so results stay traceable.
export function loadPrompt(name) {
  if (cache.has(name)) return cache.get(name);
  const raw = fs.readFileSync(path.join(ROOT, 'prompts', `${name}.md`), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = Object.fromEntries(
    (m ? m[1] : '')
      .split('\n')
      .map((l) => l.split(/:\s*/, 2))
      .filter((p) => p.length === 2),
  );
  const prompt = { version: meta.version ?? name, template: (m ? m[2] : raw).trim() };
  cache.set(name, prompt);
  return prompt;
}

export function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '').toString());
}
