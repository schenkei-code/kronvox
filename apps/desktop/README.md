# KRONVOX Desktop (the finished app)

This is the artifact the user downloads. A Tauri app that **bundles the baked phone runtime** and boots it on open — unbox-and-go.

## What it does

- On install it carries the baked runtime (see [../../docs/BUILD.md](../../docs/BUILD.md)) — no downloads on the user's side.
- On open it boots the bundled phone (equivalent of `kronvox up`) and shows it live.
- Exposes the MCP endpoint the user pastes into Claude / OpenClaw / Hermes.
- "Insert SIM" = the user signs into their apps inside the phone view.

## UI (planned)

- Live phone screen (scrcpy → WebRTC/canvas), clickable.
- Start / stop / reset device.
- Status: booting / ready, hardware-acceleration check.
- One-click "copy MCP config" for each client.
- App drawer shortcut + APK install (drag-drop).

## Stack

- Tauri (Rust shell) + a small web UI.
- Sidecars: the bundled Android `emulator` + `platform-tools/adb`, and the compiled `@kronvox/cli` / `@kronvox/mcp` (Node) — or a static MCP binary.
- `KRONVOX_HOME` is set to the bundled runtime path at launch.

## Build

Requires [Rust](https://rustup.rs) and a C toolchain for your platform (MSVC Build Tools on Windows, or MinGW; Xcode CLT on macOS; `build-essential` on Linux), plus Node for the Tauri CLI.

```
cd apps/desktop
npm install
npm run build      # release app + installer  (or: npm run dev)
```

Output: `src-tauri/target/<triple>/release/` — the `KRONVOX` executable and an installer under `bundle/`.

> If your global cargo config pins an unusual GNU linker, drop a local `src-tauri/.cargo/config.toml` pointing `linker` at a valid `gcc` for your machine (this file is git-ignored).

## Status

Working. Drives the engine (`@kronvox/control`, `@kronvox/mcp`) over adb directly from the Rust shell: live phone view, touch + keyboard, device start/stop, app launcher, one-click MCP config. Next: bundle the baked Android runtime into the installer for zero-setup on a fresh machine.
