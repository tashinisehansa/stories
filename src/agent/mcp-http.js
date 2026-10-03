import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './mcp-server.js';
import { studioClient } from './client.js';

// Stateless Streamable-HTTP MCP endpoint at /mcp (bearer AGENT_TOKEN).
// Lets remote agents use Story Studio with only a URL and a token.
export async function handleMcpHttp(req, res, studio) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
    return;
  }
  const client = studioClient({ baseUrl: studio.selfUrl, token: studio.secrets.agentToken });
  // Links handed to agents should point at the address they used to reach us.
  client.linkBase = `http://${req.headers.host ?? new URL(studio.selfUrl).host}`;
  const server = buildMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
