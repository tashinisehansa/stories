import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Tiny JSON-file store. Writes are atomic (tmp file + rename) and every
// read-modify-write for a key runs under a per-key promise lock, so the
// autosave, background jobs and agent calls never clobber each other.
export class JsonStore {
  constructor(dir) {
    this.dir = dir;
    this.locks = new Map();
  }

  file(...parts) {
    return path.join(this.dir, ...parts);
  }

  async read(rel, fallback = null) {
    try {
      return JSON.parse(await fs.readFile(this.file(rel), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw err;
    }
  }

  async write(rel, value) {
    const target = this.file(rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value, null, 2));
    await fs.rename(tmp, target);
    return value;
  }

  async writeBuffer(rel, buf) {
    const target = this.file(rel);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, target);
  }

  async readBuffer(rel) {
    return fs.readFile(this.file(rel));
  }

  async remove(rel) {
    await fs.rm(this.file(rel), { recursive: true, force: true });
  }

  async list(relDir) {
    try {
      return await fs.readdir(this.file(relDir));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async withLock(key, fn) {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => (release = r));
    const chained = prev.then(() => next);
    this.locks.set(key, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) this.locks.delete(key);
    }
  }

  // Locked read-modify-write. `fn` receives the current value (or null) and
  // returns the new value; returning undefined leaves the file unchanged.
  async update(rel, fn) {
    return this.withLock(rel, async () => {
      const current = await this.read(rel);
      const next = await fn(current);
      if (next === undefined) return current;
      return this.write(rel, next);
    });
  }
}
