#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ROOT } from './config.js';
import { createStudio } from './core/studio.js';
import { StudioError, notFound } from './core/errors.js';
import { RateLimiter } from './core/safety.js';
import { publicView } from './core/stories.js';
import { identify, adminCookie, clearAdminCookie, checkAdminPassword } from './auth.js';
import { handleMcpHttp } from './agent/mcp-http.js';

const STUDIO_DIR = path.join(ROOT, 'studio');
const SITE_ASSETS = path.join(ROOT, 'site', 'assets');
const MAX_BODY = 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const STUDIO_CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'";

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readJson(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new StudioError('too_long', 'Request body too large', { status: 413 });
    chunks.push(c);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new StudioError('invalid_input', 'Body must be JSON');
  }
}

async function serveFile(res, baseDir, rel, extraHeaders = {}) {
  const target = path.resolve(baseDir, `.${path.posix.normalize(`/${rel}`)}`);
  if (!target.startsWith(baseDir + path.sep) && target !== baseDir) throw notFound('File');
  let file = target;
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const buf = await fs.readFile(file);
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
    send(res, 200, buf, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extraHeaders });
  } catch {
    throw notFound('File');
  }
}

// Wait for a background job up to `seconds`; agents use this so they don't have to poll.
async function maybeWait(job, seconds) {
  const s = Math.min(Math.max(Number(seconds) || 0, 0), 900);
  if (!s) {
    job.catch(() => {});
    return { finished: false };
  }
  let timer;
  const timeout = new Promise((r) => (timer = setTimeout(() => r({ finished: false }), s * 1000)));
  try {
    return await Promise.race([job.then((result) => ({ finished: true, result })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function buildRoutes(studio) {
  const { stories, review, images, publisher, secrets, config, log } = studio;
  const limiter = new RateLimiter({ limit: config.limits.expensivePerHour, windowMs: 60 * 60 * 1000 });
  const limit = (ctx, what) => limiter.check(`${what}:${ctx.actor === 'agent' ? 'agent' : ctx.remote}`);
  const view = async (id) => publicView(await stories.get(id));
  const parentOnly = (ctx) => {
    if (ctx.actor !== 'parent') throw new StudioError('forbidden', 'Parent login required', { status: 403 });
  };
  const waitSeconds = (ctx) => ctx.query.get('wait') ?? ctx.body.wait;

  const r = (method, pattern, handler) => ({ method, re: new RegExp(`^${pattern}$`), handler });
  return [
    r('GET', '/api/health', () => ({
      ok: true,
      name: 'story-studio',
      review: studio.llm.name === 'mock' ? 'mock' : config.openrouter.apiKey ? 'ready' : 'missing OPENROUTER_API_KEY',
      images: studio.imageGen.name === 'mock' ? 'mock' : config.openai.apiKey ? 'ready' : 'missing OPENAI_API_KEY',
      publishing: config.mockGithub ? 'mock' : config.github.repo,
      siteUrl: config.siteUrl,
    })),
    r('GET', '/api/whoami', (ctx) => ({ actor: ctx.actor, agentCanApprove: config.agentCanApprove })),

    // ---- stories --------------------------------------------------------------
    r('GET', '/api/stories', async () => ({ stories: await stories.list() })),
    r('POST', '/api/stories', async (ctx) => publicView(await stories.create(ctx.body))),
    r('GET', '/api/stories/(?<id>[^/]+)', async (ctx) => view(ctx.params.id)),
    r('PUT', '/api/stories/(?<id>[^/]+)', async (ctx) => publicView(await stories.save(ctx.params.id, ctx.body, { actor: ctx.actor }))),
    r('DELETE', '/api/stories/(?<id>[^/]+)', async (ctx) => {
      parentOnly(ctx);
      await stories.remove(ctx.params.id);
      return { deleted: true };
    }),

    // ---- review ---------------------------------------------------------------
    r('POST', '/api/stories/(?<id>[^/]+)/finish', async (ctx) => {
      limit(ctx, 'review');
      const { job } = await review.finish(ctx.params.id, { autoImages: ctx.body.autoImages !== false });
      const waited = await maybeWait(job, waitSeconds(ctx));
      return { story: await view(ctx.params.id), reviewFinished: waited.finished };
    }),
    r('GET', '/api/stories/(?<id>[^/]+)/review', async (ctx) => review.get(ctx.params.id)),
    r('POST', '/api/stories/(?<id>[^/]+)/suggestions/accept-all', async (ctx) => ({
      results: await review.acceptAll(ctx.params.id),
      story: await view(ctx.params.id),
    })),
    r('POST', '/api/stories/(?<id>[^/]+)/suggestions/(?<sid>[^/]+)', async (ctx) => ({
      ...(await review.decide(ctx.params.id, ctx.params.sid, ctx.body.action)),
      story: await view(ctx.params.id),
    })),
    r('GET', '/api/stories/(?<id>[^/]+)/original', async (ctx) => (await stories.getOriginal(ctx.params.id)) ?? { content: null }),

    // ---- revisions ------------------------------------------------------------
    r('GET', '/api/stories/(?<id>[^/]+)/revisions', async (ctx) => ({ revisions: await stories.listRevisions(ctx.params.id) })),
    r('GET', '/api/stories/(?<id>[^/]+)/revisions/(?<rev>\\d+)', async (ctx) => stories.getRevision(ctx.params.id, ctx.params.rev)),
    r('POST', '/api/stories/(?<id>[^/]+)/revisions/(?<rev>\\d+)/restore', async (ctx) =>
      publicView(await stories.restoreRevision(ctx.params.id, ctx.params.rev)),
    ),

    // ---- pictures -------------------------------------------------------------
    r('POST', '/api/stories/(?<id>[^/]+)/images', async (ctx) => {
      limit(ctx, 'images');
      const { job } = await images.start(ctx.params.id, { sceneIds: ctx.body.sceneIds });
      const waited = await maybeWait(job, waitSeconds(ctx));
      return { story: await view(ctx.params.id), imagesFinished: waited.finished };
    }),
    r('POST', '/api/stories/(?<id>[^/]+)/scenes', async (ctx) => publicView(await images.addScene(ctx.params.id, ctx.body))),
    r('PATCH', '/api/stories/(?<id>[^/]+)/scenes/(?<sid>scene-\\d{2})', async (ctx) => {
      const { selected, ...rest } = ctx.body;
      if (selected !== undefined) await images.select(ctx.params.id, ctx.params.sid, selected);
      if (Object.keys(rest).length) await images.updateScene(ctx.params.id, ctx.params.sid, rest);
      return view(ctx.params.id);
    }),
    r('DELETE', '/api/stories/(?<id>[^/]+)/scenes/(?<sid>scene-\\d{2})', async (ctx) =>
      publicView(await images.removeScene(ctx.params.id, ctx.params.sid)),
    ),
    r('GET', '/api/stories/(?<id>[^/]+)/images/(?<file>[^/]+)', async (ctx) => {
      const buf = await images.readCandidate(ctx.params.id, ctx.params.file);
      send(ctx.res, 200, buf, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' });
    }),

    // ---- approval & publishing -----------------------------------------------
    r('POST', '/api/stories/(?<id>[^/]+)/approve', async (ctx) => {
      if (ctx.actor === 'agent' && !config.agentCanApprove) {
        throw new StudioError('forbidden', 'Agents cannot approve stories. Tashini approves in the Story Studio preview.', { status: 403 });
      }
      return publicView(await stories.approve(ctx.params.id, { by: ctx.actor === 'studio' ? 'tashini' : ctx.actor }));
    }),
    r('POST', '/api/stories/(?<id>[^/]+)/unapprove', async (ctx) => {
      const s = await stories.get(ctx.params.id);
      if (s.status !== 'READY_TO_PUBLISH') return publicView(s);
      return publicView(await stories.setStatus(ctx.params.id, 'REVIEWING', { approvedAt: null }));
    }),
    r('POST', '/api/stories/(?<id>[^/]+)/publish', async (ctx) => {
      limit(ctx, 'publish');
      const isParent = ctx.actor === 'parent';
      const job = publisher.publish(ctx.params.id, {
        actor: ctx.actor,
        override: isParent && ctx.body.override === true,
        allowPrivateInfo: isParent && ctx.body.allowPrivateInfo === true,
      });
      const waited = await maybeWait(job, waitSeconds(ctx) ?? 120);
      if (waited.finished) {
        const { story, ...rest } = waited.result;
        return { ...rest, story: publicView(story) };
      }
      return { status: 'publishing', story: await view(ctx.params.id) };
    }),
    r('GET', '/api/stories/(?<id>[^/]+)/publish-status', async (ctx) => publisher.deploymentStatus(ctx.params.id)),
    r('POST', '/api/stories/(?<id>[^/]+)/hide', async (ctx) => {
      parentOnly(ctx);
      return publicView(await publisher.setHidden(ctx.params.id, ctx.body.hidden !== false));
    }),
    r('POST', '/api/stories/(?<id>[^/]+)/unpublish', async (ctx) => {
      parentOnly(ctx);
      return publicView(await publisher.unpublish(ctx.params.id));
    }),

    // ---- preview (mirrors the public site layout) ----------------------------
    r('GET', '/preview/stories/(?<id>[^/]+)/', async (ctx) => {
      const { html } = await publisher.preview(ctx.params.id);
      send(ctx.res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
    }),
    r('GET', '/preview/stories/(?<id>[^/]+)', async (ctx) => {
      send(ctx.res, 301, '', { Location: `/preview/stories/${encodeURIComponent(ctx.params.id)}/` });
    }),
    r('GET', '/preview/stories/(?<id>[^/]+)/images/(?<name>scene-\\d{2}\\.webp)', async (ctx) => {
      const buf = await publisher.previewImage(ctx.params.id, ctx.params.name);
      if (!buf) throw notFound('Picture');
      send(ctx.res, 200, buf, { 'Content-Type': 'image/webp' });
    }),
    r('GET', '/preview/assets/(?<rest>.+)', async (ctx) => serveFile(ctx.res, SITE_ASSETS, ctx.params.rest)),
    r('GET', '/preview/?', async (ctx) => send(ctx.res, 302, '', { Location: '/' })),

    // ---- parent / admin -------------------------------------------------------
    r('POST', '/api/admin/login', async (ctx) => {
      limiter.check(`login:${ctx.remote}`);
      if (!checkAdminPassword(secrets, ctx.body.password)) {
        log.warn('admin.login_failed', { remote: ctx.remote });
        throw new StudioError('unauthorized', 'Wrong password', { status: 401, friendly: 'That password is not right.' });
      }
      log.info('admin.login', { remote: ctx.remote });
      send(ctx.res, 200, { ok: true }, { 'Set-Cookie': adminCookie(secrets.sessionSecret) });
    }),
    r('POST', '/api/admin/logout', async (ctx) => send(ctx.res, 200, { ok: true }, { 'Set-Cookie': clearAdminCookie })),
    r('GET', '/api/admin/overview', async (ctx) => {
      parentOnly(ctx);
      return {
        stories: await stories.list(),
        usage: await studio.store.read('usage.json', {}),
        settings: {
          reviewModel: `${studio.llm.name}:${studio.llm.model}`,
          imageModel: `${studio.imageGen.name}:${studio.imageGen.model}`,
          imageCandidatesPerScene: config.images.candidatesPerScene,
          imageDailyLimit: config.images.dailyLimit,
          repo: config.mockGithub ? 'mock (local folder)' : `${config.github.repo}@${config.github.branch}`,
          siteUrl: config.siteUrl,
          agentCanApprove: config.agentCanApprove,
          agentTokenFromEnv: secrets.agentTokenFromEnv,
          adminPasswordFromEnv: secrets.adminPasswordFromEnv,
          installPath: ROOT,
        },
      };
    }),
    r('GET', '/api/admin/logs', async (ctx) => {
      parentOnly(ctx);
      return { logs: log.tail(Number(ctx.query.get('n')) || 200) };
    }),
    r('GET', '/api/admin/agent-token', async (ctx) => {
      parentOnly(ctx);
      return { token: secrets.agentToken, fromEnv: secrets.agentTokenFromEnv };
    }),
    r('POST', '/api/admin/agent-token/rotate', async (ctx) => {
      parentOnly(ctx);
      if (secrets.agentTokenFromEnv) throw new StudioError('invalid_state', 'AGENT_TOKEN is set in .env; change it there', { status: 409 });
      log.info('admin.agent_token_rotated');
      return { token: await secrets.rotateAgentToken() };
    }),
  ];
}

export function createHandler(studio) {
  const routes = buildRoutes(studio);
  const { config, log, secrets } = studio;

  return async function handler(req, res) {
    let ctx;
    try {
      const url = new URL(req.url, 'http://studio.local');
      const who = identify(req, { secrets, config });
      ctx = { req, res, query: url.searchParams, ...who, body: {} };

      if (url.pathname === '/mcp') {
        if (who.actor !== 'agent') throw new StudioError('unauthorized', 'MCP needs the agent token', { status: 401 });
        return await handleMcpHttp(req, res, studio);
      }

      for (const route of routes) {
        if (route.method !== req.method && !(req.method === 'HEAD' && route.method === 'GET')) continue;
        const m = route.re.exec(url.pathname);
        if (!m) continue;
        ctx.params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
        ctx.body = await readJson(req);
        const out = await route.handler(ctx);
        if (!res.headersSent) send(res, 200, out ?? { ok: true });
        return;
      }
      if (url.pathname.startsWith('/api/')) throw notFound('Endpoint');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new StudioError('invalid_input', 'Method not allowed', { status: 405 });
      await serveFile(res, STUDIO_DIR, url.pathname === '/' ? 'index.html' : url.pathname, { 'Content-Security-Policy': STUDIO_CSP });
    } catch (err) {
      const status = err instanceof StudioError ? err.status : 500;
      if (status >= 500) log.error('http.error', { method: req.method, url: req.url, err });
      else if (status !== 404) log.warn('http.refused', { method: req.method, url: req.url, code: err.code, message: err.message });
      const showDetail = ctx && ctx.actor !== 'studio';
      send(res, status, {
        error: {
          code: err.code ?? 'internal',
          message: err.friendly ?? 'Something went wrong. Your writing is safe. Please try again.',
          ...(showDetail ? { detail: err.message, details: err.details } : {}),
          ...(err.code === 'private_info' ? { details: err.details } : {}),
        },
      });
    }
  };
}

export async function startServer(config = loadConfig()) {
  const studio = await createStudio(config);
  const server = http.createServer(createHandler(studio));
  server.requestTimeout = 16 * 60 * 1000; // agents may wait for picture generation
  server.headersTimeout = 60 * 1000;
  await new Promise((resolve) => server.listen(config.port, config.host, resolve));
  const port = server.address().port;
  studio.selfUrl = `http://127.0.0.1:${port}`;
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
  studio.log.info('server.started', { host: config.host, port, mockAi: config.mockAi, mockGithub: config.mockGithub });
  if (!config.quietLogs) {
    console.log(`\n  📚 Story Studio is running`);
    console.log(`     This computer: http://localhost:${port}`);
    for (const u of lan) console.log(`     Home network:  ${u}`);
    console.log(`     Parent page:   /admin.html`);
    if (!studio.secrets.adminPasswordFromEnv) console.log(`     (Parent password is in data/secrets.json — set ADMIN_PASSWORD in .env to choose your own)`);
    console.log('');
  }
  return { server, studio, port };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, studio } = await startServer();
  const stop = async () => {
    server.close();
    await Promise.race([studio.jobs.idle(), new Promise((r) => setTimeout(r, 5000))]);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
