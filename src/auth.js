import crypto from 'node:crypto';
import { StudioError } from './core/errors.js';
import { isAllowedAddress } from './core/safety.js';

const ADMIN_COOKIE = 'ss_admin';
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sign(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

export function adminCookie(secret, now = Date.now()) {
  const exp = String(now + ADMIN_TTL_MS);
  return `${ADMIN_COOKIE}=${exp}.${sign(secret, `admin:${exp}`)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ADMIN_TTL_MS / 1000}`;
}

export const clearAdminCookie = `${ADMIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

function isAdminCookieValid(secret, value, now = Date.now()) {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  return Number(exp) > now && safeEqual(sig ?? '', sign(secret, `admin:${exp}`));
}

// Who is calling?
//   agent  — valid bearer AGENT_TOKEN (allowed from any network)
//   parent — valid admin session cookie, from the home network
//   studio — anyone else on the home network (Tashini's browser)
// Anything else is refused.
export function identify(req, { secrets, config }) {
  const auth = req.headers.authorization ?? '';
  const remote = req.socket.remoteAddress;
  const onLan = isAllowedAddress(remote, config.allowedNetworks);
  if (auth.startsWith('Bearer ')) {
    if (safeEqual(auth.slice(7).trim(), secrets.agentToken)) return { actor: 'agent', remote };
    throw new StudioError('unauthorized', 'Invalid agent token', { status: 401 });
  }
  if (!onLan) throw new StudioError('forbidden', `Address ${remote} is not on the home network`, { status: 403 });
  const cookies = parseCookies(req.headers.cookie);
  if (isAdminCookieValid(secrets.sessionSecret, cookies[ADMIN_COOKIE])) return { actor: 'parent', remote };
  return { actor: 'studio', remote };
}

export function checkAdminPassword(secrets, password) {
  return typeof password === 'string' && password.length > 0 && safeEqual(password, secrets.adminPassword);
}
