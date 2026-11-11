/**
 * Browser playtest: opens two real game clients in headless Chromium, has one
 * host a private hunt and the other join by invite code, starts the hunt,
 * walks hunter 1 at the monster swinging, and saves screenshots.
 *
 *   npm run build && npm start          # in another terminal
 *   node tools/playtest-browser.mjs     # screenshots land in ./playtest-shots
 *
 * If Chromium fails to start with a missing shared library, run
 * tools/setup-browser-libs.sh once.
 *
 * Env: URL (default http://localhost:2567), OUT (screenshot dir),
 *      FIGHT_SECONDS (longest to keep fighting, default 40; the fight ends
 *      sooner once hunter 1 has landed a hit and 9 seconds have passed).
 * Exits 1 if a page logs an error or the two clients disagree about the room.
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const URL = process.env.URL ?? "http://localhost:2567";
const OUT = path.resolve(process.env.OUT ?? "playtest-shots");
const FIGHT_SECONDS = Number(process.env.FIGHT_SECONDS ?? 40);
const MIN_FIGHT_SECONDS = 9;

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const cache = path.join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  // Prefer the headless shell: it needs far fewer system libraries.
  const candidates = [
    [/^chromium_headless_shell-\d+$/, ["chrome-headless-shell-linux64", "chrome-headless-shell"]],
    [/^chromium-\d+$/, ["chrome-linux64", "chrome"]],
  ];
  for (const [pattern, rel] of candidates) {
    for (const d of readdirSync(cache).filter((d) => pattern.test(d)).sort().reverse()) {
      const exe = path.join(cache, d, ...rel);
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debug = (page) => page.evaluate(() => window.__game?.debug());

async function main() {
  mkdirSync(OUT, { recursive: true });
  const libs = path.resolve(import.meta.dirname, "../.cache/browser-libs");
  const env = { ...process.env };
  if (existsSync(libs)) env.LD_LIBRARY_PATH = [libs, env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  const browser = await chromium.launch({
    executablePath: findChromium(),
    env,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--mute-audio"],
  });
  const errors = [];
  const open = async (label) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
    page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
    await page.goto(URL);
    return page;
  };

  const a = await open("host");
  await a.fill("#name", "Mochi");
  await a.screenshot({ path: path.join(OUT, "0-menu.png") });
  await a.click("#host");
  await a.waitForFunction(() => window.__game?.debug()?.players === 1, null, { timeout: 15000 });
  const code = await a.textContent("#room-code");

  const b = await open("guest");
  await b.fill("#name", "Peanut");
  await b.click("#colors button:nth-child(2)");
  await b.fill("#code", code);
  await b.click("#join");
  await b.waitForFunction(() => window.__game?.debug()?.players === 2, null, { timeout: 15000 });
  await a.waitForFunction(() => window.__game?.debug()?.players === 2, null, { timeout: 15000 });
  await sleep(800);
  await a.screenshot({ path: path.join(OUT, "1-camp.png") });

  await a.keyboard.press("Enter");
  await a.waitForFunction(() => window.__game?.debug()?.phase === "hunt", null, { timeout: 5000 });
  await sleep(1200);
  await a.screenshot({ path: path.join(OUT, "2-monster-enters.png") });

  // Hunter 1 chases the monster and swings when close.
  const began = Date.now();
  const until = began + FIGHT_SECONDS * 1000;
  let shot = 3;
  let nextShot = Date.now() + 3000;
  let maxError = 0;
  while (Date.now() < until) {
    const d = await a.evaluate(() => {
      const g = window.__game;
      const s = g.debug();
      // Face the camera at the monster so holding W walks toward it.
      g.input.camYaw = Math.atan2(s.monster.x - s.me.x, s.monster.z - s.me.z);
      const near = Math.hypot(s.monster.x - s.me.x, s.monster.z - s.me.z) < 5;
      g.input.hold("KeyW", !near);
      if (near) g.input.press(1);
      return s;
    });
    maxError = Math.max(maxError, d.error);
    // The monster picks its own moves, so how soon a swing lands varies run to run.
    if (d.monster.hp < d.monster.maxHp && Date.now() - began > MIN_FIGHT_SECONDS * 1000) break;
    if (Date.now() >= nextShot) {
      await a.screenshot({ path: path.join(OUT, `${shot}-hunt-host.png`) });
      await b.screenshot({ path: path.join(OUT, `${shot}-hunt-guest.png`) });
      shot++;
      nextShot += 3000;
    }
    await sleep(150);
  }
  await a.evaluate(() => window.__game.input.hold("KeyW", false));
  await sleep(500);

  const da = await debug(a);
  const db = await debug(b);
  console.log("[browser] host :", JSON.stringify(da));
  console.log("[browser] guest:", JSON.stringify(db));
  console.log(`[browser] largest prediction correction seen on host: ${maxError.toFixed(3)} units`);
  console.log(`[browser] screenshots: ${OUT}`);

  const problems = [...errors];
  if (da.phase !== db.phase) problems.push(`phase mismatch: ${da.phase} vs ${db.phase}`);
  if (Math.abs(da.monster.hp - db.monster.hp) > 60) problems.push("clients disagree on monster hp");
  if (da.monster.hp >= da.monster.maxHp && da.phase === "hunt") problems.push("host never damaged the monster");
  if (Math.hypot(da.me.x - da.server.x, da.me.z - da.server.z) > 1.5) problems.push("host prediction drifted from server");
  await browser.close();
  if (problems.length) {
    console.error("[browser] PROBLEMS:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("[browser] OK");
}

main().catch((err) => {
  console.error("[browser] error:", err);
  process.exit(1);
});
