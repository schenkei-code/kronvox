# Connecting KRONVOX to your agent

KRONVOX speaks **MCP**, so any MCP-capable client can use the phone. After `npm run build`, point the client at `packages/mcp/dist/server.js`.

Set `KRONVOX_SERIAL` if more than one device is attached (e.g. `localhost:5555` for a cloud phone).

## Claude Code

As a plugin (this repo ships a `.claude-plugin/plugin.json`), or directly via `.mcp.json`:

```json
{
  "mcpServers": {
    "kronvox": {
      "command": "node",
      "args": ["packages/mcp/dist/server.js"],
      "env": { "KRONVOX_ADB": "adb", "KRONVOX_SERIAL": "" }
    }
  }
}
```

## OpenClaw

Add to the MCP servers section of your OpenClaw config:

```json
{
  "mcpServers": {
    "kronvox": {
      "command": "node",
      "args": ["/abs/path/to/kronvox/packages/mcp/dist/server.js"],
      "env": { "KRONVOX_SERIAL": "localhost:5555" }
    }
  }
}
```

## Hermes

Register the same stdio MCP command in your Hermes tool/MCP config:

```
command: node
args: ["/abs/path/to/kronvox/packages/mcp/dist/server.js"]
env:  KRONVOX_SERIAL=localhost:5555
```

## Remote / cloud MCP

For a hosted offering, run the MCP server behind an HTTP/SSE transport on the box next to the redroid instances and give each tenant their own `KRONVOX_SERIAL`. (HTTP transport is on the roadmap; stdio works today for local + SSH-tunnelled setups.)

## Typical agent loop

1. `kronvox_ui` (or `kronvox_screenshot`) to perceive the screen
2. decide the next action
3. `kronvox_tap` / `kronvox_type` / `kronvox_swipe` / `kronvox_key`
4. repeat
