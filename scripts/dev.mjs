import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const astroBin = fileURLToPath(new URL("../node_modules/.bin/astro", import.meta.url));

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
