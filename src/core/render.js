// Static HTML for the public story site. The studio preview uses exactly the
// same functions, so what Tashini previews is what readers get.
// All story text goes through escapeHtml — never insert raw HTML.
import { paragraphs, wordCount, readingTimeMinutes, firstWords } from './text.js';

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad = (n) => String(n).padStart(2, '0');

export function formatDate(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
}

// Build the public story.json document from a studio story.
// Returns the document and the list of images it needs (studio scene/candidate → public file).
export function storyDocument(story, { slug, publishedAt, updatedAt, author, hidden = false }) {
  const paras = paragraphs(story.content);
  const scenes = (story.scenes ?? [])
    .filter((sc) => sc.selected && sc.candidates?.some((c) => c.id === sc.selected))
    .sort((a, b) => a.beforeParagraph - b.beforeParagraph);

  const images = scenes.map((sc, i) => {
    const cand = sc.candidates.find((c) => c.id === sc.selected);
    return {
      sceneId: sc.id,
      candidateId: cand.id,
      path: `images/scene-${pad(i + 1)}.webp`,
      alt: sc.description || `Picture ${i + 1}`,
      width: cand.width ?? null,
      height: cand.height ?? null,
      beforeParagraph: Math.min(Math.max(0, sc.beforeParagraph), Math.max(0, paras.length - 1)),
    };
  });

  const sections = [];
  let cursor = 0;
  if (!images.length || images[0].beforeParagraph > 0) {
    const end = images.length ? images[0].beforeParagraph : paras.length;
    sections.push({ image: null, paragraphs: paras.slice(0, end) });
    cursor = end;
  }
  images.forEach((img, i) => {
    const end = i + 1 < images.length ? Math.max(img.beforeParagraph, images[i + 1].beforeParagraph) : paras.length;
    const start = Math.max(cursor, img.beforeParagraph);
    const section = { image: img.path, alt: img.alt, paragraphs: paras.slice(start, end) };
    if (img.width && img.height) Object.assign(section, { width: img.width, height: img.height });
    sections.push(section);
    cursor = Math.max(cursor, end);
  });

  const doc = {
    id: slug,
    title: story.title.trim() || 'Untitled Story',
    author: author || story.author || 'Tashini',
    description: (story.description || '').trim() || firstWords(paras.join(' '), 25),
    publishedAt,
    updatedAt: updatedAt ?? publishedAt,
    readingTimeMinutes: readingTimeMinutes(story.content),
    wordCount: wordCount(story.content),
    coverImage: images[0]?.path ?? null,
    coverAlt: images[0]?.alt ?? null,
    hidden: Boolean(hidden),
    sections,
  };
  return { doc, images };
}

const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";

function head({ title, description, siteUrl, pageUrl, imageUrl, assetBase, noindex, type = 'website' }) {
  const abs = (p) => (siteUrl && p ? new URL(p, siteUrl).href : null);
  const url = abs(pageUrl);
  const img = abs(imageUrl);
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    noindex ? '<meta name="robots" content="noindex">' : '',
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}">` : '',
    url ? `<link rel="canonical" href="${escapeHtml(url)}">` : '',
    img ? `<meta property="og:image" content="${escapeHtml(img)}">` : '',
    `<meta name="twitter:card" content="${img ? 'summary_large_image' : 'summary'}">`,
    `<link rel="icon" href="${assetBase}assets/favicon.svg" type="image/svg+xml">`,
    `<link rel="stylesheet" href="${assetBase}assets/css/site.css">`,
  ]
    .filter(Boolean)
    .map((l) => `  ${l}`)
    .join('\n');
}

export function renderStoryPage(doc, { siteTitle, siteUrl = '', preview = false }) {
  const pageTitle = `${doc.title} | ${siteTitle}`;
  const body = doc.sections
    .map((sec) => {
      const parts = [];
      if (sec.image) {
        const dims = sec.width && sec.height ? ` width="${sec.width}" height="${sec.height}"` : '';
        parts.push(
          `      <figure class="illustration"><img src="${escapeHtml(sec.image)}" alt="${escapeHtml(sec.alt)}"${dims} loading="lazy" decoding="async"></figure>`,
        );
      }
      for (const p of sec.paragraphs) parts.push(`      <p>${escapeHtml(p)}</p>`);
      return parts.join('\n');
    })
    .join('\n');
  const meta = [
    `By ${escapeHtml(doc.author)}`,
    doc.publishedAt ? `<time datetime="${escapeHtml(doc.publishedAt)}">${escapeHtml(formatDate(doc.publishedAt))}</time>` : '',
    `${doc.readingTimeMinutes} min read`,
  ]
    .filter(Boolean)
    .join(' <span aria-hidden="true">·</span> ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
${head({
  title: pageTitle,
  description: doc.description,
  siteUrl,
  pageUrl: `stories/${doc.id}/`,
  imageUrl: doc.coverImage ? `stories/${doc.id}/${doc.coverImage}` : null,
  assetBase: '../../',
  noindex: doc.hidden || preview,
  type: 'article',
})}
</head>
<body class="story-page">
  <header class="topbar">
    <a class="back" href="../../">← Back to Stories</a>
  </header>
  <main id="main">
    <article class="story">
      <header class="story-header">
        <h1>${escapeHtml(doc.title)}</h1>
        <p class="byline">${meta}</p>
      </header>
${body}
      <p class="the-end">The End</p>
    </article>
    <nav class="more" aria-label="More stories">
      <a class="button" href="../../">⭐ More Stories</a>
    </nav>
  </main>
  <footer class="site-footer">
    <p>${escapeHtml(siteTitle)}</p>
  </footer>
</body>
</html>
`;
}

export function libraryEntry(doc) {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    author: doc.author,
    publishedAt: doc.publishedAt,
    readingTimeMinutes: doc.readingTimeMinutes,
    wordCount: doc.wordCount,
    coverImage: doc.coverImage ? `stories/${doc.id}/${doc.coverImage}` : null,
    coverAlt: doc.coverAlt ?? null,
  };
}

// Library index: every visible story, newest first.
export function sortEntries(entries) {
  return [...entries].sort(
    (a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
}

export function buildIndex(docs) {
  return sortEntries(docs.filter((d) => !d.hidden).map(libraryEntry));
}

// Replace (or remove, when hidden) one story's entry in an existing index.
export function mergeIndex(entries, doc) {
  const rest = entries.filter((e) => e.id !== doc.id);
  return sortEntries(doc.hidden ? rest : [...rest, libraryEntry(doc)]);
}

export function renderLibrary(entries, { siteTitle, siteUrl = '', authorName = 'Tashini' }) {
  const cards = entries
    .map((e) => {
      const img = e.coverImage
        ? `<img src="${escapeHtml(e.coverImage)}" alt="${escapeHtml(e.coverAlt ?? '')}" loading="lazy" decoding="async">`
        : '<span class="cover-placeholder" aria-hidden="true">📖</span>';
      return `      <li class="story-card" data-published="${escapeHtml(e.publishedAt ?? '')}">
        <a href="stories/${escapeHtml(e.id)}/">
          <span class="cover">${img}</span>
          <span class="card-body">
            <span class="card-title">${escapeHtml(e.title)}</span>
            <span class="card-desc">${escapeHtml(e.description)}</span>
            <span class="card-meta">${escapeHtml(formatDate(e.publishedAt))} · ${e.readingTimeMinutes} min read</span>
            <span class="read-link">Read Story →</span>
          </span>
        </a>
      </li>`;
    })
    .join('\n');
  const empty = '      <li class="empty">The first story is coming soon!</li>';
  return `<!DOCTYPE html>
<html lang="en">
<head>
${head({
  title: siteTitle,
  description: `A collection of stories written by ${authorName}.`,
  siteUrl,
  pageUrl: '',
  imageUrl: entries[0]?.coverImage ?? null,
  assetBase: '',
})}
  <script src="assets/js/library.js" defer></script>
</head>
<body class="library-page">
  <main id="main">
    <header class="library-header">
      <h1>${escapeHtml(siteTitle)}</h1>
      <p class="welcome">Welcome to my collection of stories!</p>
      <div class="sort" hidden>
        <span id="sort-label">Show:</span>
        <button type="button" data-sort="newest" aria-pressed="true">Newest first</button>
        <button type="button" data-sort="oldest" aria-pressed="false">Oldest first</button>
      </div>
    </header>
    <ul class="story-list" aria-label="Stories">
${entries.length ? cards : empty}
    </ul>
  </main>
  <footer class="site-footer">
    <p>Stories written by ${escapeHtml(authorName)}</p>
  </footer>
</body>
</html>
`;
}
