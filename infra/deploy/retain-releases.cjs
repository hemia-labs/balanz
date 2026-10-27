const fs = require("node:fs");
const path = require("node:path");

function retainReleases(root, previous = "") {
  root = fs.realpathSync(root);
  const releases = path.join(root, "releases");
  const configs = path.join(root, "runtime-config");
  for (const directory of [releases, configs]) {
    if (
      !fs.lstatSync(directory).isDirectory() ||
      fs.realpathSync(directory) !== directory
    ) {
      throw new Error("Retention requires real release/config directories");
    }
  }
  const current = fs.realpathSync(path.join(root, "current"));
  if (path.dirname(current) !== releases)
    throw new Error("Current is outside releases");
  if (previous && path.dirname(previous) !== releases)
    throw new Error("Previous is outside releases");
  const entries = fs
    .readdirSync(releases, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.name),
    );
  const marker = ".deploy-success";
  const successful = entries
    .flatMap((entry) => {
      const file = path.join(releases, entry.name, marker);
      if (!fs.existsSync(file)) return [];
      if (!fs.lstatSync(file).isFile())
        throw new Error("Invalid deployment success marker");
      const date = Date.parse(fs.readFileSync(file, "utf8").trim());
      if (!Number.isFinite(date))
        throw new Error("Invalid deployment success timestamp");
      return [{ name: entry.name, date }];
    })
    .sort((a, b) => b.date - a.date || a.name.localeCompare(b.name));
  if (!entries.some((entry) => entry.name === path.basename(current)))
    throw new Error("Invalid current release directory");
  const prior = successful.filter(
    (entry) => entry.name !== path.basename(current),
  );
  if (
    previous &&
    prior.some((entry) => entry.name === path.basename(previous))
  ) {
    prior.sort(
      (a, b) =>
        Number(b.name === path.basename(previous)) -
        Number(a.name === path.basename(previous)),
    );
  }
  const keep = new Set([
    path.basename(current),
    ...prior.slice(0, 2).map((entry) => entry.name),
  ]);
  // Preserve the legacy rollback target until successful deployments replace it.
  if (previous) keep.add(path.basename(previous));
  const obsolete = entries.filter((entry) => !keep.has(entry.name));
  for (const entry of obsolete) {
    const config = path.join(configs, entry.name);
    if (fs.existsSync(config) && !fs.lstatSync(config).isDirectory()) {
      throw new Error(
        "Refusing to remove a non-directory release configuration",
      );
    }
  }
  fs.writeFileSync(path.join(current, marker), new Date().toISOString(), {
    mode: 0o600,
  });
  for (const entry of obsolete) {
    if (fs.realpathSync(path.join(root, "current")) !== current)
      throw new Error("Current changed during retention");
    fs.rmSync(path.join(configs, entry.name), { recursive: true, force: true });
    fs.rmSync(path.join(releases, entry.name), { recursive: true });
    console.log(`Removed release and configuration: ${entry.name}`);
  }
  return [...keep];
}

module.exports = { retainReleases };
if (require.main === module) retainReleases(process.argv[2], process.argv[3]);
