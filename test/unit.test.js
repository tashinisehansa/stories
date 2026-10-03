import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paragraphs, wordCount, slugify, readingTimeMinutes } from '../src/core/text.js';
import { assertStoryId, assertSlug, assertPublishPath, scanPrivateInfo, isAllowedAddress, RateLimiter } from '../src/core/safety.js';
import { canTransition, S } from '../src/core/states.js';
import { parseReview, extractJson, findLoose } from '../src/core/review.js';
import { mockReviewFor } from '../src/core/providers/mock.js';

test('paragraphs split on any newline and drop blanks', () => {
  assert.deepEqual(paragraphs('One.\n\n  Two.\r\nThree.\n'), ['One.', 'Two.', 'Three.']);
  assert.deepEqual(paragraphs(''), []);
});

test('wordCount and reading time', () => {
  assert.equal(wordCount("Maya's dragon flew — fast! 123"), 5);
  assert.equal(wordCount(''), 0);
  assert.equal(readingTimeMinutes('word '.repeat(10)), 1);
  assert.equal(readingTimeMinutes('word '.repeat(600)), 4);
});

test('slugify makes safe, friendly slugs', () => {
  assert.equal(slugify('The Magic Pencil'), 'magic-pencil');
  assert.equal(slugify('  Café & Dragons!! '), 'cafe-dragons');
  assert.equal(slugify('<script>alert(1)</script>'), 'script-alert-1-script');
  assert.equal(slugify('!!!'), 'story');
  assert.ok(slugify('x'.repeat(200)).length <= 50);
});

test('story ids and slugs are validated', () => {
  assert.equal(assertStoryId('story-20261003abcdef12'), 'story-20261003abcdef12');
  for (const bad of ['../etc/passwd', 'story-', 'STORY-ABCDEF', 'story-abc/def', '', null]) {
    assert.throws(() => assertStoryId(bad), /Invalid story id/);
  }
  assert.equal(assertSlug('magic-pencil'), 'magic-pencil');
  for (const bad of ['-bad', 'bad-', 'Bad', 'a/b', '..', '']) assert.throws(() => assertSlug(bad));
});

test('publisher can only write inside the story site', () => {
  for (const ok of ['site/index.html', 'site/stories.json', 'site/stories/magic-pencil/index.html', 'site/stories/magic-pencil/story.json', 'site/stories/magic-pencil/images/scene-01.webp']) {
    assert.equal(assertPublishPath(ok), ok);
  }
  for (const bad of [
    '.github/workflows/pages.yml',
    'src/server.js',
    'site/assets/js/library.js',
    'site/stories/../../src/x.js',
    'site/stories/magic-pencil/evil.html',
    'site/stories/magic-pencil/images/scene-01.svg',
    'data/secrets.json',
  ]) {
    assert.throws(() => assertPublishPath(bad), /Refusing/);
  }
});

test('private information scan', () => {
  const kinds = (t) => scanPrivateInfo(t).map((f) => f.kind);
  assert.deepEqual(kinds('Call me on 077 123 4567 please'), ['phone number']);
  assert.deepEqual(kinds('mail tashini@example.com'), ['email address']);
  assert.deepEqual(kinds('I live at 42 Galle Road, Colombo'), ['street address']);
  assert.deepEqual(kinds('Visit www.example.com'), ['website or social link']);
  assert.deepEqual(kinds('The dragon was 300 years old and had 12 friends.'), []);
  assert.deepEqual(kinds('In 2026 we went to the park.'), []);
});

test('home network allowlist', () => {
  const nets = ['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'];
  for (const ok of ['127.0.0.1', '192.168.1.44', '::ffff:192.168.1.5', '10.1.2.3', '172.20.0.1', '::1', 'fd12::1', 'fe80::1']) {
    assert.ok(isAllowedAddress(ok, nets), ok);
  }
  for (const bad of ['8.8.8.8', '172.32.0.1', '::ffff:1.2.3.4', '2001:db8::1', '', undefined]) {
    assert.ok(!isAllowedAddress(bad, nets), String(bad));
  }
});

test('rate limiter', () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 1000 });
  rl.check('a', 0);
  rl.check('a', 10);
  assert.throws(() => rl.check('a', 20), /Rate limit/);
  rl.check('a', 1500);
  rl.check('b', 20);
});

test('state machine: every failure is retryable, drafts never jump to published', () => {
  assert.ok(canTransition(S.REVIEW_FAILED, S.REVIEWING));
  assert.ok(canTransition(S.IMAGE_GENERATION_FAILED, S.REVIEWING));
  assert.ok(canTransition(S.PUBLISH_FAILED, S.PUBLISHING));
  assert.ok(!canTransition(S.DRAFT, S.PUBLISHING));
  assert.ok(!canTransition(S.DRAFT, S.PUBLISHED));
  assert.ok(!canTransition(S.REVIEWING, S.PUBLISHING));
});

test('AI review output is validated', () => {
  const good = mockReviewFor({ title: 'T', paragraphs: ['She go home.', 'The end.'] });
  assert.equal(parseReview(JSON.stringify(good)).ok, true);
  assert.equal(parseReview('```json\n' + JSON.stringify(good) + '\n```').ok, true);
  assert.equal(parseReview('Sure! Here it is: ' + JSON.stringify(good)).ok, true);
  assert.equal(parseReview('not json at all').ok, false);
  assert.equal(parseReview('{"summary":"hi"}').ok, false);
  const badType = structuredClone(good);
  badType.grammarSuggestions = [{ original: 'a', suggestion: 'b', explanation: 'c', type: 'rewrite' }];
  assert.equal(parseReview(JSON.stringify(badType)).ok, false);
  const tooManyScenes = structuredClone(good);
  tooManyScenes.scenes = Array.from({ length: 9 }, (_, i) => ({ sceneNumber: 1, description: 'x', imagePrompt: 'y', beforeParagraph: i }));
  assert.equal(parseReview(JSON.stringify(tooManyScenes)).ok, false);
  assert.throws(() => extractJson('nothing'));
});

test('findLoose tolerates whitespace differences', () => {
  assert.deepEqual(findLoose('a  b\nc', 'b c'), { index: 3, length: 3 });
  assert.equal(findLoose('abc', 'xyz'), null);
});
