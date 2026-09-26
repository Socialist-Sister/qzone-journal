// Keep locally retained older releases out of the current release manifest.
export function selectReleaseAssets(names, version, latestMetadata = "") {
  const currentPrefix = `QZoneJournal-${version}-`;
  const latestVersion = latestMetadata.match(/^version:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  return names.filter((name) => (
    name.startsWith(currentPrefix) && /\.(?:exe|zip|blockmap)$/i.test(name)
    || name === "latest.yml" && latestVersion === version
    || name === "SBOM.cdx.json"
    || name === "THIRD_PARTY_LICENSES.json"
  )).sort();
}
