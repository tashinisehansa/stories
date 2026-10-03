import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toolDefinitions } from './tools.js';

const INSTRUCTIONS = `Story Studio helps Tashini (a primary-school child) write, check, illustrate and publish her own stories.
Rules: Tashini is the author — never write or rewrite her story for her; only enter text she wrote or dictated.
Grammar suggestions are her choice (ask before accepting). Publishing needs her approval in the Story Studio preview;
if publish_story says not_approved, send her the preview link instead. Keep any messages to her short, kind and encouraging.
Typical flow: create_story/update_story → finish_story → get_review → decide_suggestion → wait_for_story (pictures) →
update_scene (pick pictures) → preview_link (she approves) → publish_story → publish_status.`;

export function buildMcpServer(client) {
  const server = new McpServer({ name: 'story-studio', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  for (const tool of toolDefinitions(client)) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.input }, async (args) => {
      try {
        const result = await tool.run(args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const info = { error: err.message, code: err.code, details: err.details };
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
      }
    });
  }
  return server;
}
