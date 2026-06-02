import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";
import { mkdir, rm, rename, access, readdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import extract from "extract-zip";

const pexec = promisify(execFile);

export const KRONVOX_HOME = process.env.KRONVOX_HOME || path.join(os.homedir(), ".kronvox");
export const SDK = path.join(KRONVOX_HOME, "sdk");

const CLT_BUILD = process.env.KRONVOX_CLT_BUILD || "11076708";
const API = process.env.KRONVOX_API || "34";
const AVD = process.env.KRONVOX_AVD || "kronvox";
const DEVICE = process.env.KRONVOX_DEVICE || "pixel_6";

const IS_WIN = process.platform === "win32";
const EXE = IS_WIN ? ".exe" : "";
const BAT = IS_WIN ? ".bat" : "";

function platformTag(): "win" | "mac" | "linux" {
  if (process.platform === "win32") return "win";
  if (process.platform === "darwin") return "mac";
  return "linux";
}

function imageArch(): string {
  return process.arch === "arm64" ? "arm64-v8a" : "x86_64";
}

const SYS_IMAGE = process.env.KRONVOX_IMAGE || `system-images;android-${API};google_apis;${imageArch()}`;

const paths = {
  cmdlineBin: path.join(SDK, "cmdline-tools", "latest", "bin"),
  sdkmanager: path.join(SDK, "cmdline-tools", "latest", "bin", `sdkmanager${BAT}`),
  avdmanager: path.join(SDK, "cmdline-tools", "latest", "bin", `avdmanager${BAT}`),
  emulator: path.join(SDK, "emulator", `emulator${EXE}`),
  adb: path.join(SDK, "platform-tools", `adb${EXE}`),
};

const env = { ...process.env, ANDROID_SDK_ROOT: SDK, ANDROID_HOME: SDK };

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function log(msg: string) {
  console.log(`[kronvox] ${msg}`);
}

async function download(url: string, dest: string): Promise<void> {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest));
}

async function unzip(zip: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  // pure-JS extractor: avoids cross-platform tar/path quirks (e.g. GNU tar treating C: as a host).
  await extract(zip, { dir: dest });
}

/** Run sdkmanager/avdmanager (a .bat on Windows) and stream y-answers to its stdin. */
function runTool(tool: string, args: string[], autoYes = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(tool, args, {
      env,
      shell: IS_WIN, // .bat needs the shell on Windows
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (autoYes) child.stdin.write("y\n".repeat(100));
    child.stdin.end();
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(tool)} exited ${code}`))));
  });
}

export async function setup(): Promise<void> {
  await mkdir(SDK, { recursive: true });

  // 1. command-line tools
  if (!(await exists(paths.sdkmanager))) {
    const zipName = `commandlinetools-${platformTag()}-${CLT_BUILD}_latest.zip`;
    const url = `https://dl.google.com/android/repository/${zipName}`;
    const tmpZip = path.join(KRONVOX_HOME, zipName);
    const tmpExtract = path.join(KRONVOX_HOME, "_clt_tmp");
    await download(url, tmpZip);
    await rm(tmpExtract, { recursive: true, force: true });
    await unzip(tmpZip, tmpExtract);
    // zip contains a top-level "cmdline-tools" folder -> move it to cmdline-tools/latest
    await mkdir(path.join(SDK, "cmdline-tools"), { recursive: true });
    await rename(path.join(tmpExtract, "cmdline-tools"), paths.cmdlineBin.replace(path.join("latest", "bin"), "latest"));
    await rm(tmpZip, { force: true });
    await rm(tmpExtract, { recursive: true, force: true });
    log("command-line tools installed");
  } else {
    log("command-line tools present");
  }

  // 2. licenses
  log("accepting SDK licenses");
  await runTool(paths.sdkmanager, ["--licenses", `--sdk_root=${SDK}`], true);

  // 3. packages
  log(`installing platform-tools, emulator, ${SYS_IMAGE}`);
  await runTool(paths.sdkmanager, [`--sdk_root=${SDK}`, "platform-tools", "emulator", SYS_IMAGE], true);

  // 4. AVD
  if (!(await hasAvd())) {
    log(`creating AVD "${AVD}"`);
    await runTool(paths.avdmanager, ["create", "avd", "-n", AVD, "-k", SYS_IMAGE, "-d", DEVICE, "--force"], true);
  } else {
    log(`AVD "${AVD}" exists`);
  }

  log(`done. SDK at ${SDK}. Start the phone with: kronvox up`);
}

async function hasAvd(): Promise<boolean> {
  const avdDir = path.join(os.homedir(), ".android", "avd");
  if (!(await exists(avdDir))) return false;
  const entries = await readdir(avdDir).catch(() => [] as string[]);
  return entries.includes(`${AVD}.avd`) || entries.includes(`${AVD}.ini`);
}

/** Boot the emulator and resolve once Android has finished booting. Returns the adb serial. */
export async function up(headless = process.env.KRONVOX_HEADLESS === "1"): Promise<string> {
  if (!(await exists(paths.emulator))) throw new Error("runtime not provisioned — run `kronvox setup` first");
  const args = ["-avd", AVD, "-no-boot-anim", "-no-snapshot"];
  if (headless) args.push("-no-window", "-no-audio", "-gpu", "swiftshader_indirect");
  log(`booting phone "${AVD}"${headless ? " (headless)" : ""}`);
  const emu = spawn(paths.emulator, args, { env, detached: true, stdio: "ignore" });
  emu.unref();

  // wait for boot
  await pexec(paths.adb, ["wait-for-device"], { env });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await pexec(paths.adb, ["shell", "getprop", "sys.boot_completed"], { env });
      if (stdout.trim() === "1") {
        const serial = await firstSerial();
        log(`phone is up: ${serial}`);
        return serial;
      }
    } catch {
      /* device not ready yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("phone did not finish booting within 3 min");
}

async function firstSerial(): Promise<string> {
  const { stdout } = await pexec(paths.adb, ["devices"], { env });
  const line = stdout.split("\n").slice(1).map((l) => l.trim()).find((l) => l.endsWith("device"));
  return line ? line.split(/\s+/)[0] : "emulator-5554";
}

export async function doctor(): Promise<void> {
  const checks: [string, boolean][] = [
    ["JDK (java)", await which("java")],
    ["command-line tools", await exists(paths.sdkmanager)],
    ["platform-tools (adb)", await exists(paths.adb)],
    ["emulator", await exists(paths.emulator)],
    ["AVD", await hasAvd()],
  ];
  for (const [name, okFlag] of checks) console.log(`${okFlag ? "ok  " : "MISS"}  ${name}`);
  console.log(`\nSDK home: ${SDK}`);
}

async function which(bin: string): Promise<boolean> {
  try {
    await pexec(IS_WIN ? "where" : "which", [bin]);
    return true;
  } catch {
    return false;
  }
}

export const runtimePaths = paths;
