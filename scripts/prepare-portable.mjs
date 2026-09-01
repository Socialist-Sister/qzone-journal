import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const output = path.join(root, "release", `QZoneJournal-${packageJson.version}-portable.zip`);
const result = spawnSync("tar.exe", ["-a", "-c", "-f", output, "win-unpacked"], { cwd: path.join(root, "release"), stdio: "inherit" });
if (result.status !== 0) process.exit(result.status || 1);
console.log(output);
