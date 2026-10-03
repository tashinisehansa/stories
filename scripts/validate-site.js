#!/usr/bin/env node
// Validates the public site before GitHub Pages deploys it.
// Usage: node scripts/validate-site.js [siteDir]
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { HtmlValidate } from 'html-validate';
import { ROOT } from '../src/config.js';
import { buildIndex } from '../src/core/render.js';
import { SLUG_RE, scanPrivateInfo } from '../src/core/safety.js';
import { readStoryDocs, walk } from './site-lib.js';

const MAX_IMAGE_BYTES = 1024 * 1024;
const siteDir = path.resolve(process.argv[2] ?? path.join(ROOT, 'site'));
const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateStory = ajv.compile(JSON.parse(await fs.readFile(path.join(ROOT, 'schemas/story.schema.json'), 'utf8')));

// 1. Only expected files may be published.
const ALLOWED = [
  /^index\.html$/,
  /^stories\.json$/,
  /^CNAME$/,
  /^\.nojekyll$/,
  /^assets\/(css\/[\w.-]+\.css|js\/[\w.-]+\.js|[\w.-]+\.(svg|png|ico|webp))$/,
  /^stories\/[a-z0-9-]+\/(index\.html|story\.json|images\/scene-\d{2}\.webp)$/,
];
const files = await walk(siteDir);
for (const f of files) if (!ALLOWED.some((re) => re.test(f))) fail(`Unexpected file in site: ${f}`);

// 2. Every story.json matches the schema and its pictures exist and are real webp files.
const docs = await readStoryDocs(siteDir);
for (const { dir, doc, error } of docs) {
  if (error) {
    fail(error);
    continue;
  }
  if (!SLUG_RE.test(dir)) fail(`Bad story folder name: ${dir}`);
  if (!validateStory(doc)) {
    for (const e of validateStory.errors) fail(`stories/${dir}/story.json ${e.instancePath || '/'} ${e.message}`);
    continue;
  }
  if (doc.id !== dir) fail(`stories/${dir}/story.json id "${doc.id}" does not match folder`);
  if (!files.includes(`stories/${dir}/index.html`)) fail(`stories/${dir}/index.html is missing`);
  const images = new Set([doc.coverImage, ...doc.sections.map((s) => s.image)].filter(Boolean));
  for (const img of images) {
    const p = path.join(siteDir, 'stories', dir, img);
    try {
      const buf = await fs.readFile(p);
      if (buf.length > MAX_IMAGE_BYTES) fail(`stories/${dir}/${img} is ${(buf.length / 1024) | 0} KB (max 1024 KB)`);
      if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') fail(`stories/${dir}/${img} is not a webp image`);
    } catch {
      fail(`stories/${dir}/${img} is referenced but missing`);
    }
  }
  for (const f of files.filter((x) => x.startsWith(`stories/${dir}/images/`))) {
    if (!images.has(f.slice(`stories/${dir}/`.length))) warnings.push(`Unused picture: ${f}`);
  }
  const text = [doc.title, doc.description, ...doc.sections.flatMap((s) => s.paragraphs)].join('\n');
  for (const p of scanPrivateInfo(text)) fail(`stories/${dir}: possible private information (${p.kind})`);
}

// 3. The library index must match the stories.
try {
  const index = JSON.parse(await fs.readFile(path.join(siteDir, 'stories.json'), 'utf8'));
  const expected = buildIndex(docs.filter((d) => d.doc).map((d) => d.doc));
  if (JSON.stringify(index.stories) !== JSON.stringify(expected)) {
    fail('site/stories.json is out of date with the story folders. Run: npm run rebuild:index');
  }
} catch (err) {
  fail(`site/stories.json: ${err.message}`);
}

// 4. HTML is valid and contains no scripts other than our own.
const htmlConfig = JSON.parse(await fs.readFile(path.join(ROOT, '.htmlvalidate.json'), 'utf8'));
const htmlValidate = new HtmlValidate({ ...htmlConfig, root: true });
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const p = path.join(siteDir, f);
  const report = await htmlValidate.validateFile(p);
  for (const r of report.results) for (const m of r.messages) fail(`${f}:${m.line}:${m.column} ${m.message} (${m.ruleId})`);
  const html = await fs.readFile(p, 'utf8');
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/^<script src="assets\/js\/library\.js" defer>$/.test(m[0])) fail(`${f}: unexpected script tag ${m[0]}`);
  }
  if (/\son\w+\s*=/i.test(html.replace(/<p>[\s\S]*?<\/p>/g, ''))) fail(`${f}: inline event handler found`);
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  console.error(`\n✗ Site validation failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ Site is valid: ${docs.length} stor${docs.length === 1 ? 'y' : 'ies'}, ${files.length} files.`);
