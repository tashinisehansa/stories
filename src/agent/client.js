import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';

// HTTP client for the running Story Studio server. The CLI and the MCP
// servers go through the REST API so there is exactly one writer of data/.
export function studioClient({ baseUrl, token } = {}) {
  const config = loadConfig();
  baseUrl ??= process.env.STUDIO_URL || `http://127.0.0.1:${config.port}`;
  token ??= process.env.AGENT_TOKEN || readLocalToken(config.dataDir);
  baseUrl = baseUrl.replace(/\/$/, '');

  async function request(method, url, body) {
    let res;
    try {
      res = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(16 * 60 * 1000),
      });
    } catch (err) {
      throw new Error(`Story Studio is not reachable at ${baseUrl} (${err.cause?.code ?? err.message}). Start it with "npm start" in the stories repo.`);
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const e = data.error ?? {};
      const err = new Error(`${e.message ?? `HTTP ${res.status}`}${e.detail && e.detail !== e.message ? ` (${e.detail})` : ''}`);
      err.status = res.status;
      err.code = e.code;
      err.details = e.details;
      throw err;
    }
    return data;
  }

  return {
    baseUrl,
    // Links for people (e.g. Tashini's tablet) should use the home-network address, not localhost.
    linkBase: (process.env.STUDIO_PUBLIC_URL || lanUrl(baseUrl)).replace(/\/$/, ''),
    hasToken: Boolean(token),
    get: (u) => request('GET', u),
    post: (u, b = {}) => request('POST', u, b),
    put: (u, b = {}) => request('PUT', u, b),
    patch: (u, b = {}) => request('PATCH', u, b),
    del: (u) => request('DELETE', u),
  };
}

function readLocalToken(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8')).agentToken;
  } catch {
    return undefined;
  }
}

function lanUrl(baseUrl) {
  const u = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) return baseUrl;
  const ip = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(i.address));
  return ip ? `${u.protocol}//${ip.address}:${u.port}` : baseUrl;
}
