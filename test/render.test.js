import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyDocument, renderStoryPage, renderLibrary, buildIndex, mergeIndex, escapeHtml } from '../src/core/render.js';

const scene = (id, before, cand = 'cabc123') => ({ id, beforeParagraph: before, selected: cand, description: `Scene ${id}`, candidates: [{ id: cand, width: 1536, height: 1024 }] });
const baseStory = (over = {}) => ({
  title: 'The Magic Pencil',
  author: 'Tashini',
  description: 'A girl finds a magic pencil.',
  content: 'Para one.\nPara two.\nPara three.\nPara four.',
  scenes: [scene('scene-01', 0), scene('scene-02', 2)],
  ...over,
});
const opts = { siteTitle: "Tashini's Story World", siteUrl: 'https://example.github.io/stories/' };

test('storyDocument places pictures before the chosen paragraphs', () => {
  const { doc, images } = storyDocument(baseStory(), { slug: 'magic-pencil', publishedAt: '2026-10-03T10:00:00.000Z' });
  assert.equal(doc.id, 'magic-pencil');
  assert.equal(doc.coverImage, 'images/scene-01.webp');
  assert.deepEqual(
    doc.sections.map((s) => [s.image, s.paragraphs]),
    [
      ['images/scene-01.webp', ['Para one.', 'Para two.']],
      ['images/scene-02.webp', ['Para three.', 'Para four.']],
    ],
  );
  assert.deepEqual(images.map((i) => [i.sceneId, i.path]), [['scene-01', 'images/scene-01.webp'], ['scene-02', 'images/scene-02.webp']]);
});

test('storyDocument handles text before the first picture, no pictures, and unselected scenes', () => {
  const late = storyDocument(baseStory({ scenes: [scene('scene-03', 2)] }), { slug: 's', publishedAt: '2026-10-03T00:00:00Z' }).doc;
  assert.deepEqual(late.sections.map((s) => s.image), [null, 'images/scene-01.webp']);
  assert.deepEqual(late.sections[0].paragraphs, ['Para one.', 'Para two.']);

  const none = storyDocument(baseStory({ scenes: [] }), { slug: 's', publishedAt: '2026-10-03T00:00:00Z' }).doc;
  assert.equal(none.coverImage, null);
  assert.equal(none.sections.length, 1);
  assert.equal(none.sections[0].paragraphs.length, 4);

  const unselected = storyDocument(baseStory({ scenes: [{ ...scene('scene-01', 0), selected: null }] }), { slug: 's', publishedAt: '2026-10-03T00:00:00Z' });
  assert.equal(unselected.images.length, 0);
});

test('story text is escaped — no script injection', () => {
  const evil = baseStory({
    title: '<script>alert("t")</script>',
    description: '"><img src=x onerror=alert(1)>',
    content: '<script>alert(1)</script>\nHello <b>world</b> & "friends"',
    scenes: [{ ...scene('scene-01', 0), description: '" onload="alert(1)' }],
  });
  const { doc } = storyDocument(evil, { slug: 'evil', publishedAt: '2026-10-03T00:00:00Z' });
  const html = renderStoryPage(doc, opts);
  assert.ok(!html.includes('<script>alert'), 'no raw script from story text');
  assert.ok(!html.includes('<b>world</b>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!/alt="[^"]*" onload=/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Content-Security-Policy'));
  const lib = renderLibrary(buildIndex([doc]), opts);
  assert.ok(!lib.includes('<script>alert'));
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('pages use relative links (custom-domain ready) plus absolute OG tags', () => {
  const { doc } = storyDocument(baseStory(), { slug: 'magic-pencil', publishedAt: '2026-10-03T00:00:00Z' });
  const html = renderStoryPage(doc, opts);
  assert.ok(html.includes('href="../../assets/css/site.css"'));
  assert.ok(html.includes('href="../../"'));
  assert.ok(html.includes('src="images/scene-01.webp"'));
  assert.ok(html.includes('<meta property="og:image" content="https://example.github.io/stories/stories/magic-pencil/images/scene-01.webp">'));
  assert.ok(html.includes('<title>The Magic Pencil | Tashini&#39;s Story World</title>'));
  const noSite = renderStoryPage(doc, { ...opts, siteUrl: '' });
  assert.ok(!noSite.includes('og:image'));
  assert.ok(!noSite.includes('github.io'));
});

test('index sorts newest first and hides hidden stories', () => {
  const mk = (id, date, hidden = false) => ({ ...storyDocument(baseStory({ title: id }), { slug: id, publishedAt: date }).doc, hidden });
  const idx = buildIndex([mk('old', '2026-01-01T00:00:00Z'), mk('new', '2026-09-01T00:00:00Z'), mk('secret', '2026-10-01T00:00:00Z', true)]);
  assert.deepEqual(idx.map((e) => e.id), ['new', 'old']);
  assert.equal(idx[0].coverImage, 'stories/new/images/scene-01.webp');
  const merged = mergeIndex(idx, mk('newest', '2026-10-02T00:00:00Z'));
  assert.deepEqual(merged.map((e) => e.id), ['newest', 'new', 'old']);
  assert.deepEqual(mergeIndex(merged, mk('new', '2026-09-01T00:00:00Z', true)).map((e) => e.id), ['newest', 'old']);
  assert.ok(renderLibrary([], opts).includes('The first story is coming soon!'));
});
