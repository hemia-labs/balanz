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
if (cmd === 'pm2') {
  const file = process.env.DEPLOY_ROOT + '/pm2-state.json';
  let processes = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rollback = process.cwd().endsWith('/releases/old');
  if (args[0] === 'jlist') {
    if (rollback && process.env.QA_FAILURE === 'worker-list') process.exit(1);
    if (rollback && process.env.QA_FAILURE === 'worker-absent' && processes.some(p => p.pm2_env.pm_cwd.endsWith('/new/apps/api'))) processes = processes.filter(p => p.name !== 'balanz-worker-dev');
    console.log(JSON.stringify(processes));
  }
  if (args[0] === 'delete') {
    if (rollback && process.env.QA_FAILURE === 'worker-delete') process.exit(1);
    processes = processes.filter(p => p.name !== args[1]);
  }
  if (args[0] === 'start') {
    for (const app of require(args[1]).apps) {
      if (processes.some(p => p.name === app.name)) process.exit(2);
      processes.push({name: app.name, pm2_env: {
        pm_cwd: app.cwd, pm_exec_path: path.resolve(app.cwd, app.script), node_args: app.node_args || []
      }});
    }
    if (!rollback && process.env.QA_FAILURE === 'stale-path') processes.find(p => p.name === 'balanz-api-dev').pm2_env.pm_exec_path = '/stale/main.js';
  }
  fs.writeFileSync(file, JSON.stringify(processes));
}
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
      (call) => call.cmd === "pm2" && call.args[0] === "start",
    );
    assert.equal(reloaded, failure === "worker-absent");
    const saved = rollbackCalls.some(
      (call) => call.cmd === "pm2" && call.args[0] === "save",
    );
    assert.equal(saved, failure === "worker-absent");
    if (failure === "worker-absent") {
      assert(
        !rollbackCalls.some(
          (call) =>
            call.cmd === "pm2" &&
            call.args[0] === "delete" &&
            call.args[1] === "balanz-worker-dev",
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
    "releases/new/infra/deploy",
  ]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  fs.copyFileSync(
    path.join(__dirname, "retain-releases.cjs"),
    path.join(dir, "releases/new/infra/deploy/retain-releases.cjs"),
  );
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
  fs.writeFileSync(
    path.join(dir, "pm2-state.json"),
    JSON.stringify([
      ...["balanz-web-dev", "balanz-api-dev", "balanz-worker-dev"].map(
        (name) => ({
          name,
          pm2_env: {
            pm_cwd: "/stale",
            pm_exec_path: "/stale/main.js",
            node_args: ["--env-file=/wrong.env"],
          },
        }),
      ),
      { name: "unrelated-app", pm2_env: { pm_cwd: "/other" } },
    ]),
  );
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

for (const failure of ["", "migration", "readiness", "stale-path"]) {
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
    const state = JSON.parse(fs.readFileSync(`${dir}/pm2-state.json`, "utf8"));
    assert(state.some((p) => p.name === "unrelated-app"));
    const api = state.find((p) => p.name === "balanz-api-dev").pm2_env;
    const selected = failure ? "old" : "new";
    assert.equal(
      api.pm_exec_path,
      `${dir}/releases/${selected}/apps/api/dist/main.js`,
    );
    assert.equal(
      api.node_args,
      `--env-file=${dir}/runtime-config/${selected}/api/runtime.env`,
    );
    if (failure) {
      assert(
        calls.some(
          (c) =>
            c.cmd === "pm2" &&
            c.args[0] === "start" &&
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

test("rollback recreates a legacy release without worker or inherited node arguments", (t) => {
  const { dir, env } = fixture(t, "readiness");
  const configPath = `${dir}/releases/old/ecosystem.config.cjs`;
  const config = require(configPath);
  config.apps = config.apps.filter((app) => app.name !== "balanz-worker-dev");
  for (const app of config.apps) delete app.node_args;
  fs.writeFileSync(configPath, "module.exports = " + JSON.stringify(config));
  const result = spawnSync("bash", ["-s", "--", `${dir}/releases/new`, dir], {
    input: activation,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  const processes = JSON.parse(
    fs.readFileSync(`${dir}/pm2-state.json`, "utf8"),
  );
  assert(!processes.some((p) => p.name === "balanz-worker-dev"));
  assert.deepEqual(
    processes.find((p) => p.name === "balanz-api-dev").pm2_env.node_args,
    [],
  );
  const calls = fs
    .readFileSync(env.QA_LOG, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((c) => c.cwd === `${dir}/releases/old`);
  assert(
    calls.some(
      (c) =>
        c.cmd === "curl" && c.args.at(-1) === "http://127.0.0.1:3021/api/v1",
    ),
  );
  assert(calls.some((c) => c.cmd === "pm2" && c.args[0] === "save"));
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
