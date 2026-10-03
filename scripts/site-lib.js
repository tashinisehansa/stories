import fs from 'node:fs/promises';
import path from 'node:path';

export async function readStoryDocs(siteDir) {
  const storiesDir = path.join(siteDir, 'stories');
  let dirs = [];
  try {
    dirs = (await fs.readdir(storiesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  const docs = [];
  for (const d of dirs.sort()) {
    const file = path.join(storiesDir, d, 'story.json');
    try {
      docs.push({ dir: d, doc: JSON.parse(await fs.readFile(file, 'utf8')) });
    } catch (err) {
      docs.push({ dir: d, error: `${file}: ${err.message}` });
    }
  }
  return docs;
}

export async function walk(dir, base = dir) {
  const out = [];
  let items = [];
  try {
    items = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const i of items) {
    const p = path.join(dir, i.name);
    if (i.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
