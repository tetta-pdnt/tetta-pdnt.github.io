import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const buildScript = fileURLToPath(new URL("./build-feed.mjs", import.meta.url));
const astroBin = fileURLToPath(new URL("../node_modules/.bin/astro", import.meta.url));
const watchedPaths = [
  new URL("../content/", import.meta.url),
  new URL("../external/snippets/", import.meta.url),
  new URL("../external/estivation/", import.meta.url),
  new URL("../external/orbit/", import.meta.url),
  new URL("../public/img/typography/", import.meta.url),
  new URL("../feeds.json", import.meta.url),
  new URL("../external.config.json", import.meta.url),
  new URL("../manual-items.json", import.meta.url)
].map(fileURLToPath);

let astro;
let refreshing = false;
let queued = false;
let previousSnapshot = "";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

function stopAstro() {
  if (!astro || astro.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    astro.once("exit", resolve);
    astro.kill("SIGTERM");
  });
}

function startAstro() {
  astro = spawn(astroBin, ["dev", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }
  });
  astro.on("exit", (code) => {
    if (!refreshing && code && !process.exitCode) process.exitCode = code;
  });
}

async function refresh() {
  if (refreshing) {
    queued = true;
    return;
  }

  refreshing = true;
  try {
    await run(process.execPath, [buildScript]);
    await stopAstro();
    startAstro();
  } catch (error) {
    console.error("\n[watch] Could not refresh:", error.message);
  } finally {
    refreshing = false;
    if (queued) {
      queued = false;
      scheduleRefresh();
    }
  }
}

function scheduleRefresh() {
  void refresh();
}

async function fingerprint(target) {
  try {
    const info = await stat(target);
    if (!info.isDirectory()) return `${target}:${info.mtimeMs}:${info.size}`;

    const entries = await readdir(target, { withFileTypes: true });
    const children = await Promise.all(entries.map((entry) => fingerprint(path.join(target, entry.name))));
    return `${target}:${children.sort().join("|")}`;
  } catch (error) {
    if (error?.code === "ENOENT") return `${target}:missing`;
    throw error;
  }
}

async function snapshot() {
  return (await Promise.all(watchedPaths.map(fingerprint))).join("\n");
}

async function poll() {
  try {
    const nextSnapshot = await snapshot();
    if (nextSnapshot !== previousSnapshot) {
      previousSnapshot = nextSnapshot;
      scheduleRefresh();
    }
  } catch (error) {
    console.error("\n[watch] Could not scan files:", error.message);
  }
}

previousSnapshot = await snapshot();
await refresh();
setInterval(poll, 750);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stopAstro();
    process.exit();
  });
}
