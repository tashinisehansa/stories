import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { createStudio } from '../src/core/studio.js';
import { LocalRepo } from '../src/core/github.js';
import { createMockLlm, createMockImages } from '../src/core/providers/mock.js';
import { createHandler } from '../src/server.js';

export const STORY_TEXT = [
  'Once upon a time Maya found a glowing door in the forest.',
  'She go through the door and saw a tiny green dragon.',
  'The dragon run very fast to the village and Maya ran after him.',
  'They flew above the houses and everyone waved.',
  'At last Maya went home and smiled.',
].join('\n');

export async function tmpDir(prefix = 'ss-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function makeStudio({ llm, imageGen, repo, config: overrides = {} } = {}) {
  const dir = await tmpDir();
  const config = loadConfig({
    dataDir: path.join(dir, 'data'),
    quietLogs: true,
    mockAi: true,
    mockGithub: true,
    adminPassword: 'parent-pass',
    agentToken: 'test-agent-token',
    agentCanApprove: false,
    siteUrl: 'https://example.github.io/stories/',
    ...overrides,
  });
  config.images = { ...config.images, ...(overrides.images ?? {}) };
  const studio = await createStudio(config, {
    llm: llm ?? createMockLlm(),
    imageGen: imageGen ?? createMockImages(),
    repo: repo ?? new LocalRepo(path.join(dir, 'repo')),
  });
  const cleanup = async () => {
    await studio.jobs.idle();
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { studio, dir, config, cleanup };
}

// Create → finish → wait for review + pictures. Returns the story id.
export async function storyWithPictures(studio, { title = 'The Glowing Door', content = STORY_TEXT } = {}) {
  const s = await studio.stories.create({ title, content });
  const { job } = await studio.review.finish(s.id);
  await job;
  await studio.jobs.idle();
  return s.id;
}

export async function startServer(studio) {
  const server = http.createServer(createHandler(studio));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  studio.selfUrl = base;
  const request = async (method, url, { body, token, cookie } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { server, base, request, close: () => new Promise((r) => server.close(r)) };
}
