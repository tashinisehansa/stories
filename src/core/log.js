import fs from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;

// JSON-lines logger. Technical details live here (and on the admin page),
// never in child-facing messages.
export function createLogger(dir, { quiet = false } = {}) {
  const file = dir ? path.join(dir, 'app.log') : null;
  if (file) fs.mkdirSync(dir, { recursive: true });

  function write(level, event, data = {}) {
    const entry = { at: new Date().toISOString(), level, event, ...serialize(data) };
    if (file) {
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
        fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
      } catch {
        // logging must never break the app
      }
    }
    if (!quiet && (level !== 'debug' || process.env.DEBUG)) {
      const extra = Object.keys(data).length ? ` ${JSON.stringify(serialize(data))}` : '';
      (level === 'error' ? console.error : console.log)(`[${level}] ${event}${extra}`);
    }
  }

  return {
    debug: (e, d) => write('debug', e, d),
    info: (e, d) => write('info', e, d),
    warn: (e, d) => write('warn', e, d),
    error: (e, d) => write('error', e, d),
    tail(n = 200) {
      if (!file || !fs.existsSync(file)) return [];
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      return lines
        .slice(-n)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { raw: l };
          }
        })
        .reverse();
    },
  };
}

function serialize(data) {
  const out = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    out[k] = v instanceof Error ? { message: v.message, code: v.code, stack: v.stack?.split('\n').slice(0, 4).join(' | ') } : v;
  }
  return out;
}
