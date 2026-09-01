import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const releaseDirectory = path.join(root, "release");
await mkdir(releaseDirectory, { recursive: true });

const pnpmScript = process.env.npm_execpath;
if (!pnpmScript) throw new Error("请通过 pnpm run release:metadata 执行");
const licenseJson = execFileSync(process.execPath, [pnpmScript, "licenses", "list", "--prod", "--json"], { cwd: root, encoding: "utf8" });
const byLicense = JSON.parse(licenseJson);
const components = Object.entries(byLicense).flatMap(([license, packages]) => packages.flatMap((item) => item.versions.map((version) => ({
  type: "library",
  name: item.name,
  version,
  licenses: [{ expression: license }],
  purl: `pkg:npm/${encodeURIComponent(item.name).replace("%40", "@")}@${version}`,
  externalReferences: item.homepage ? [{ type: "website", url: item.homepage }] : undefined,
}))));
components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: { timestamp: new Date().toISOString(), component: { type: "application", name: packageJson.name, version: packageJson.version } },
  components,
};
await writeFile(path.join(releaseDirectory, "SBOM.cdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
await writeFile(path.join(releaseDirectory, "THIRD_PARTY_LICENSES.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), packages: components.map(({ name, version, licenses, externalReferences }) => ({ name, version, license: licenses[0].expression, homepage: externalReferences?.[0]?.url || "" })) }, null, 2)}\n`);

const candidates = (await readdir(releaseDirectory)).filter((name) => (
  /\.(?:exe|zip|blockmap)$/i.test(name)
  || name === "latest.yml"
  || name === "SBOM.cdx.json"
  || name === "THIRD_PARTY_LICENSES.json"
)).sort();
const sums = [];
for (const name of candidates) {
  const digest = createHash("sha256").update(await readFile(path.join(releaseDirectory, name))).digest("hex");
  sums.push(`${digest} *${name}`);
}
await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
console.log(`Generated metadata for ${components.length} production packages and ${candidates.length} release files.`);
