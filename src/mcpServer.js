import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerWhoAmITool } from "./tools/whoami.js";
import { registerListTimeEntriesTool } from "./tools/listTimeEntries.js";

export function createMcpApp(session) {
  const server = new McpServer({
    name: "mite-assistant-mcp",
    version: "0.1.0"
  });

  registerWhoAmITool(server, session);
  registerListTimeEntriesTool(server, session);

  return server;
}
