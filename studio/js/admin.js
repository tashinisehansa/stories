import { get, post, del } from './api.js';
import { el, setChildren, $, toast, confirmDialog, timeAgo } from './ui.js';

const dash = $('#dashboard');
const login = $('#login');

login.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await post('/api/admin/login', { password: $('#password').value });
    $('#password').value = '';
    await load();
  } catch (err) {
    toast(err.message, { oops: true });
  }
});

async function act(label, fn, { confirmText } = {}) {
  if (confirmText && !(await confirmDialog({ title: label, body: [confirmText], yes: label }))) return;
  try {
    await fn();
    toast(`✓ ${label}: done`);
    await load();
  } catch (err) {
    toast(`${label}: ${err.message}`, { oops: true, ms: 8000 });
  }
}

function storyRow(s) {
  const actions = [];
  const btn = (label, fn, opts) => el('button', { type: 'button', class: 'btn-small btn-soft', onclick: () => act(label, fn, opts) }, label);
  actions.push(el('a', { class: 'btn btn-small btn-soft', href: `/preview.html?id=${s.id}` }, 'Open'));
  actions.push(btn('Check again', () => post(`/api/stories/${s.id}/finish`, {})));
  actions.push(btn('Redraw pictures', async () => {
    const st = await get(`/api/stories/${s.id}`);
    await post(`/api/stories/${s.id}/images`, { sceneIds: st.scenes.map((x) => x.id) });
  }));
  if (s.status !== 'PUBLISHED' && s.status !== 'DRAFT') {
    actions.push(
      btn('Publish now', () => post(`/api/stories/${s.id}/publish`, { override: true, wait: 180 }), {
        confirmText: 'Publish this story now, even if Tashini has not pressed Publish herself?',
      }),
    );
  }
  if (s.publishedUrl) {
    actions.push(
      s.hidden
        ? btn('Show on website', () => post(`/api/stories/${s.id}/hide`, { hidden: false }))
        : btn('Hide from library', () => post(`/api/stories/${s.id}/hide`, { hidden: true }), {
            confirmText: 'The story will disappear from the library list, but its page still works for anyone who has the link.',
          }),
    );
    actions.push(btn('Remove from website', () => post(`/api/stories/${s.id}/unpublish`), { confirmText: 'Delete this story’s pages and pictures from the public website? The draft stays here.' }));
  }
  actions.push(btn('Delete', () => del(`/api/stories/${s.id}`), { confirmText: `Delete “${s.title || 'Untitled'}” from Story Studio for good? (Published pages are not removed — use “Remove from website” first.)` }));
  return el(
    'tr',
    {},
    el('td', {}, el('strong', {}, s.title || 'Untitled'), el('div', { class: 'small muted' }, s.id)),
    el(
      'td',
      {},
      s.statusLabel,
      s.hidden ? ' (hidden)' : '',
      s.approved ? el('div', { class: 'small muted' }, 'approved') : null,
      s.lastError ? el('div', { class: 'small', title: s.lastError.message }, `❗ ${s.lastError.message.slice(0, 160)}`) : null,
    ),
    el('td', {}, `${s.wordCount}`),
    el('td', {}, timeAgo(s.updatedAt)),
    el('td', {}, s.publishedUrl ? el('a', { href: s.publishedUrl, target: '_blank', rel: 'noopener' }, 'link') : '—'),
    el('td', {}, el('div', { class: 'row' }, actions)),
  );
}

function agentSection(token, settings) {
  const origin = location.origin;
  const repo = settings.installPath;
  const hermes = `mcp_servers:
  story_studio:
    command: "node"
    args: ["${repo}/src/mcp.js"]
    env:
      STUDIO_URL: "${origin}"
      AGENT_TOKEN: "${token}"
    timeout: 300`;
  const remote = `mcp_servers:
  story_studio:
    url: "${origin}/mcp"
    headers:
      Authorization: "Bearer ${token}"`;
  const tokenText = el('code', {}, '••••••••••••');
  return el(
    'section',
    { class: 'card' },
    el('h2', {}, '🤖 Agents (Hermes, Claude Code, …)'),
    el('p', {}, 'Agents can create drafts, run the review, make pictures and publish stories Tashini has approved. ',
      settings.agentCanApprove ? el('strong', {}, 'AGENT_CAN_APPROVE is ON: agents may approve stories too.') : 'They cannot approve stories themselves.'),
    el(
      'p',
      { class: 'row' },
      'Agent token: ',
      tokenText,
      el('button', { type: 'button', class: 'btn-small btn-soft', onclick: () => (tokenText.textContent = token) }, 'Show'),
      settings.agentTokenFromEnv
        ? el('span', { class: 'small muted' }, '(set in .env)')
        : el('button', { type: 'button', class: 'btn-small btn-soft', onclick: () => act('New agent token', () => post('/api/admin/agent-token/rotate'), { confirmText: 'Agents using the old token will stop working.' }) }, 'Make a new token'),
    ),
    el('p', {}, 'Hermes (local, stdio) — add to ~/.hermes/config.yaml:'),
    el('pre', {}, hermes),
    el('p', {}, 'Any MCP client over the network (Streamable HTTP):'),
    el('pre', {}, remote),
    el('p', {}, 'Shell: ', el('code', {}, `STUDIO_URL=${origin} AGENT_TOKEN=… node src/cli.js list`)),
  );
}

async function load() {
  let overview;
  try {
    overview = await get('/api/admin/overview');
  } catch (err) {
    if (err.status === 403 || err.status === 401) {
      login.hidden = false;
      dash.hidden = true;
      $('#password').focus();
      return;
    }
    toast(err.message, { oops: true });
    return;
  }
  login.hidden = true;
  dash.hidden = false;
  const [{ token }, { logs }] = await Promise.all([get('/api/admin/agent-token'), get('/api/admin/logs?n=150')]);
  const s = overview.settings;
  setChildren(dash, 
    el(
      'section',
      { class: 'card' },
      el('h2', {}, '📚 Stories'),
      el(
        'div',
        { class: 'table-scroll' },
        el(
          'table',
          {},
          el('thead', {}, el('tr', {}, ['Story', 'Status', 'Words', 'Edited', 'Website', 'Actions'].map((h) => el('th', { scope: 'col' }, h)))),
          el('tbody', {}, overview.stories.map(storyRow)),
        ),
      ),
    ),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, '⚙️ Settings'),
      el(
        'ul',
        { class: 'nice' },
        el('li', {}, `Story review AI: ${s.reviewModel}`),
        el('li', {}, `Picture AI: ${s.imageModel} (${s.imageCandidatesPerScene} per scene, ${s.imageDailyLimit} per day; used today: ${overview.usage?.images ?? 0})`),
        el('li', {}, `Publishing to: ${s.repo}`),
        el('li', {}, 'Website: ', el('a', { href: s.siteUrl, target: '_blank', rel: 'noopener' }, s.siteUrl)),
        el('li', {}, s.adminPasswordFromEnv ? 'Parent password: set in .env' : 'Parent password: generated (data/secrets.json). Set ADMIN_PASSWORD in .env to choose your own.'),
      ),
      el('p', { class: 'small muted' }, 'Change settings in the .env file next to the app, then restart Story Studio.'),
    ),
    agentSection(token, s),
    el(
      'section',
      { class: 'card' },
      el('h2', {}, '📝 Recent activity & errors'),
      el(
        'div',
        { class: 'table-scroll' },
        el(
          'table',
          {},
          el('tbody', {}, logs.map((l) => {
            const { at, level, event, ...rest } = l;
            return el('tr', {}, el('td', { class: 'small' }, timeAgo(at)), el('td', {}, level === 'error' ? `❗ ${event}` : event), el('td', { class: 'small' }, el('code', {}, JSON.stringify(rest).slice(0, 400))));
          })),
        ),
      ),
    ),
    el('div', { class: 'row end' }, el('button', { type: 'button', class: 'btn-soft', onclick: async () => { await post('/api/admin/logout'); location.reload(); } }, 'Log out')),
  );
}

load();
