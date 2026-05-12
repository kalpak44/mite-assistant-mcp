import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { isInitializeRequest } from "@modelcontextprotocol/server";

import { extractBearerToken, tokensMatch } from "./auth.js";
import { loadConfig } from "./config.js";
import { getSessionId, readJsonBody, sendJson } from "./http.js";
import { createMiteClient } from "./miteClient.js";
import { createMcpApp } from "./mcpServer.js";

const config = loadConfig();
const sessions = new Map();

const httpServer = createServer(async (req, res) => {
  try {
    if (req.url === "/health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.url !== config.mcpPath) {
      return sendJson(res, 404, { error: "Not found" });
    }

    const apiKey = extractBearerToken(req.headers.authorization);
    if (!apiKey) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      return sendJson(res, 401, {
        error: "Unauthorized. Use a Mite API key as the bearer token."
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { error: "Method not allowed" });
    }

    const body = await readJsonBody(req);
    const sessionId = getSessionId(req.headers["mcp-session-id"]);

    if (sessionId) {
      const existingSession = sessions.get(sessionId);

      if (!existingSession) {
        return sendJson(res, 404, { error: "Unknown MCP session" });
      }

      if (!tokensMatch(apiKey, existingSession.apiKey)) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
        return sendJson(res, 401, { error: "Unauthorized for this MCP session." });
      }

      await existingSession.transport.handleRequest(req, res, body);
      return;
    }

    if (!isInitializeRequest(body)) {
      return sendJson(res, 400, {
        error: "Missing MCP session. Start with an initialize request."
      });
    }

    const miteClient = createMiteClient(config, apiKey);
    const user = await miteClient.getCurrentUser();
    const session = {
      apiKey,
      user,
      miteBaseUrl: config.miteBaseUrl,
      transport: null
    };

    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        sessions.set(newSessionId, { ...session, transport });
      }
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const mcpServer = createMcpApp(session);
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      const statusCode =
        typeof error?.statusCode === "number" ? error.statusCode : 500;

      if (statusCode === 401) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
      }

      sendJson(res, statusCode, {
        error: error instanceof Error ? error.message : "Internal server error"
      });
    } else {
      res.end();
    }
  }
});

httpServer.listen(config.port, config.host, () => {
  console.log(
    `MCP server listening on http://${config.host}:${config.port}${config.mcpPath}`
  );
});
