import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StudioError } from './errors.js';
import { assertPublishPath } from './safety.js';

const run = promisify(execFile);

// Token lookup: TASHINI_GITHUB_TOKEN, else the gh CLI login for the configured user.
// The token stays on the server and is never sent to the browser or logged.
export async function resolveGithubToken({ token, user }) {
  if (token) return token;
  try {
    const { stdout } = await run('gh', ['auth', 'token', '--user', user], { timeout: 10_000 });
    const t = stdout.trim();
    if (t) return t;
  } catch {
    // fall through
  }
  throw new StudioError('publish_failed', `No GitHub token: set TASHINI_GITHUB_TOKEN or run "gh auth login" as ${user}`, {
    status: 503,
  });
}

// Writes to the public repo through the Git Data API so that a story, its
// pictures and the updated index land in ONE atomic commit.
export class GitHubRepo {
  constructor({ repo, branch, getToken, fetchImpl = fetch }) {
    this.repo = repo;
    this.branch = branch;
    this.getToken = getToken;
    this.fetch = fetchImpl;
  }

  async api(method, url, body) {
    const token = await this.getToken();
    const res = await this.fetch(`https://api.github.com/repos/${this.repo}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'story-studio',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) {
      const err = new StudioError('publish_failed', `GitHub ${method} ${url} → ${res.status}: ${text.slice(0, 300)}`, { status: 502 });
      err.httpStatus = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  }

  async getFile(p) {
    const f = await this.api('GET', `/contents/${encodeURI(p)}?ref=${encodeURIComponent(this.branch)}`);
    if (!f || Array.isArray(f)) return null;
    if (f.encoding === 'base64' && f.content) return Buffer.from(f.content, 'base64');
    const blob = await this.api('GET', `/git/blobs/${f.sha}`);
    return blob ? Buffer.from(blob.content, 'base64') : null;
  }

  async listDir(p) {
    const items = await this.api('GET', `/contents/${encodeURI(p)}?ref=${encodeURIComponent(this.branch)}`);
    return Array.isArray(items) ? items.map((i) => ({ path: i.path, type: i.type })) : [];
  }

  async listTree(prefix) {
    const ref = await this.api('GET', `/git/ref/heads/${this.branch}`);
    if (!ref) return [];
    const tree = await this.api('GET', `/git/trees/${ref.object.sha}?recursive=1`);
    return (tree?.tree ?? []).filter((t) => t.type === 'blob' && t.path.startsWith(prefix)).map((t) => t.path);
  }

  async commit({ message, files = [], deletes = [] }) {
    for (const f of files) assertPublishPath(f.path);
    for (const d of deletes) assertPublishPath(d);

    const ref = await this.api('GET', `/git/ref/heads/${this.branch}`);
    if (!ref) throw new StudioError('publish_failed', `Branch ${this.branch} not found in ${this.repo}`, { status: 502 });
    const parent = ref.object.sha;
    const parentCommit = await this.api('GET', `/git/commits/${parent}`);

    const tree = [];
    for (const f of files) {
      const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content), 'utf8');
      const blob = await this.api('POST', '/git/blobs', { content: buf.toString('base64'), encoding: 'base64' });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const written = new Set(files.map((f) => f.path));
    for (const d of deletes) if (!written.has(d)) tree.push({ path: d, mode: '100644', type: 'blob', sha: null });

    const newTree = await this.api('POST', '/git/trees', { base_tree: parentCommit.tree.sha, tree });
    const commit = await this.api('POST', '/git/commits', { message, tree: newTree.sha, parents: [parent] });
    try {
      await this.api('PATCH', `/git/refs/heads/${this.branch}`, { sha: commit.sha, force: false });
    } catch (err) {
      if (err.httpStatus === 422 || err.httpStatus === 409) {
        // Someone else pushed in between; the caller rebuilds and retries.
        err.code = 'ref_conflict';
      }
      throw err;
    }
    return { sha: commit.sha, url: commit.html_url ?? `https://github.com/${this.repo}/commit/${commit.sha}` };
  }

  async deployment(sha, workflowFile) {
    const runs = await this.api('GET', `/actions/workflows/${workflowFile}/runs?head_sha=${sha}&per_page=5`);
    const runInfo = runs?.workflow_runs?.[0];
    if (!runInfo) return { state: 'waiting' };
    if (runInfo.status !== 'completed') return { state: 'deploying', url: runInfo.html_url };
    return { state: runInfo.conclusion === 'success' ? 'live' : 'failed', conclusion: runInfo.conclusion, url: runInfo.html_url };
  }
}

// Same interface, backed by a local directory. Used by tests and MOCK_GITHUB=1
// (the directory then looks exactly like the repo: <dir>/site/...).
export class LocalRepo {
  constructor(dir) {
    this.dir = dir;
    this.commits = [];
  }
  abs(p) {
    return path.join(this.dir, p);
  }
  async getFile(p) {
    try {
      return await fs.readFile(this.abs(p));
    } catch {
      return null;
    }
  }
  async listDir(p) {
    try {
      const items = await fs.readdir(this.abs(p), { withFileTypes: true });
      return items.map((i) => ({ path: `${p}/${i.name}`, type: i.isDirectory() ? 'dir' : 'file' }));
    } catch {
      return [];
    }
  }
  async listTree(prefix) {
    const out = [];
    const walk = async (rel) => {
      for (const i of await this.listDir(rel)) {
        if (i.type === 'dir') await walk(i.path);
        else out.push(i.path);
      }
    };
    await walk(prefix.replace(/\/$/, ''));
    return out;
  }
  async commit({ message, files = [], deletes = [] }) {
    for (const f of files) assertPublishPath(f.path);
    for (const d of deletes) assertPublishPath(d);
    const written = new Set(files.map((f) => f.path));
    for (const d of deletes) if (!written.has(d)) await fs.rm(this.abs(d), { force: true });
    for (const f of files) {
      await fs.mkdir(path.dirname(this.abs(f.path)), { recursive: true });
      await fs.writeFile(this.abs(f.path), f.content);
    }
    const sha = crypto.randomBytes(20).toString('hex');
    this.commits.push({ sha, message, files: files.map((f) => f.path), deletes });
    return { sha, url: null };
  }
  async deployment() {
    return { state: 'live' };
  }
}
