# Building & shipping KRONVOX (maintainers)

The end user downloads a finished app and never provisions anything. All the heavy lifting happens here, once, at build time. The Android runtime is **baked** into the release artifact.

## The model

```
[ bake runtime ]  →  [ bundle into desktop app ]  →  [ per-OS installers ]  →  user downloads
   (our machine /CI)        (Tauri)                     (.exe/.dmg/.AppImage)
```

The user's flow is just: download → install → open → sign into apps. The phone is already inside.

## 1. Bake the runtime

`kronvox bake` assembles a ready-to-run Android runtime into `KRONVOX_HOME` (`~/.kronvox` by default):

```bash
node packages/cli/dist/index.js bake
```

It downloads the Android command-line tools, then installs `platform-tools`, `emulator`, and a system image, accepts licenses, and creates the `kronvox` AVD. The result is a self-contained runtime folder:

```
~/.kronvox/sdk/
  platform-tools/   (adb)
  emulator/
  system-images/android-34/google_apis/<arch>/
  cmdline-tools/latest/
~/.android/avd/kronvox.avd/   (the device)
```

To slim the shipped bundle, drop `cmdline-tools` after baking and keep only `platform-tools`, `emulator`, the system image, and the AVD. Pre-boot the AVD once and capture a **snapshot** so the user's first launch is instant.

Env knobs: `KRONVOX_API` (default 34), `KRONVOX_IMAGE`, `KRONVOX_AVD`, `KRONVOX_DEVICE`, `KRONVOX_CLT_BUILD`.

## 2. Bundle into the desktop app

`apps/desktop` (Tauri) ships:
- the baked runtime folder (sets `KRONVOX_HOME` to the bundled path on first run),
- the compiled `@kronvox/cli` + `@kronvox/mcp`,
- a small UI: a live phone view (scrcpy/WebRTC) + start/stop + the MCP endpoint to paste into the agent.

On first open the app runs the equivalent of `kronvox up` against the bundled runtime — no downloads.

## 3. Per-OS installers

Tauri produces `.exe`/`.msi` (Windows), `.dmg` (macOS), `.AppImage`/`.deb` (Linux). Each embeds the baked runtime for that arch (x86_64 vs arm64 system image). Expect ~1–1.5 GB per installer because the Android system image ships inside.

## Notes

- Bake on the same arch family you ship to (x86_64 host → x86_64 image; Apple Silicon → arm64-v8a).
- Hardware acceleration on the user's machine: WHPX/Hyper-V (Windows), HVF (macOS), KVM (Linux). The app should detect and fall back to software rendering with a warning.
- A cloud variant can instead bake a redroid image (see `infra/redroid`) and skip the desktop bundle.
