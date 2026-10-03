import { get, post } from './api.js';
import { el, setChildren, $, storyIdFromUrl, renderSteps, toast, confirmDialog, poll } from './ui.js';

const id = storyIdFromUrl();
const panel = $('#panel');
let story;

const PROGRESS = ['Preparing story…', 'Creating web page…', 'Saving pictures…', 'Publishing…', 'Almost ready…'];

function reloadFrame() {
  $('#frame').src = `/preview/stories/${id}/?t=${Date.now()}`;
}

function publishButton(label) {
  return el('button', { type: 'button', class: 'btn-big btn-green', onclick: publishFlow }, label);
}

function renderPanel() {
  const busyPictures = story.scenes.some((sc) => ['queued', 'generating'].includes(sc.status));
  const parts = [];
  if (story.status === 'PUBLISHED') {
    parts.push(
      el(
        'div',
        { class: 'card good row' },
        el('span', {}, '📚 This story is published!'),
        el('span', { class: 'spacer' }),
        el('a', { class: 'btn btn-small', href: story.publishedUrl, target: '_blank', rel: 'noopener' }, 'Read Story'),
      ),
    );
  } else if (story.status === 'PUBLISHING') {
    parts.push(el('div', { class: 'card sun row', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Publishing…'));
    poll(async () => {
      story = await get(`/api/stories/${id}`);
      if (story.status === 'PUBLISHING') return false;
      renderPanel();
      return true;
    });
  } else {
    if (story.status === 'PUBLISH_FAILED') {
      parts.push(el('div', { class: 'card oops' }, 'Last time, something went wrong while publishing. Your story is safe — you can try again.'));
    }
    if (busyPictures) {
      parts.push(el('div', { class: 'card sun row', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Some pictures are still being made. You can wait for them, or publish without them.'));
    }
    parts.push(
      el(
        'div',
        { class: 'card sky row' },
        el('span', {}, story.publishedAt ? 'Happy with your changes? Publish the new version!' : 'Does your story look just right?'),
        el('span', { class: 'spacer' }),
        publishButton(story.publishedAt ? '🌟 Publish New Version' : '🌟 Publish Story'),
      ),
    );
  }
  setChildren(panel, ...parts);
}

async function publishFlow() {
  const ok = await confirmDialog({
    title: 'Your story is ready!',
    body: ['It will be added to your story collection so other people can read it.'],
    yes: 'Publish',
    no: 'Go Back',
    yesClass: 'btn-green',
  });
  if (!ok) return;

  const steps = el('ul', { class: 'progress-steps', 'aria-live': 'polite' }, PROGRESS.map((p) => el('li', {}, p)));
  setChildren(panel, el('div', { class: 'card' }, el('div', { class: 'working' }, el('span', { class: 'bounce', 'aria-hidden': 'true' }, '🚀')), steps));
  let step = 0;
  const lis = [...steps.children];
  const tick = () => {
    lis.forEach((li, i) => {
      li.className = i < step ? 'done' : i === step ? 'now' : '';
      li.textContent = `${i < step ? '✓ ' : ''}${PROGRESS[i]}`;
    });
    step = Math.min(step + 1, lis.length - 1);
  };
  tick();
  const timer = setInterval(tick, 1800);

  try {
    // Tashini's "Publish" press is her approval.
    await post(`/api/stories/${id}/approve`);
    const result = await post(`/api/stories/${id}/publish`, { wait: 180 });
    clearInterval(timer);
    if (result.status !== 'published') {
      story = result.story;
      renderPanel();
      return;
    }
    story = result.story;
    celebrate(result.url);
  } catch (err) {
    clearInterval(timer);
    story = await get(`/api/stories/${id}`).catch(() => story);
    renderPanel();
    if (err.code === 'private_info') {
      panel.prepend(
        el(
          'div',
          { class: 'card oops' },
          el('h2', {}, '🔒 Let’s keep you safe'),
          el('p', {}, 'Your story has something that looks like private information. Please take it out before publishing:'),
          el('ul', { class: 'nice' }, (err.details ?? []).map((d) => el('li', {}, `${d.kind}: “${d.match}”`))),
          el('a', { class: 'btn', href: `/editor.html?id=${id}` }, '✏️ Fix my story'),
        ),
      );
    } else {
      toast(err.message, { oops: true, ms: 7000 });
    }
  }
}

function celebrate(url) {
  const live = el('p', { class: 'muted', role: 'status' }, 'Your story will be on the website in a minute or two…');
  setChildren(panel, 
    el(
      'div',
      { class: 'card good celebrate' },
      el('div', { class: 'big', 'aria-hidden': 'true' }, '🎉'),
      el('h2', {}, 'Your story is published!'),
      live,
      el(
        'div',
        { class: 'row center' },
        el('a', { class: 'btn btn-big', href: url, target: '_blank', rel: 'noopener' }, '📖 Read Story'),
        el('a', { class: 'btn btn-soft', href: '/' }, 'View All Stories'),
      ),
    ),
  );
  const started = Date.now();
  poll(async () => {
    const s = await get(`/api/stories/${id}/publish-status`);
    if (s.state === 'live') {
      live.textContent = '✓ It’s live on your story website!';
      return true;
    }
    if (s.state === 'failed') {
      live.textContent = 'The website is taking longer than usual. A grown-up can check the Parent page.';
      return true;
    }
    return Date.now() - started > 10 * 60 * 1000;
  }, 6000);
}

if (!id) location.href = '/';
renderSteps($('#steps'), id, 'preview');
$('#edit-link').href = `/editor.html?id=${id}`;
$('#review-link').href = `/review.html?id=${id}`;
$('#pictures-link').href = `/pictures.html?id=${id}`;
reloadFrame();
(async () => {
  try {
    story = await get(`/api/stories/${id}`);
    $('#heading').textContent = `📖 ${story.title || 'Preview'}`;
    if (story.status === 'DRAFT') {
      setChildren(panel, 
        el('div', { class: 'card sun row' }, el('span', {}, 'This is how your story will look. When you are done writing, press “I’m Finished” so we can check it.'), el('a', { class: 'btn btn-small', href: `/editor.html?id=${id}` }, '✏️ Keep writing')),
      );
      return;
    }
    renderPanel();
  } catch (err) {
    setChildren(panel, el('div', { class: 'card oops' }, err.message));
  }
})();
