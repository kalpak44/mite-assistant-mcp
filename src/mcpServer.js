import { McpServer } from "@modelcontextprotocol/server";

import { registerWhoAmITool } from "./tools/whoami.js";

export function createMcpApp(session) {
  const server = new McpServer({
    name: "mite-assistant-mcp",
    version: "0.1.0"
  });

  registerWhoAmITool(server, session);

  return server;
}
