import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function submodulePaths() {
  const output = git("config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$");
  return output.split("\n").map((line) => line.trim().split(/\s+/, 2)[1]);
}

const paths = submodulePaths();
const config = JSON.parse(await readFile("external.config.json", "utf8"));
const configuredPaths = Object.keys(config.sources ?? {}).map((source) => `${config.path ?? "external"}/${source}`);
const errors = [];

for (const path of paths) {
  try {
    await stat(`${path}/.git`);
  } catch {
    errors.push(`${path} is not initialized; run: npm run submodules:init`);
  }
}

for (const path of configuredPaths) {
  if (!paths.includes(path)) errors.push(`${path} is configured in external.config.json but not registered in .gitmodules`);
}

for (const path of paths) {
  if (!configuredPaths.includes(path)) errors.push(`${path} is registered in .gitmodules but missing from external.config.json`);
}

const statuses = git("submodule", "status", "--recursive").split("\n").filter(Boolean);
for (const status of statuses) {
  if (status.startsWith("-")) errors.push(`${status.slice(1).trim()} is not initialized`);
  if (status.startsWith("U")) errors.push(`${status.slice(1).trim()} has unresolved submodule conflicts`);
}

if (errors.length) {
  console.error("Submodule check failed:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Submodule check passed (${paths.length} repositories).`);
}
