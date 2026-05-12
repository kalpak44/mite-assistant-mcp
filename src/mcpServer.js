import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import pkg from "../package.json" with { type: "json" };
import { registerWhoAmITool } from "./tools/whoami.js";
import { registerListTimeEntriesTool } from "./tools/listTimeEntries.js";
import { registerManageTimeEntryTools } from "./tools/manageTimeEntry.js";

export function createMcpApp(session) {
  const server = new McpServer({
    name: pkg.name,
    version: pkg.version
  });

  registerWhoAmITool(server, session);
  registerListTimeEntriesTool(server, session);
  registerManageTimeEntryTools(server, session);

  return server;
}
