const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/deploy-dev.yml"),
  "utf8",
);
const activation = workflow
  .split("- name: Install and activate release")[1]
  .split("<<'REMOTE'\n")[1]
  .split("\n          REMOTE")[0]
  .replace(/^          /gm, "")
  .replace(
    'source "$HOME/.nvm/nvm.sh"',
    ": # host runtime setup is outside this test",
  )
  .replace(
    'export PATH="$HOME/.bun/bin:$PATH"',
    ": # retain process doubles first in PATH",
  );
const upload = workflow
  .split("- name: Upload runtime configuration")[1]
  .split("        run: |\n")[1]
  .split("\n      - name:")[0]
  .replace(/^          /gm, "");

// Execute the workflow's actual shell with local process doubles, never SSH/PM2.
const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cmd = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.QA_LOG, JSON.stringify({cmd, args, cwd: process.cwd()}) + '\\n');
if (cmd === 'ssh') {
  const command = args.at(-1);
  if (process.env.QA_FAILURE === 'upload' && command.includes('/worker/')) process.exit(1);
  process.exit(spawnSync('bash', ['-c', command], {stdio: 'inherit'}).status);
}
if (cmd === 'mv') fs.renameSync(args.at(-2), args.at(-1));
if (cmd === 'chmod') fs.chmodSync(args.at(-1), parseInt(args[0], 8));
if (cmd === 'pm2' && args[0] === 'jlist') {
  if (process.env.QA_FAILURE === 'worker-list') process.exit(1);
  console.log(JSON.stringify(process.env.QA_FAILURE === 'worker-absent' ? [] : [{name: 'balanz-worker-dev'}]));
}
if (cmd === 'pm2' && args[0] === 'delete' && process.env.QA_FAILURE === 'worker-delete') process.exit(1);
if (cmd === 'bun' && args.includes('release:prepare') && process.env.QA_FAILURE === 'migration') process.exit(1);
if (cmd === 'curl' && (process.env.QA_FAILURE === 'rollback-readiness' ||
    (['readiness', 'worker-delete', 'worker-absent', 'worker-list'].includes(process.env.QA_FAILURE) &&
    fs.readlinkSync(process.env.DEPLOY_ROOT + '/current').endsWith('/new'))) &&
    args.at(-1).endsWith('/readiness')) process.exit(1);
`;

for (const failure of ["worker-delete", "worker-absent", "worker-list"]) {
  test(`rollback handles ${failure} explicitly`, (t) => {
    const { dir, env } = fixture(t, failure);
    const result = spawnSync("bash", ["-s", "--", `${dir}/releases/new`, dir], {
      input: activation,
      env,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      failure === "worker-absent" ? 1 : 75,
      result.stderr,
    );
    const rollbackCalls = fs
      .readFileSync(env.QA_LOG, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((call) => call.cwd === `${dir}/releases/old`);
    const reloaded = rollbackCalls.some(
      (call) => call.cmd === "pm2" && call.args[0] === "startOrReload",
    );
    assert.equal(reloaded, failure === "worker-absent");
    const saved = rollbackCalls.some(
      (call) => call.cmd === "pm2" && call.args[0] === "save",
    );
    assert.equal(saved, failure === "worker-absent");
    if (failure === "worker-absent") {
      assert(
        !rollbackCalls.some(
          (call) => call.cmd === "pm2" && call.args[0] === "delete",
        ),
      );
    }
  });
}

function fixture(t, failure = "") {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "balanz-deploy-test-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const sub of [
    "bin",
    "shared",
    "releases/old",
    "releases/new",
    "runtime-config/old/api",
    "runtime-config/old/worker",
    "runtime-config/new/api",
    "runtime-config/new/worker",
    "releases/new/apps/api",
  ]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  for (const name of ["bun", "pm2", "curl", "mv", "ssh", "chmod"]) {
    fs.writeFileSync(path.join(dir, "bin", name), mock, { mode: 0o700 });
  }
  for (const release of ["old", "new"]) {
    fs.copyFileSync(
      path.join(root, "ecosystem.config.cjs"),
      path.join(dir, "releases", release, "ecosystem.config.cjs"),
    );
    for (const profile of ["api", "worker"]) {
      fs.writeFileSync(
        path.join(dir, "runtime-config", release, profile, "runtime.env"),
        `${release}-${profile}`,
      );
    }
  }
  for (const profile of ["api", "worker"])
    fs.writeFileSync(
      path.join(dir, "shared", `${profile}.env`),
      `legacy-${profile}`,
    );
  fs.writeFileSync(
    path.join(dir, "runtime-config/new/migration.env"),
    "test-migration",
  );
  fs.symlinkSync(path.join(dir, "releases/old"), path.join(dir, "current"));
  const env = {
    ...process.env,
    PATH: `${dir}/bin:${process.env.PATH}`,
    DEPLOY_ROOT: dir,
    RELEASE_ID: "new",
    DEPLOY_USER: "test",
    VPS_HOST: "test",
    QA_FAILURE: failure,
    QA_LOG: path.join(dir, "calls"),
    API_ENV: "new-api",
    WORKER_ENV: "new-worker",
    MIGRATION_ENV: "test-migration",
  };
  return { dir, env };
}

for (const failure of ["", "migration", "readiness"]) {
  test(`activation ${failure || "success"} preserves release configuration`, (t) => {
    const { dir, env } = fixture(t, failure);
    const result = spawnSync("bash", ["-s", "--", `${dir}/releases/new`, dir], {
      input: activation,
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, failure ? 1 : 0, result.stderr);
    assert.equal(
      fs.readlinkSync(`${dir}/current`),
      `${dir}/releases/${failure ? "old" : "new"}`,
    );
    assert.equal(
      fs.existsSync(`${dir}/runtime-config/new/migration.env`),
      false,
    );
    for (const profile of ["api", "worker"]) {
      assert.equal(
        fs.readFileSync(
          `${dir}/runtime-config/old/${profile}/runtime.env`,
          "utf8",
        ),
        `old-${profile}`,
      );
      assert.equal(
        fs.readFileSync(`${dir}/shared/${profile}.env`, "utf8"),
        `legacy-${profile}`,
      );
    }
    const calls = fs
      .readFileSync(env.QA_LOG, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    if (failure) {
      assert(
        calls.some(
          (c) =>
            c.cmd === "pm2" &&
            c.args[0] === "startOrReload" &&
            c.cwd === `${dir}/releases/old`,
        ),
      );
      assert(
        calls.some(
          (c) =>
            c.cmd === "curl" &&
            c.args.at(-1) === "http://127.0.0.1:3002/readiness",
        ),
      );
    }
  });
}

test("partial upload leaves active and legacy configuration unchanged", (t) => {
  const { dir, env } = fixture(t, "upload");
  fs.unlinkSync(`${dir}/runtime-config/new/worker/runtime.env`);
  const result = spawnSync("bash", ["-e", "-s"], {
    input: upload,
    env,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readlinkSync(`${dir}/current`), `${dir}/releases/old`);
  for (const profile of ["api", "worker"]) {
    assert.equal(
      fs.readFileSync(
        `${dir}/runtime-config/old/${profile}/runtime.env`,
        "utf8",
      ),
      `old-${profile}`,
    );
    assert.equal(
      fs.readFileSync(`${dir}/shared/${profile}.env`, "utf8"),
      `legacy-${profile}`,
    );
  }
  const activationResult = spawnSync(
    "bash",
    ["-s", "--", `${dir}/releases/new`, dir],
    { input: activation, env, encoding: "utf8" },
  );
  assert.notEqual(activationResult.status, 0);
  const calls = fs.readFileSync(env.QA_LOG, "utf8");
  assert(!calls.includes('"stop"'));
});

test("PM2 uses each concrete release configuration, regardless of current", (t) => {
  const { dir } = fixture(t);
  for (const release of ["old", "new"]) {
    const config = require(`${dir}/releases/${release}/ecosystem.config.cjs`);
    for (const profile of ["api", "worker"]) {
      assert.equal(
        config.apps.find((app) => app.name === `balanz-${profile}-dev`)
          .node_args,
        `--env-file=${dir}/runtime-config/${release}/${profile}/runtime.env`,
      );
    }
  }
});

test("rollback readiness failure is reported as a failed restore", (t) => {
  const { dir, env } = fixture(t, "rollback-readiness");
  const result = spawnSync("bash", ["-s", "--", `${dir}/releases/new`, dir], {
    input: activation,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 75, result.stderr);
  assert.equal(fs.readlinkSync(`${dir}/current`), `${dir}/releases/old`);
});

test("complete upload publishes private, release-specific files", (t) => {
  const { dir, env } = fixture(t);
  const result = spawnSync("bash", ["-e", "-s"], {
    input: upload,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  for (const profile of ["api", "worker"]) {
    const file = `${dir}/runtime-config/new/${profile}/runtime.env`;
    assert.equal(fs.readFileSync(file, "utf8"), `new-${profile}\n`);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  }
});
