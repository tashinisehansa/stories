#!/usr/bin/env node
// story-studio CLI — drives a running Story Studio server (any agent with a shell can use it).
// Every MCP tool is available as `story-studio call <tool> '<json args>'`, plus friendly shortcuts.
import fs from 'node:fs';
import { studioClient } from './agent/client.js';
import { toolDefinitions } from './agent/tools.js';

const HELP = `Story Studio CLI

Usage:
  story-studio list                              List stories
  story-studio show <id>                         Show one story
  story-studio new --title "T" [--file f.txt]    Create a draft (text from --file or stdin)
  story-studio update <id> [--title T] [--file f.txt]
  story-studio finish <id> [--wait 120]          AI review (+ pictures afterwards)
  story-studio review <id>                       Show the review
  story-studio accept <id> <suggestion-id>       Use a grammar suggestion
  story-studio keep <id> <suggestion-id>         Keep Tashini's sentence
  story-studio pictures <id> [--scenes scene-01,scene-02] [--wait 300]
  story-studio pick <id> <scene-id> <candidate-id>
  story-studio wait <id> [--seconds 120]
  story-studio links <id>                        Studio links to send to Tashini
  story-studio publish <id> [--wait 120]         Publish (needs Tashini's approval)
  story-studio publish-status <id>
  story-studio status                            Server + services status
  story-studio tools                             List all agent tools and their inputs
  story-studio call <tool> ['{"json":"args"}']   Call any tool directly

Environment: STUDIO_URL (default http://127.0.0.1:4321), AGENT_TOKEN (default: data/secrets.json)
Output is JSON.`;

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else opts[key] = argv[++i];
    } else pos.push(a);
  }
  return { pos, opts };
}

async function readText(opts) {
  if (opts.file) return fs.readFileSync(opts.file, 'utf8');
  if (opts.content) return String(opts.content);
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  }
  return undefined;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opts } = parseArgs(rest);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  const tools = Object.fromEntries(toolDefinitions(studioClient()).map((t) => [t.name, t]));
  const call = (name, args) => tools[name].run(args);
  const num = (v, d) => (v === undefined ? d : Number(v));

  let out;
  switch (cmd) {
    case 'list':
      out = await call('list_stories', {});
      break;
    case 'show':
      out = await call('get_story', { story_id: pos[0] });
      break;
    case 'new':
      out = await call('create_story', { title: opts.title ?? '', content: (await readText(opts)) ?? '' });
      break;
    case 'update': {
      const content = await readText(opts);
      out = await call('update_story', {
        story_id: pos[0],
        ...(opts.title !== undefined ? { title: String(opts.title) } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(opts.description !== undefined ? { description: String(opts.description) } : {}),
      });
      break;
    }
    case 'finish':
      out = await call('finish_story', { story_id: pos[0], wait_seconds: num(opts.wait, 180), make_pictures: !opts['no-pictures'] });
      break;
    case 'review':
      out = await call('get_review', { story_id: pos[0] });
      break;
    case 'accept':
    case 'keep':
      out = await call('decide_suggestion', { story_id: pos[0], suggestion_id: pos[1], action: cmd });
      break;
    case 'pictures':
      out = await call('generate_pictures', {
        story_id: pos[0],
        scene_ids: opts.scenes ? String(opts.scenes).split(',') : undefined,
        wait_seconds: num(opts.wait, 0),
      });
      break;
    case 'pick':
      out = await call('update_scene', { story_id: pos[0], scene_id: pos[1], selected_candidate: pos[2] });
      break;
    case 'wait':
      out = await call('wait_for_story', { story_id: pos[0], seconds: num(opts.seconds, 120) });
      break;
    case 'links':
      out = await call('preview_link', { story_id: pos[0] });
      break;
    case 'publish':
      out = await call('publish_story', { story_id: pos[0], wait_seconds: num(opts.wait, 120) });
      break;
    case 'publish-status':
      out = await call('publish_status', { story_id: pos[0] });
      break;
    case 'status':
      out = await call('studio_status', {});
      break;
    case 'tools':
      out = Object.values(tools).map((t) => ({ name: t.name, description: t.description, inputs: Object.keys(t.input) }));
      break;
    case 'call': {
      const tool = tools[pos[0]];
      if (!tool) throw new Error(`Unknown tool "${pos[0]}". Run "story-studio tools".`);
      out = await tool.run(pos[1] ? JSON.parse(pos[1]) : {});
      break;
    }
    default:
      throw new Error(`Unknown command "${cmd}". Run "story-studio help".`);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, code: err.code, details: err.details }, null, 2));
  process.exit(1);
});
