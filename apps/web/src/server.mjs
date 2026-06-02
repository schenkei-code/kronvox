#!/usr/bin/env node
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";
import * as phone from "@kronvox/control";

// Default adb to the baked local runtime if not set.
if (!process.env.KRONVOX_ADB) {
  const baked = path.join(process.env.KRONVOX_HOME || path.join(os.homedir(), ".kronvox"), "sdk", "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  if (existsSync(baked)) process.env.KRONVOX_ADB = baked;
}

const PORT = Number(process.env.KRONVOX_WEB_PORT || 4599);
const HOST = process.env.KRONVOX_WEB_HOST || "127.0.0.1"; // loopback only — local control plane
const SERIAL = process.env.KRONVOX_SERIAL || "emulator-5554";
const here = path.dirname(fileURLToPath(import.meta.url));

// Android package names that are safe to pass to `adb shell`.
const PKG_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function body(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(b || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || /^\/[\w-]+\.html(\?|$)/.test(req.url))) {
      const name = req.url === "/" ? "index.html" : path.basename(req.url.split("?")[0]);
      const html = await readFile(path.join(here, "..", "public", name));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && req.url.startsWith("/screen")) {
      const png = await phone.screenshot(SERIAL);
      res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
      return res.end(png);
    }
    if (req.method === "GET" && req.url === "/size") {
      const sz = await phone.screenSize(SERIAL);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(sz));
    }
    if (req.method === "POST") {
      const b = await body(req);
      if (req.url === "/tap") await phone.tap(b.x, b.y, SERIAL);
      else if (req.url === "/swipe") await phone.swipe(b.x1, b.y1, b.x2, b.y2, b.ms || 300, SERIAL);
      else if (req.url === "/type") await phone.type(b.text || "", SERIAL);
      else if (req.url === "/key") await phone.key(b.key, SERIAL);
      else if (req.url === "/open") {
        if (typeof b.package !== "string" || !PKG_RE.test(b.package)) {
          res.writeHead(400, { "content-type": "application/json" });
          return res.end('{"error":"invalid package name"}');
        }
        await phone.openApp(b.package, SERIAL);
      }
      else {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
    res.writeHead(404);
    res.end("not found");
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, HOST, () => console.log(`KRONVOX web UI on http://${HOST}:${PORT}  (device ${SERIAL})`));
