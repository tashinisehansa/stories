#!/usr/bin/env node
// Regenerate site/stories.json and site/index.html from every site/stories/*/story.json.
// --pages also re-renders each story page (use after changing templates or SITE_URL).
// Usage: node scripts/rebuild-index.js [siteDir] [--pages]
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.js';
import { buildIndex, renderLibrary, renderStoryPage } from '../src/core/render.js';
import { readStoryDocs } from './site-lib.js';

const args = process.argv.slice(2);
const siteDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(ROOT, 'site'));
const config = loadConfig();
const opts = { siteTitle: config.siteTitle, siteUrl: config.siteUrl, authorName: config.authorName };

const docs = await readStoryDocs(siteDir);
const bad = docs.filter((d) => d.error);
if (bad.length) {
  for (const b of bad) console.error(b.error);
  process.exit(1);
}
const entries = buildIndex(docs.map((d) => d.doc));
await fs.writeFile(path.join(siteDir, 'stories.json'), `${JSON.stringify({ generatedBy: 'story-studio', stories: entries }, null, 2)}\n`);
await fs.writeFile(path.join(siteDir, 'index.html'), renderLibrary(entries, opts));
if (args.includes('--pages')) {
  for (const { dir, doc } of docs) await fs.writeFile(path.join(siteDir, 'stories', dir, 'index.html'), renderStoryPage(doc, opts));
}
console.log(`Rebuilt index with ${entries.length} visible stories (${docs.length} total)${args.includes('--pages') ? ' and story pages' : ''}.`);
