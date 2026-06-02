# KRONVOX

**Your agent gets a smartphone.**

Download KRONVOX, install it, open it — a phone is ready. Insert your "SIM" (sign into your apps) and your AI agent can use it: open apps, log in, tap, type, scroll, read the screen. No setup, no toolchain, nothing to build. Like unboxing a phone.

KRONVOX plugs into any MCP-capable agent: **Claude, OpenClaw, Hermes**, and more.

```
download KRONVOX  →  install  →  open  →  sign into your apps  →  your agent has a phone
```

## For users

1. Download the KRONVOX app for your OS (Windows / macOS / Linux).
2. Install and open it. The phone boots — the Android runtime ships **inside** KRONVOX, nothing to download or assemble.
3. "Insert the SIM": sign into the apps/accounts you want the agent to use.
4. Point your agent at KRONVOX (one line of MCP config — see [docs/clients.md](docs/clients.md)).

That's it. The phone runs locally on your machine and uses your resources.

## What the agent gets (MCP tools)

| Tool | Does |
| --- | --- |
| `kronvox_list_devices` | List attached phones |
| `kronvox_screenshot` | See the screen (PNG) |
| `kronvox_ui` | Structured screen: elements, text, ids, tap coords |
| `kronvox_tap` / `kronvox_swipe` | Touch input |
| `kronvox_type` | Type into the focused field |
| `kronvox_key` | back / home / enter / recent / … |
| `kronvox_open_app` | Launch an app by package |
| `kronvox_screen_size` | Screen dimensions |

## Honest scope

KRONVOX is a virtual phone, marketed as exactly that. It is **not** an anti-detection or "undetectable" tool. Apps that require hardware-backed integrity (most banking apps, some DRM) won't run on any virtual device — that's a limitation of the category, not a bug. Use KRONVOX for app testing, agent research, automating your own accounts, and apps that permit automation.

## Architecture

```
your agent  ⇄  MCP  ⇄  KRONVOX  ⇄  ADB  ⇄  Android (bundled runtime)
```

```
packages/control   ADB device-control library (tap, type, screenshot, ui tree)
packages/mcp       MCP server — the plugin every agent connects to
packages/cli       `kronvox` CLI (the shipped app drives this under the hood)
apps/desktop       the finished KRONVOX app (Tauri) that bundles the phone   [in progress]
infra/redroid      optional cloud runtime (docker, Linux)
.claude-plugin     Claude Code plugin manifest
```

The end-user never provisions anything. The Android runtime is **baked once at build time** by the maintainers and shipped inside the app — see [docs/BUILD.md](docs/BUILD.md).

## License

MIT
