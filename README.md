# mite-assistant-mcp

JavaScript-based MCP server for Mite time tracking.

## Purpose

This project is intended to let AI assistants interact with the Mite API to:

- retrieve time entries
- group time entries for simple reports
- create new time entries

## Add To Claude Code

Add the server and authenticate with your Mite API key:

```bash
claude mcp add mite-assistant \
  https://mite-assistant.pavel-usanli.online/mcp \
  --transport http \
  --header "Authorization: Bearer YOUR_MITE_API_KEY"
```

Delete it from Claude Code:

```bash
claude mcp remove mite-assistant
```

## Add To Codex

Add the server and authenticate with your Mite API key:

```bash
export MITE_API_KEY="YOUR_MITE_API_KEY"
codex mcp add mite-assistant \
  --url https://mite-assistant.pavel-usanli.online/mcp \
  --bearer-token-env-var MITE_API_KEY
```

Delete it from Codex:

```bash
codex mcp remove mite-assistant
```

## Example Prompts

```text
Who am I in Mite?
```

```text
Can you tell me my today's Mite entries?
```