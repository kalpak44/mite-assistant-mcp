export function loadConfig() {
  const config = {
    port: Number.parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    mcpPath: process.env.MCP_PATH ?? "/mcp",
    miteBaseUrl: process.env.MITE_BASE_URL ?? "",
    miteUserAgent:
      process.env.MITE_USER_AGENT ??
      "mite-assistant-mcp/0.1.0 (https://github.com/your-org/mite-assistant-mcp)"
  };

  if (!config.miteBaseUrl) {
    throw new Error("Missing MITE_BASE_URL. Set it to your Mite account URL.");
  }

  return config;
}
