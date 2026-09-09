const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { retainReleases } = require("./retain-releases.cjs");

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "balanz-retention-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of [
    "current-release",
    "old1",
    "old2",
    "old3",
    "failed",
    "legacy",
  ]) {
    fs.mkdirSync(`${root}/releases/${name}`, { recursive: true });
    fs.mkdirSync(`${root}/runtime-config/${name}`, { recursive: true });
    fs.writeFileSync(`${root}/runtime-config/${name}/runtime.env`, "fixture");
  }
  for (const [index, name] of ["old1", "old2", "old3"].entries()) {
    fs.writeFileSync(
      `${root}/releases/${name}/.deploy-success`,
      `2026-09-0${index + 1}T00:00:00Z`,
    );
  }
  fs.symlinkSync(`${root}/releases/current-release`, `${root}/current`);
  return root;
}

test("keeps current and two successes; removes failed code and configuration", (t) => {
  const root = fixture(t);
  retainReleases(root, `${root}/releases/old3`);
  assert.deepEqual(fs.readdirSync(`${root}/releases`).sort(), [
    "current-release",
    "old2",
    "old3",
  ]);
  assert.deepEqual(fs.readdirSync(`${root}/runtime-config`).sort(), [
    "current-release",
    "old2",
    "old3",
  ]);
  assert(fs.existsSync(`${root}/releases/current-release/.deploy-success`));
});

test("reserves a successful rollback target even when older", (t) => {
  const root = fixture(t);
  retainReleases(root, `${root}/releases/old1`);
  assert.deepEqual(fs.readdirSync(`${root}/releases`).sort(), [
    "current-release",
    "old1",
    "old3",
  ]);
});

test("protects unmarked legacy rollback during transition", (t) => {
  const root = fixture(t);
  retainReleases(root, `${root}/releases/legacy`);
  assert(fs.existsSync(`${root}/releases/legacy`));
  assert(!fs.existsSync(`${root}/releases/legacy/.deploy-success`));
});

test("refuses configuration symlinks before deleting anything", (t) => {
  const root = fixture(t);
  fs.rmSync(`${root}/runtime-config/failed`, { recursive: true });
  fs.symlinkSync(`${root}/releases/old1`, `${root}/runtime-config/failed`);
  assert.throws(() => retainReleases(root), /non-directory/);
  assert(fs.existsSync(`${root}/releases/old1`));
  assert(fs.existsSync(`${root}/releases/failed`));
});
