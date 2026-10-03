// Newest/oldest toggle for the story library. The page works without JavaScript
// (newest first); this only reorders the cards.
document.addEventListener('DOMContentLoaded', () => {
  const list = document.querySelector('.story-list');
  const sort = document.querySelector('.sort');
  if (!list || !sort || list.querySelectorAll('.story-card').length < 2) return;
  sort.hidden = false;
  const KEY = 'story-sort';
  const apply = (order) => {
    const cards = [...list.querySelectorAll('.story-card')];
    cards.sort((a, b) => {
      const cmp = a.dataset.published.localeCompare(b.dataset.published);
      return order === 'oldest' ? cmp : -cmp;
    });
    cards.forEach((c) => list.appendChild(c));
    sort.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sort === order)));
    try {
      localStorage.setItem(KEY, order);
    } catch {
      /* storage may be unavailable */
    }
  };
  sort.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-sort]');
    if (btn) apply(btn.dataset.sort);
  });
  let saved = 'newest';
  try {
    saved = localStorage.getItem(KEY) || 'newest';
  } catch {
    /* ignore */
  }
  if (saved !== 'newest') apply(saved);
});
