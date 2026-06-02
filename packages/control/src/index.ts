import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

const MAX_BUFFER = 64 * 1024 * 1024;

/** Path to the adb binary. Read lazily so callers can set KRONVOX_ADB after import. */
function adbBin(): string {
  return process.env.KRONVOX_ADB || "adb";
}

function withSerial(serial: string | undefined, rest: string[]): string[] {
  const s = serial ?? process.env.KRONVOX_SERIAL ?? undefined;
  return s ? ["-s", s, ...rest] : rest;
}

async function adb(serial: string | undefined, args: string[]): Promise<string> {
  const { stdout } = await pexec(adbBin(), withSerial(serial, args), { maxBuffer: MAX_BUFFER });
  return stdout.toString();
}

export interface Device {
  serial: string;
  state: string;
}

/** List attached devices/emulators that are online. */
export async function listDevices(): Promise<Device[]> {
  const out = await adb(undefined, ["devices"]);
  return out
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      return { serial, state };
    })
    .filter((d) => d.serial && d.state);
}

/** Capture the current screen as a PNG buffer. */
export async function screenshot(serial?: string): Promise<Buffer> {
  const { stdout } = await pexec(adbBin(), withSerial(serial, ["exec-out", "screencap", "-p"]), {
    encoding: "buffer",
    maxBuffer: MAX_BUFFER,
  });
  return stdout as Buffer;
}

/** Tap a screen coordinate (pixels). */
export async function tap(x: number, y: number, serial?: string): Promise<void> {
  await adb(serial, ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
}

/** Swipe from (x1,y1) to (x2,y2) over durationMs. */
export async function swipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 300,
  serial?: string,
): Promise<void> {
  await adb(serial, [
    "shell",
    "input",
    "swipe",
    String(Math.round(x1)),
    String(Math.round(y1)),
    String(Math.round(x2)),
    String(Math.round(y2)),
    String(Math.round(durationMs)),
  ]);
}

/** Type text into the focused field. Spaces are escaped for the shell. */
export async function type(text: string, serial?: string): Promise<void> {
  const escaped = text.replace(/(["\s'\\$`&|;<>()])/g, "\\$1");
  await adb(serial, ["shell", "input", "text", escaped]);
}

const KEYCODES: Record<string, number> = {
  back: 4,
  home: 3,
  enter: 66,
  tab: 61,
  delete: 67,
  search: 84,
  menu: 82,
  power: 26,
  volume_up: 24,
  volume_down: 25,
  recent: 187,
  space: 62,
};

/** Press a named key (back/home/enter/...) or a raw Android keycode number. */
export async function key(name: string | number, serial?: string): Promise<void> {
  const code = typeof name === "number" ? name : KEYCODES[name.toLowerCase()];
  if (code === undefined) throw new Error(`Unknown key: ${name}. Known: ${Object.keys(KEYCODES).join(", ")}`);
  await adb(serial, ["shell", "input", "keyevent", String(code)]);
}

/** Valid Android package name — guards values that reach `adb shell`. */
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** Launch an app by package name (uses monkey to resolve the launcher intent). */
export async function openApp(pkg: string, serial?: string): Promise<void> {
  if (!PACKAGE_RE.test(pkg)) throw new Error(`Invalid package name: ${pkg}`);
  await adb(serial, ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
}

/** Install an APK from a local file path. */
export async function installApk(apkPath: string, serial?: string): Promise<string> {
  return adb(serial, ["install", "-r", apkPath]);
}

/** Run an arbitrary adb shell command. Use sparingly. */
export async function shell(command: string, serial?: string): Promise<string> {
  return adb(serial, ["shell", command]);
}

export interface UiNode {
  text?: string;
  resourceId?: string;
  contentDesc?: string;
  className?: string;
  clickable: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  center: { x: number; y: number };
}

/**
 * Dump the current view hierarchy and return a flat list of meaningful nodes
 * (anything with text, a content-description, or that is clickable). This gives
 * an agent a structured view of the screen instead of raw pixels.
 */
export async function uiTree(serial?: string): Promise<UiNode[]> {
  // uiautomator dumps to a file on the device, then we read it back.
  await adb(serial, ["shell", "uiautomator", "dump", "/sdcard/kronvox_ui.xml"]).catch(() => {});
  const xml = await adb(serial, ["shell", "cat", "/sdcard/kronvox_ui.xml"]);
  const nodes: UiNode[] = [];
  const nodeRe = /<node\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(xml))) {
    const attrs = m[1];
    const get = (k: string) => {
      const a = new RegExp(`${k}="([^"]*)"`).exec(attrs);
      return a ? a[1] : "";
    };
    const boundsRaw = get("bounds"); // [x1,y1][x2,y2]
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(boundsRaw);
    if (!b) continue;
    const x1 = +b[1], y1 = +b[2], x2 = +b[3], y2 = +b[4];
    const text = get("text");
    const desc = get("content-desc");
    const clickable = get("clickable") === "true";
    if (!text && !desc && !clickable) continue;
    nodes.push({
      text: text || undefined,
      resourceId: get("resource-id") || undefined,
      contentDesc: desc || undefined,
      className: get("class") || undefined,
      clickable,
      bounds: { x1, y1, x2, y2 },
      center: { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) },
    });
  }
  return nodes;
}

/** Screen size in pixels. */
export async function screenSize(serial?: string): Promise<{ width: number; height: number }> {
  const out = await adb(serial, ["shell", "wm", "size"]);
  const m = /(\d+)x(\d+)/.exec(out);
  if (!m) throw new Error(`Could not parse screen size from: ${out}`);
  return { width: +m[1], height: +m[2] };
}
