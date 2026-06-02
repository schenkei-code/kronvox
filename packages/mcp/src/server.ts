#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as phone from "@kronvox/control";

const server = new McpServer({
  name: "kronvox",
  version: "0.1.0",
});

const serialArg = { serial: z.string().optional().describe("Target device serial. Defaults to KRONVOX_SERIAL or the only attached device.") };

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

server.tool(
  "kronvox_list_devices",
  "List the virtual phones (Android devices/emulators) currently attached.",
  {},
  async () => {
    const devices = await phone.listDevices();
    return ok(JSON.stringify(devices, null, 2));
  },
);

server.tool(
  "kronvox_screenshot",
  "Take a screenshot of the phone's screen. Returns a PNG image of the current screen.",
  { ...serialArg },
  async ({ serial }) => {
    const png = await phone.screenshot(serial);
    return { content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }] };
  },
);

server.tool(
  "kronvox_ui",
  "Get a structured view of the current screen: a list of on-screen elements (text, ids, whether clickable) with their pixel coordinates. Prefer this over screenshots for deciding where to tap.",
  { ...serialArg },
  async ({ serial }) => {
    const nodes = await phone.uiTree(serial);
    return ok(JSON.stringify(nodes, null, 2));
  },
);

server.tool(
  "kronvox_tap",
  "Tap a pixel coordinate on the phone screen.",
  { x: z.number(), y: z.number(), ...serialArg },
  async ({ x, y, serial }) => {
    await phone.tap(x, y, serial);
    return ok(`tapped (${x}, ${y})`);
  },
);

server.tool(
  "kronvox_swipe",
  "Swipe from one coordinate to another (for scrolling, dragging).",
  {
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    durationMs: z.number().default(300),
    ...serialArg,
  },
  async ({ x1, y1, x2, y2, durationMs, serial }) => {
    await phone.swipe(x1, y1, x2, y2, durationMs, serial);
    return ok(`swiped (${x1},${y1}) -> (${x2},${y2})`);
  },
);

server.tool(
  "kronvox_type",
  "Type text into the currently focused input field.",
  { text: z.string(), ...serialArg },
  async ({ text, serial }) => {
    await phone.type(text, serial);
    return ok(`typed ${text.length} chars`);
  },
);

server.tool(
  "kronvox_key",
  "Press a hardware/navigation key: back, home, enter, tab, delete, search, menu, recent, space, power, volume_up, volume_down.",
  { key: z.string(), ...serialArg },
  async ({ key, serial }) => {
    await phone.key(key, serial);
    return ok(`pressed ${key}`);
  },
);

server.tool(
  "kronvox_open_app",
  "Launch an app by its Android package name (e.g. com.android.chrome).",
  { package: z.string(), ...serialArg },
  async ({ package: pkg, serial }) => {
    await phone.openApp(pkg, serial);
    return ok(`launched ${pkg}`);
  },
);

server.tool(
  "kronvox_screen_size",
  "Get the phone screen size in pixels.",
  { ...serialArg },
  async ({ serial }) => {
    const size = await phone.screenSize(serial);
    return ok(JSON.stringify(size));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("kronvox mcp server running on stdio");
