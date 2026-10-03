#!/usr/bin/env node
// Story Studio MCP server over stdio — for Hermes, Claude Code, or any MCP client.
// Talks to the running Story Studio server (STUDIO_URL, default http://127.0.0.1:4321)
// using AGENT_TOKEN (or the token in data/secrets.json on this machine).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './agent/mcp-server.js';
import { studioClient } from './agent/client.js';

const server = buildMcpServer(studioClient());
await server.connect(new StdioServerTransport());
