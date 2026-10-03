import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeStudio, storyWithPictures, STORY_TEXT } from './helpers.js';
import { createMockLlm, createMockImages } from '../src/core/providers/mock.js';
import { LocalRepo } from '../src/core/github.js';
import { ROOT } from '../src/config.js';

const exec = promisify(execFile);

test('drafts: create, autosave revisions, conflict keeps a copy, restore', async (t) => {
  const { studio, cleanup } = await makeStudio();
  t.after(cleanup);
  const { stories } = studio;
  const s = await stories.create({ title: 'Draft', content: 'Hello' });
  assert.equal(s.status, 'DRAFT');
  assert.equal(s.revision, 1);

  const a = await stories.save(s.id, { content: 'Hello world', baseRevision: 1 });
  assert.equal(a.revision, 2);
  // Same text again is a no-op.
  assert.equal((await stories.save(s.id, { content: 'Hello world', baseRevision: 2 })).revision, 2);

  // Another device saves from an old revision: the newer server copy is kept as a snapshot.
  const b = await stories.save(s.id, { content: 'From the tablet', baseRevision: 1 });
  assert.equal(b.conflictResolved, true);
  assert.equal(b.content, 'From the tablet');
  const revs = await stories.listRevisions(s.id);
  assert.ok(revs.some((r) => r.note.includes('another device')));
  const kept = revs.find((r) => r.note.includes('another device'));
  assert.equal((await stories.getRevision(s.id, kept.revision)).content, 'Hello world');

  const restored = await stories.restoreRevision(s.id, kept.revision);
  assert.equal(restored.content, 'Hello world');

  // Upsert: a draft created offline in the browser is created on first save.
  const offline = await stories.save('story-20261003deadbeef', { title: 'Offline', content: 'Written on the bus' });
  assert.equal(offline.status, 'DRAFT');
  await assert.rejects(stories.save('../../etc', { content: 'x' }), /Invalid story id/);
  await assert.rejects(stories.save(s.id, { content: 'x'.repeat(200_000) }), /longer than/);
});

test('review: suggestions, accept/keep, original preserved, invalid AI rejected', async (t) => {
  const { studio, cleanup } = await makeStudio();
  t.after(cleanup);
  const id = await storyWithPictures(studio);
  const story = await studio.stories.get(id);
  assert.equal(story.status, 'REVIEWING');
  assert.equal(story.review.status, 'done');
  assert.equal(story.review.reviewVersion, 'story-review/1.0');

  const review = await studio.review.get(id);
  assert.ok(review.strengths.length >= 1);
  const go = review.grammarSuggestions.find((g) => g.original.includes('She go'));
  const run = review.grammarSuggestions.find((g) => g.original.includes('dragon run'));
  assert.ok(go && run);

  const accepted = await studio.review.decide(id, go.id, 'accept');
  assert.equal(accepted.applied, true);
  await studio.review.decide(id, run.id, 'keep');
  const after = await studio.stories.get(id);
  assert.ok(after.content.includes('She went through the door'));
  assert.ok(after.content.includes('The dragon run very fast'), 'kept sentence is untouched');
  assert.equal(after.review.pendingSuggestions, review.grammarSuggestions.length - 2);

  // The original text is always available.
  const original = await studio.stories.getOriginal(id);
  assert.equal(original.content, STORY_TEXT);
});

test('review failures are retryable and never corrupt the story', async (t) => {
  const { studio, cleanup } = await makeStudio({ llm: createMockLlm({ invalid: true }) });
  t.after(cleanup);
  const s = await studio.stories.create({ title: 'T', content: STORY_TEXT });
  const { job } = await studio.review.finish(s.id);
  await assert.rejects(job, /validation/);
  const failed = await studio.stories.get(s.id);
  assert.equal(failed.status, 'REVIEW_FAILED');
  assert.equal(failed.content, STORY_TEXT);
  assert.equal(studio.llm.calls, 2, 'one retry with the validation errors');

  studio.review.llm = createMockLlm();
  const retry = await studio.review.finish(s.id);
  await retry.job;
  assert.equal((await studio.stories.get(s.id)).status, 'REVIEWING');
});

test('pictures: generated, selected, regenerated, failures retryable, daily limit', async (t) => {
  const imageGen = createMockImages({ fail: (n) => n === 1 });
  const { studio, cleanup } = await makeStudio({ imageGen });
  t.after(cleanup);
  const id = await storyWithPictures(studio);
  let s = await studio.stories.get(id);
  assert.equal(s.status, 'IMAGE_GENERATION_FAILED', 'first scene failed');
  const failedScene = s.scenes.find((sc) => sc.status === 'failed');
  assert.ok(failedScene);
  assert.ok(s.scenes.some((sc) => sc.status === 'ready' && sc.candidates.length === 2 && sc.selected));

  const { job } = await studio.images.start(id); // retries only failed / empty scenes
  await job;
  s = await studio.stories.get(id);
  assert.equal(s.status, 'REVIEWING');
  assert.ok(s.scenes.every((sc) => sc.status === 'ready' && sc.selected));

  const sc = s.scenes[0];
  await studio.images.select(id, sc.id, sc.candidates[1].id);
  assert.equal((await studio.stories.get(id)).scenes[0].selected, sc.candidates[1].id);
  await assert.rejects(studio.images.select(id, sc.id, 'cffffff'), /not found/);

  const again = await studio.images.start(id, { sceneIds: [sc.id] });
  await again.job;
  assert.equal((await studio.stories.get(id)).scenes[0].candidates.length, 4);

  const buf = await studio.images.readCandidate(id, `${sc.id}-${sc.candidates[0].id}.webp`);
  assert.equal(buf.toString('ascii', 8, 12), 'WEBP');
  await assert.rejects(studio.images.readCandidate(id, '../../secrets.json'), /not found/);

  studio.config.images.dailyLimit = 0;
  const limited = await studio.images.start(id, { sceneIds: [sc.id] });
  await limited.job;
  assert.match((await studio.stories.get(id)).scenes.find((x) => x.id === sc.id).error, /lots of pictures/);
});

test('publish: approval required, one atomic commit, only public files, valid site', async (t) => {
  const { studio, dir, cleanup } = await makeStudio();
  t.after(cleanup);
  const repo = studio.repo;
  const id = await storyWithPictures(studio);

  await assert.rejects(studio.publisher.publish(id, { actor: 'agent' }), /not been approved/);
  await assert.rejects(studio.publisher.publish(id, { actor: 'studio' }), /not been approved/);
  assert.equal(repo.commits.length, 0);

  await studio.stories.approve(id);
  const result = await studio.publisher.publish(id, { actor: 'agent' });
  assert.equal(result.status, 'published');
  assert.equal(result.slug, 'glowing-door');
  assert.equal(result.url, 'https://example.github.io/stories/stories/glowing-door/');
  assert.equal(repo.commits.length, 1, 'story, pictures and index in one commit');
  const commit = repo.commits[0];
  assert.equal(commit.message, 'Add story: The Glowing Door');
  assert.deepEqual(commit.files.sort(), [
    'site/index.html',
    'site/stories.json',
    'site/stories/glowing-door/images/scene-01.webp',
    'site/stories/glowing-door/images/scene-02.webp',
    'site/stories/glowing-door/index.html',
    'site/stories/glowing-door/story.json',
  ]);
  const doc = JSON.parse(await fs.readFile(path.join(dir, 'repo/site/stories/glowing-door/story.json'), 'utf8'));
  const leaked = JSON.stringify(doc);
  for (const secret of ['story-2026', 'review', 'grammar', 'candidates', 'revision', 'approvedAt']) assert.ok(!leaked.includes(secret), `story.json leaks ${secret}`);

  const s = await studio.stories.get(id);
  assert.equal(s.status, 'PUBLISHED');

  // Copy public assets in and run the same validator GitHub Actions runs.
  await fs.cp(path.join(ROOT, 'site/assets'), path.join(dir, 'repo/site/assets'), { recursive: true });
  const { stdout } = await exec(process.execPath, [path.join(ROOT, 'scripts/validate-site.js'), path.join(dir, 'repo/site')]);
  assert.match(stdout, /Site is valid: 1 story/);

  // Editing a published story sends it back for approval; republish updates in place.
  await studio.stories.save(id, { title: 'The Glowing Door', content: `${s.content}\nThe End of the adventure.` });
  assert.equal((await studio.stories.get(id)).status, 'REVIEWING');
  await studio.images.removeScene(id, 'scene-02');
  await studio.stories.approve(id);
  const second = await studio.publisher.publish(id, { actor: 'studio' });
  assert.equal(second.slug, 'glowing-door');
  assert.equal(repo.commits[1].message, 'Update story: The Glowing Door');
  assert.deepEqual(repo.commits[1].deletes, ['site/stories/glowing-door/images/scene-02.webp']);
  const index = JSON.parse(await fs.readFile(path.join(dir, 'repo/site/stories.json'), 'utf8'));
  assert.equal(index.stories.length, 1);

  // A second story with the same title gets its own folder.
  const id2 = await storyWithPictures(studio);
  await studio.stories.approve(id2);
  assert.equal((await studio.publisher.publish(id2)).slug, 'glowing-door-2');

  // Parent tools: hide and remove.
  await studio.publisher.setHidden(id2, true);
  let idx = JSON.parse(await fs.readFile(path.join(dir, 'repo/site/stories.json'), 'utf8'));
  assert.deepEqual(idx.stories.map((e) => e.id), ['glowing-door']);
  await studio.publisher.unpublish(id);
  idx = JSON.parse(await fs.readFile(path.join(dir, 'repo/site/stories.json'), 'utf8'));
  assert.deepEqual(idx.stories, []);
  await assert.rejects(fs.access(path.join(dir, 'repo/site/stories/glowing-door/story.json')));
  assert.equal((await studio.stories.get(id)).status, 'REVIEWING');
});

test('publish: private information blocks publishing; failures are retryable', async (t) => {
  const failing = new LocalRepo('/nonexistent');
  let fail = true;
  const origCommit = failing.commit.bind(failing);
  failing.commit = async (args) => {
    if (fail) throw new Error('GitHub is down');
    return origCommit(args);
  };
  const { studio, dir, cleanup } = await makeStudio({ repo: failing });
  failing.dir = path.join(dir, 'repo');
  t.after(cleanup);

  const pii = await studio.stories.create({ title: 'Call me', content: 'My number is 077 123 4567 and I like cake very much.' });
  await studio.review.finish(pii.id).then((r) => r.job);
  await studio.stories.approve(pii.id);
  await assert.rejects(studio.publisher.publish(pii.id), (err) => err.code === 'private_info' && err.details[0].kind === 'phone number');

  const id = await storyWithPictures(studio);
  await studio.stories.approve(id);
  await assert.rejects(studio.publisher.publish(id), /GitHub is down/);
  assert.equal((await studio.stories.get(id)).status, 'PUBLISH_FAILED');
  fail = false;
  const ok = await studio.publisher.publish(id);
  assert.equal(ok.status, 'published');
});

test('restart recovery turns interrupted work into retryable failures', async (t) => {
  const { studio, config, cleanup } = await makeStudio();
  t.after(cleanup);
  const s = await studio.stories.create({ title: 'T', content: STORY_TEXT });
  await studio.stories.mutate(s.id, (x) => {
    x.status = 'REVIEWING';
    x.review = { status: 'running' };
  });
  const { createStudio } = await import('../src/core/studio.js');
  const again = await createStudio(config, { llm: createMockLlm(), imageGen: createMockImages(), repo: studio.repo });
  const after = await again.stories.get(s.id);
  assert.equal(after.status, 'REVIEW_FAILED');
  assert.equal(after.review.status, 'failed');
});
