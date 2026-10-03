import { get, post, patch, del } from './api.js';
import { el, $, storyIdFromUrl, renderSteps, toast, poll, paragraphs, confirmDialog, excerpt } from './ui.js';

const id = storyIdFromUrl();
const main = $('#main');
let story;
let stopPoll = null;
const editing = new Set(); // scenes whose description box is being edited (don't clobber while typing)

const busy = (s) => s.scenes.some((sc) => ['queued', 'generating'].includes(sc.status)) || s.review?.status === 'running';

function placementSelect(scene, paras) {
  const select = el(
    'select',
    { id: `place-${scene.id}` },
    paras.map((p, i) => el('option', { value: String(i), selected: i === scene.beforeParagraph ? true : null }, `Before part ${i + 1}: “${excerpt(p)}”`)),
  );
  select.addEventListener('change', () => update(scene, { beforeParagraph: Number(select.value) }));
  return el('div', { class: 'field' }, el('label', { for: `place-${scene.id}` }, 'Where should this picture go?'), select);
}

function sceneCard(scene, index, paras) {
  const working = ['queued', 'generating'].includes(scene.status);
  const desc = el('textarea', { id: `desc-${scene.id}`, rows: '2', maxlength: '500' });
  desc.value = scene.description;
  desc.addEventListener('focus', () => editing.add(scene.id));
  desc.addEventListener('blur', () => {
    editing.delete(scene.id);
    if (desc.value.trim() && desc.value !== scene.description) update(scene, { description: desc.value });
  });

  let pics;
  if (scene.candidates.length) {
    pics = el(
      'div',
      { class: 'candidates', role: 'group', 'aria-label': `Pictures for scene ${index + 1}` },
      scene.candidates.map((c, i) =>
        el(
          'button',
          {
            type: 'button',
            class: 'candidate',
            'aria-pressed': String(scene.selected === c.id),
            'aria-label': `Picture ${String.fromCharCode(65 + i)}${scene.selected === c.id ? ' (chosen)' : ''}`,
            onclick: () => update(scene, { selected: c.id }),
          },
          el('img', { src: `/api/stories/${id}/images/${scene.id}-${c.id}.webp`, alt: `${scene.description} (picture ${String.fromCharCode(65 + i)})`, loading: 'lazy' }),
          el('span', { class: 'tick' }, '✓ Chosen'),
        ),
      ),
    );
  } else if (working) {
    pics = el('div', { class: 'placeholder-pic' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', {}, 'Creating pictures…'));
  } else if (scene.status === 'failed') {
    pics = el('div', { class: 'placeholder-pic' }, el('span', {}, `😕 ${scene.error ?? "We couldn't make this picture."}`));
  } else {
    pics = el('div', { class: 'placeholder-pic' }, el('span', {}, 'No picture yet.'));
  }

  return el(
    'section',
    { class: 'card scene', 'aria-labelledby': `h-${scene.id}` },
    el('h2', { id: `h-${scene.id}` }, `Picture ${index + 1}`),
    el('div', { class: 'field' }, el('label', { for: `desc-${scene.id}` }, 'What does this picture show?'), desc),
    pics,
    scene.candidates.length ? el('p', { class: 'muted' }, 'Choose the picture you like best.') : null,
    working && scene.candidates.length ? el('p', { class: 'row' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Making new pictures…') : null,
    placementSelect(scene, paras),
    el(
      'div',
      { class: 'row' },
      el('button', { type: 'button', class: 'btn-sky', disabled: working ? true : null, onclick: () => regenerate(scene) }, scene.candidates.length ? '🔄 Generate Again' : '🎨 Make Pictures'),
      scene.selected ? el('button', { type: 'button', class: 'btn-soft btn-small', onclick: () => update(scene, { selected: null }) }, 'No picture here') : null,
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'btn-link', onclick: () => removeScene(scene) }, 'Remove'),
    ),
  );
}

function addSceneForm(paras) {
  const desc = el('textarea', { id: 'new-desc', rows: '2', maxlength: '500', placeholder: 'e.g. Maya and the dragon flying over the village at sunset' });
  const place = el('select', { id: 'new-place' }, paras.map((p, i) => el('option', { value: String(i) }, `Before part ${i + 1}: “${excerpt(p)}”`)));
  return el(
    'details',
    { class: 'card soft' },
    el('summary', {}, '➕ Add another picture'),
    el('div', { class: 'field' }, el('label', { for: 'new-desc' }, 'What should the picture show?'), desc),
    el('div', { class: 'field' }, el('label', { for: 'new-place' }, 'Where should it go?'), place),
    el(
      'button',
      {
        type: 'button',
        onclick: async () => {
          if (!desc.value.trim()) return toast('Tell us what the picture should show.');
          try {
            const before = new Set(story.scenes.map((s) => s.id));
            story = await post(`/api/stories/${id}/scenes`, { description: desc.value, beforeParagraph: Number(place.value) });
            const added = story.scenes.find((s) => !before.has(s.id));
            await post(`/api/stories/${id}/images`, { sceneIds: [added.id] });
            watch();
          } catch (err) {
            toast(err.message, { oops: true });
          }
        },
      },
      '🎨 Add and draw it',
    ),
  );
}

function render() {
  const paras = paragraphs(story.content);
  if (!story.scenes.length) {
    main.replaceChildren(
      el('h1', {}, '🎨 Pictures'),
      el(
        'div',
        { class: 'card' },
        story.review?.status === 'running'
          ? el('p', { class: 'row' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'We are still reading your story to find the best moments for pictures…')
          : el('p', {}, 'Once your story has been checked, we will find the best moments for pictures. You can also add your own!'),
      ),
      paras.length ? addSceneForm(paras) : null,
      nav(),
    );
    return;
  }
  const anyBusy = busy(story);
  main.replaceChildren(
    el('h1', {}, `🎨 Pictures for “${story.title || 'my story'}”`),
    anyBusy
      ? el('div', { class: 'card sun row', role: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Creating pictures… this can take a minute or two.')
      : el('p', { class: 'muted' }, 'Pick your favourite picture for each part of the story. You can change what a picture shows and make it again.'),
    ...story.scenes.map((sc, i) => sceneCard(sc, i, paras)),
    story.scenes.length < 5 ? addSceneForm(paras) : null,
    nav(),
  );
}

function nav() {
  return el(
    'div',
    { class: 'row' },
    el('a', { class: 'btn btn-soft', href: `/review.html?id=${id}` }, '← Back to checking'),
    el('span', { class: 'spacer' }),
    el('a', { class: 'btn btn-big', href: `/preview.html?id=${id}` }, '📖 Next: Preview →'),
  );
}

async function update(scene, body) {
  try {
    story = await patch(`/api/stories/${id}/scenes/${scene.id}`, body);
    if (body.description) {
      const again = await confirmDialog({
        title: 'Make new pictures?',
        body: ['You changed what this picture shows. Shall we draw it again?'],
        yes: '🎨 Yes, draw it',
        no: 'Not now',
      });
      if (again) return regenerate(scene);
    }
    render();
  } catch (err) {
    toast(err.message, { oops: true });
  }
}

async function regenerate(scene) {
  try {
    const r = await post(`/api/stories/${id}/images`, { sceneIds: [scene.id] });
    story = r.story;
    watch();
  } catch (err) {
    toast(err.message, { oops: true });
  }
}

async function removeScene(scene) {
  const ok = await confirmDialog({ title: 'Remove this picture?', body: ['This part of the story will have no picture.'], yes: 'Remove' });
  if (!ok) return;
  try {
    story = await del(`/api/stories/${id}/scenes/${scene.id}`);
    render();
  } catch (err) {
    toast(err.message, { oops: true });
  }
}

function watch() {
  stopPoll?.();
  stopPoll = poll(async () => {
    const fresh = await get(`/api/stories/${id}`);
    const changed = JSON.stringify(fresh.scenes) !== JSON.stringify(story?.scenes) || fresh.review?.status !== story?.review?.status;
    story = fresh;
    if (changed && !editing.size) render();
    return !busy(story);
  }, 3000);
}

if (!id) location.href = '/';
renderSteps($('#steps'), id, 'pictures');
(async () => {
  try {
    story = await get(`/api/stories/${id}`);
    render();
    if (busy(story)) watch();
  } catch (err) {
    main.replaceChildren(el('div', { class: 'card oops' }, err.message));
  }
})();
