"use strict";

const path = require("node:path");

function fail(message) {
  console.error(`Unsafe PM2 release configuration: ${message}`);
  process.exit(72);
}

const [configPath, expectedApiCwd, mode] = process.argv.slice(2);
if (!configPath || !expectedApiCwd || !["current", "rollback-api"].includes(mode)) {
  fail("invalid validator invocation");
}

let config;
try {
  config = require(path.resolve(configPath));
} catch {
  fail("configuration cannot be loaded");
}

if (!config || !Array.isArray(config.apps)) {
  fail("apps must be an array");
}
if (Object.keys(config).length !== 1 || !Object.hasOwn(config, "apps")) {
  fail("top-level PM2 configuration contains an unexpected surface");
}

const byName = new Map();
for (const app of config.apps) {
  if (!app || typeof app.name !== "string" || byName.has(app.name)) {
    fail("application names must be unique strings");
  }
  byName.set(app.name, app);

  for (const key of ["node_args", "interpreter_args", "env_file", "envFile"]) {
    if (Object.hasOwn(app, key)) {
      fail("external environment-file loaders and interpreter arguments are forbidden");
    }
  }
  for (const key of Object.keys(app)) {
    if (/^env_/i.test(key)) {
      fail("named PM2 environment blocks are forbidden");
    }
  }
  for (const key of Object.keys(app.env || {})) {
    if (/(?:PASSWORD|SECRET|TOKEN|CREDENTIAL|PRIVATE_KEY)/i.test(key)) {
      fail("secrets must not be embedded in the ecosystem file");
    }
  }
}

const releaseRoot = path.resolve(expectedApiCwd, "..", "..");
const isolatedRunner = "scripts/deploy/run-isolated-runtime.sh";

function requireApp(
  name,
  expectedCwd,
  script,
  allowedEnvironmentKeys,
  allowedApplicationKeys,
) {
  const app = byName.get(name);
  if (!app) fail(`missing ${name}`);
  const actualApplicationKeys = Object.keys(app).sort();
  if (
    actualApplicationKeys.join("\0") !==
    [...allowedApplicationKeys].sort().join("\0")
  ) {
    fail(`${name} has an unexpected PM2 configuration surface`);
  }
  if (path.resolve(app.cwd || "") !== path.resolve(expectedCwd)) {
    fail(`${name} has an unexpected working directory`);
  }
  if (app.script !== script) fail(`${name} has an unexpected entrypoint`);
  if (!app.env || typeof app.env !== "object" || Array.isArray(app.env)) {
    fail(`${name} must declare a plain environment map`);
  }
  const actualKeys = Object.keys(app.env || {}).sort();
  if (actualKeys.join("\0") !== [...allowedEnvironmentKeys].sort().join("\0")) {
    fail(`${name} has an unexpected inline environment surface`);
  }
  if (app.env.NODE_ENV !== "production") {
    fail(`${name} must run with NODE_ENV=production`);
  }
  return app;
}

const requiredNames =
  mode === "current"
    ? ["balanz-web-dev", "balanz-api-dev", "balanz-worker-dev"]
    : ["balanz-web-dev", "balanz-api-dev"];
const allowedNames = new Set([
  "balanz-web-dev",
  "balanz-api-dev",
  "balanz-worker-dev",
]);
if (
  requiredNames.some((name) => !byName.has(name)) ||
  [...byName.keys()].some((name) => !allowedNames.has(name)) ||
  (mode === "current" && byName.size !== 3) ||
  (mode === "rollback-api" && ![2, 3].includes(byName.size))
) {
  fail("the managed process set is unexpected");
}

const web = requireApp(
  "balanz-web-dev",
  releaseRoot,
  isolatedRunner,
  ["NODE_ENV"],
  ["args", "cwd", "env", "interpreter", "name", "script"],
);
if (web.args !== "web" || web.interpreter !== "/bin/bash") {
  fail("web isolated runner is unexpected");
}

const api = requireApp(
  "balanz-api-dev",
  releaseRoot,
  isolatedRunner,
  ["NODE_ENV"],
  ["args", "cwd", "env", "interpreter", "name", "script"],
);
if (api.args !== "api" || api.interpreter !== "/bin/bash") {
  fail("API isolated runner is unexpected");
}

// A previous Phase 0 release includes the worker in its ecosystem file. It is
// validated here but deliberately not started by the rollback path: forward
// migrations only prove compatibility for the previous web and API binaries.
if (mode === "current" || byName.has("balanz-worker-dev")) {
  const worker = requireApp(
    "balanz-worker-dev",
    releaseRoot,
    isolatedRunner,
    ["NODE_ENV"],
    [
      "args",
      "cwd",
      "env",
      "interpreter",
      "kill_timeout",
      "name",
      "script",
    ],
  );
  if (worker.args !== "worker" || worker.interpreter !== "/bin/bash") {
    fail("worker isolated runner is unexpected");
  }
  if (worker.kill_timeout !== 125000) {
    fail("worker kill timeout must preserve the validated shutdown window");
  }
}
