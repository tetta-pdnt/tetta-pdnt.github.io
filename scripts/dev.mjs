import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const buildScript = fileURLToPath(new URL("./build-feed.mjs", import.meta.url));
const astroBin = fileURLToPath(new URL("../node_modules/.bin/astro", import.meta.url));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await run(process.execPath, [buildScript, "--assign-missing-ids"]);

const astro = spawn(astroBin, ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => astro.kill(signal));
}

astro.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
