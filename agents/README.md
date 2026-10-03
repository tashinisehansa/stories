# Driving Story Studio from agents

Story Studio is built so Hermes, Claude Code or any other agent can do everything the child-facing UI can, except
**approve** a story. Tashini approves by pressing Publish in the preview. All agent entry points go through the
running Story Studio server's REST API, so the server is the only process that writes the data.

| Entry point | Use it when | Auth |
|---|---|---|
| MCP over stdio: `node src/mcp.js` | Local agents (Hermes, Claude Code) on this computer | `AGENT_TOKEN` env, or read from `data/secrets.json` automatically |
| MCP over HTTP: `POST http://<host>:4321/mcp` | Agents on another machine on the home network | `Authorization: Bearer <AGENT_TOKEN>` |
| CLI: `node src/cli.js …` | Anything with a shell, cron jobs, scripts | same as stdio |
| REST: `http://<host>:4321/api/…` | Custom integrations | `Authorization: Bearer <AGENT_TOKEN>` |

The parent page (`/admin.html`) shows the agent token and ready-to-paste config.

## Hermes

1. Register the MCP server in `~/.hermes/config.yaml`:

   ```yaml
   mcp_servers:
     story_studio:
       command: "node"
       args: ["/home/manoj/projects/tashini/stories/src/mcp.js"]
       timeout: 300
   ```

   On another machine, use the HTTP form instead:

   ```yaml
   mcp_servers:
     story_studio:
       url: "http://192.168.1.144:4321/mcp"
       headers:
         Authorization: "Bearer <AGENT_TOKEN>"
       timeout: 300
   ```

2. Install the skill, which teaches Hermes the workflow and the rules:

   ```bash
   ln -s /home/manoj/projects/tashini/stories/agents/hermes/story-studio ~/.hermes/skills/story-studio
   ```

3. Try it: `hermes -z "List Tashini's stories"`.

## Claude Code

`.mcp.json` in the repo root registers the stdio server for Claude Code sessions opened in this repo.

## Tools

`studio_status`, `list_stories`, `get_story`, `create_story`, `update_story`, `finish_story`, `get_review`,
`get_feedback_history`, `decide_suggestion`, `accept_all_suggestions`, `generate_pictures`, `update_scene`, `add_scene`, `remove_scene`,
`wait_for_story`, `preview_link`, `approve_story`*, `publish_story`, `publish_status`, `list_revisions`,
`restore_revision`.

\* `approve_story` is refused unless the parent sets `AGENT_CAN_APPROVE=1` in `.env`. Turn that on only if you
want, for example, Tashini to approve by telling Hermes in a chat.

Long jobs (review takes about 30 seconds; pictures take 1–3 minutes) run in the background. Pass `wait_seconds`, or call
`wait_for_story`, rather than polling in a tight loop.

## CLI examples

```bash
node src/cli.js list
node src/cli.js new --title "The Lost Puppy" --file puppy.txt
node src/cli.js finish story-20261003ab12cd34 --wait 120
node src/cli.js review story-20261003ab12cd34
node src/cli.js accept story-20261003ab12cd34 g1a2b3c
node src/cli.js wait story-20261003ab12cd34 --seconds 300
node src/cli.js links story-20261003ab12cd34
node src/cli.js publish story-20261003ab12cd34      # after Tashini approves
node src/cli.js call get_story '{"story_id":"story-20261003ab12cd34"}'
```
