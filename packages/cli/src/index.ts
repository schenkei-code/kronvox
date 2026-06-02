#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import { setup, up, doctor, runtimePaths } from "./setup.js";

// Default adb to the provisioned local runtime if the caller didn't set it.
if (!process.env.KRONVOX_ADB && existsSync(runtimePaths.adb)) process.env.KRONVOX_ADB = runtimePaths.adb;

const [, , cmd, ...rest] = process.argv;

const HELP = `kronvox — your agent gets a smartphone

User commands (the shipped app runs these for you):
  kronvox up                  Boot the bundled phone (add --headless for no window).
  kronvox devices             List attached phones.
  kronvox shot <out.png>      Save a screenshot of the current screen.
  kronvox mcp                 Run the MCP server on stdio (for Claude/OpenClaw/Hermes).
  kronvox doctor              Check the runtime.
  kronvox help                Show this help.

Build-time (maintainers only — bakes the runtime that ships inside KRONVOX):
  kronvox bake                Download + assemble the Android runtime to be bundled.

Env:
  KRONVOX_HOME     Where the runtime lives (default: ~/.kronvox; the app points this at its bundle)
  KRONVOX_ADB      Path to adb (default: bundled runtime, else 'adb')
  KRONVOX_SERIAL   Default device serial to control
  KRONVOX_HEADLESS 1 to boot the emulator without a window
`;

async function main() {
  switch (cmd) {
    case "bake": // build-time: assemble the runtime that ships inside KRONVOX
    case "setup": // deprecated alias
      await setup();
      return;
    case "up": {
      const serial = await up(rest.includes("--headless"));
      console.log(`\nPhone ready. Point your agent at the MCP server:\n  KRONVOX_SERIAL=${serial} kronvox mcp`);
      return;
    }
    case "doctor":
      await doctor();
      return;
    case "devices": {
      const phone = await import("@kronvox/control");
      const devices = await phone.listDevices();
      if (!devices.length) {
        console.log("No phones attached. Run `kronvox setup` then `kronvox up`.");
        return;
      }
      for (const d of devices) console.log(`${d.serial}\t${d.state}`);
      return;
    }
    case "shot": {
      const out = rest[0];
      if (!out) throw new Error("usage: kronvox shot <out.png>");
      const phone = await import("@kronvox/control");
      const png = await phone.screenshot();
      const { writeFile } = await import("node:fs/promises");
      await writeFile(out, png);
      console.log(`saved ${out}`);
      return;
    }
    case "mcp": {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const serverEntry = path.resolve(here, "../../mcp/dist/server.js");
      const child = spawn(process.execPath, [serverEntry], { stdio: "inherit", env: process.env });
      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
    case "help":
    case undefined:
      console.log(HELP);
      return;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
