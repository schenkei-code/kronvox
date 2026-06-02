import * as phone from "@kronvox/control";
import { writeFile } from "node:fs/promises";

const S = process.env.KRONVOX_SERIAL || "emulator-5554";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await writeFile("demo_0_home.png", await phone.screenshot(S));
console.log("0: home screenshot");

await phone.openApp("com.android.settings", S);
await sleep(4000);
await writeFile("demo_1_settings.png", await phone.screenshot(S));
console.log("1: opened Settings");

const nodes = await phone.uiTree(S);
const search = nodes.find(
  (n) => /search/i.test(n.text || "") || /search/i.test(n.contentDesc || "") || /search/i.test(n.resourceId || ""),
);
if (search) {
  await phone.tap(search.center.x, search.center.y, S);
  await sleep(1800);
  await phone.type("wifi", S);
  await sleep(1800);
  await writeFile("demo_2_typed.png", await phone.screenshot(S));
  console.log(`2: tapped search @${search.center.x},${search.center.y} and typed "wifi"`);
} else {
  console.log("no search field found; visible:", nodes.map((n) => n.text || n.contentDesc).filter(Boolean).slice(0, 10));
}
console.log("done");
