import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { makeStudio, startServer, STORY_TEXT } from './helpers.js';
import { ROOT } from '../src/config.js';

async function setup(t) {
  const { studio, cleanup } = await makeStudio();
  const srv = await startServer(studio);
  t.after(async () => {
    await srv.close();
    await studio.jobs.idle();
    await cleanup();
  });
  return { studio, ...srv };
}

test('studio API: autosave upsert, finish, review, pictures, preview', async (t) => {
  const { request, studio } = await setup(t);
  const id = 'story-20261003cafe0001';
  const saved = await request('PUT', `/api/stories/${id}`, { body: { title: 'The Glowing Door', content: STORY_TEXT } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.status, 'DRAFT');

  const list = await request('GET', '/api/stories');
  assert.equal(list.json.stories[0].id, id);

  const fin = await request('POST', `/api/stories/${id}/finish?wait=30`);
  assert.equal(fin.json.reviewFinished, true);
  await studio.jobs.idle();

  const review = await request('GET', `/api/stories/${id}/review`);
  assert.ok(review.json.grammarSuggestions.length > 0);
  const g = review.json.grammarSuggestions[0];
  const dec = await request('POST', `/api/stories/${id}/suggestions/${g.id}`, { body: { action: 'accept' } });
  assert.equal(dec.json.suggestion.status, 'accepted');

  const story = (await request('GET', `/api/stories/${id}`)).json;
  const sc = story.scenes[0];
  const img = await fetch(`${studio.selfUrl}/api/stories/${id}/images/${sc.id}-${sc.selected}.webp`);
  assert.equal(img.headers.get('content-type'), 'image/webp');

  const preview = await request('GET', `/preview/stories/${id}/`);
  assert.equal(preview.status, 200);
  assert.match(preview.text, /<h1>The Glowing Door<\/h1>/);
  assert.match(preview.text, /noindex/);
  const pimg = await fetch(`${studio.selfUrl}/preview/stories/${id}/images/scene-01.webp`);
  assert.equal(pimg.status, 200);
  const css = await request('GET', '/preview/assets/css/site.css');
  assert.equal(css.status, 200);

  const bad = await request('GET', '/api/stories/..%2F..%2Fsecrets');
  assert.equal(bad.status, 400);
  const traversal = await request('GET', '/../data/secrets.json');
  assert.notEqual(traversal.status, 200);
});

test('friendly errors for children, technical detail only for agents/parents', async (t) => {
  const { request } = await setup(t);
  const child = await request('GET', '/api/stories/story-20261003aaaaaaaa');
  assert.equal(child.status, 404);
  assert.equal(child.json.error.message, "We couldn't find that story.");
  assert.equal(child.json.error.detail, undefined);
  const agent = await request('GET', '/api/stories/story-20261003aaaaaaaa', { token: 'test-agent-token' });
  assert.equal(agent.json.error.detail, 'Story not found');
  const wrongToken = await request('GET', '/api/stories', { token: 'nope' });
  assert.equal(wrongToken.status, 401);
});

test('approval: agents cannot approve; Tashini (studio) can; then agents may publish', async (t) => {
  const { request, studio } = await setup(t);
  const s = await studio.stories.create({ title: 'Agent Story', content: STORY_TEXT });
  await request('POST', `/api/stories/${s.id}/finish?wait=30`, { token: 'test-agent-token' });
  await studio.jobs.idle();

  const pub1 = await request('POST', `/api/stories/${s.id}/publish`, { token: 'test-agent-token', body: { wait: 30 } });
  assert.equal(pub1.status, 409);
  assert.equal(pub1.json.error.code, 'not_approved');

  const agentApprove = await request('POST', `/api/stories/${s.id}/approve`, { token: 'test-agent-token' });
  assert.equal(agentApprove.status, 403);

  const childApprove = await request('POST', `/api/stories/${s.id}/approve`);
  assert.equal(childApprove.json.status, 'READY_TO_PUBLISH');

  const pub2 = await request('POST', `/api/stories/${s.id}/publish`, { token: 'test-agent-token', body: { wait: 30 } });
  assert.equal(pub2.json.status, 'published');
  assert.equal(pub2.json.url, 'https://example.github.io/stories/stories/agent-story/');
});

test('parent pages need the password; tokens never reach the browser', async (t) => {
  const { request, studio } = await setup(t);
  assert.equal((await request('GET', '/api/admin/overview')).status, 403);
  assert.equal((await request('POST', '/api/admin/login', { body: { password: 'wrong' } })).status, 401);
  const login = await request('POST', '/api/admin/login', { body: { password: 'parent-pass' } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const overview = await request('GET', '/api/admin/overview', { cookie });
  assert.equal(overview.status, 200);
  assert.ok(!JSON.stringify(overview.json).includes('test-agent-token'));
  // Deleting is parent-only.
  const s = await studio.stories.create({ title: 'x', content: 'y' });
  assert.equal((await request('DELETE', `/api/stories/${s.id}`)).status, 403);
  assert.equal((await request('DELETE', `/api/stories/${s.id}`, { cookie })).status, 200);

  // Child-facing endpoints and static files never contain secrets.
  for (const url of ['/api/health', '/api/stories', '/api/whoami']) {
    const r = await request('GET', url);
    for (const secret of ['test-agent-token', 'parent-pass', 'ghp_', 'gho_', 'sk-']) assert.ok(!r.text.includes(secret), `${url} leaks ${secret}`);
  }
  for (const f of await fs.readdir(path.join(ROOT, 'studio/js'))) {
    const src = await fs.readFile(path.join(ROOT, 'studio/js', f), 'utf8');
    assert.ok(!/TASHINI_GITHUB_TOKEN|OPENROUTER_API_KEY|OPENAI_API_KEY|api\.github\.com/.test(src), `studio/js/${f} references secrets`);
  }
  const page = await request('GET', '/editor.html');
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
});

test('MCP over HTTP exposes the agent tools', async (t) => {
  const { base, studio } = await setup(t);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer test-agent-token' } },
  });
  await client.connect(transport);
  t.after(() => client.close());
  const { tools } = await client.listTools();
  const names = tools.map((x) => x.name);
  for (const n of ['list_stories', 'create_story', 'finish_story', 'decide_suggestion', 'generate_pictures', 'publish_story', 'wait_for_story']) {
    assert.ok(names.includes(n), n);
  }
  const created = await client.callTool({ name: 'create_story', arguments: { title: 'From an agent', content: STORY_TEXT } });
  const story = JSON.parse(created.content[0].text);
  assert.equal(story.status, 'DRAFT');
  assert.match(story.links.preview, /\/preview\.html\?id=story-/);

  const pub = await client.callTool({ name: 'publish_story', arguments: { story_id: story.id, wait_seconds: 5 } });
  assert.equal(pub.isError, true);
  assert.match(pub.content[0].text, /not_approved/);
  await studio.jobs.idle();

  const noAuth = await fetch(`${base}/mcp`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(noAuth.status, 401);
});

test('feedback API lists checks for the studio and agents', async (t) => {
  const { request, studio } = await setup(t);
  const s = await studio.stories.create({ title: 'FB', content: STORY_TEXT });
  await request('POST', `/api/stories/${s.id}/finish?wait=30`, { body: { autoImages: false } });
  const list = await request('GET', `/api/stories/${s.id}/feedback`);
  assert.equal(list.json.checks.length, 1);
  assert.equal(list.json.story.title, 'FB');
  const one = await request('GET', `/api/stories/${s.id}/feedback/current`, { token: 'test-agent-token' });
  assert.ok(one.json.strengths.length);
  assert.ok((await request('GET', '/api/stories')).json.stories.find((x) => x.id === s.id).hasFeedback);
  assert.equal((await request('GET', '/feedback.html')).status, 200);
});
