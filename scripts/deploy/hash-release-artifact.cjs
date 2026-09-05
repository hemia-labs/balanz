"use strict";

const { createHash } = require("node:crypto");
const { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } = require("node:fs");
const path = require("node:path");

const [requestedRoot] = process.argv.slice(2);
if (!requestedRoot || !path.isAbsolute(requestedRoot)) {
  throw new Error("usage: hash-release-artifact.cjs /absolute/release");
}

const root = realpathSync(requestedRoot);
const digest = createHash("sha256");
const excluded = new Set([".rollback-api-compatible"]);

function add(kind, relative, payload = Buffer.alloc(0)) {
  digest.update(kind);
  digest.update("\0");
  digest.update(relative.replaceAll(path.sep, "/"));
  digest.update("\0");
  digest.update(payload);
  digest.update("\0");
}

function walk(directory, relativeDirectory = "") {
  const entries = readdirSync(directory).sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );
  for (const name of entries) {
    if (!relativeDirectory && excluded.has(name)) continue;
    const relative = path.join(relativeDirectory, name);
    const absolute = path.join(directory, name);
    const stat = lstatSync(absolute);
    const mode = Buffer.from((stat.mode & 0o777).toString(8));
    if (stat.isSymbolicLink()) {
      add("L", relative, Buffer.concat([mode, Buffer.from("\0"), Buffer.from(readlinkSync(absolute))]));
    } else if (stat.isDirectory()) {
      add("D", relative, mode);
      walk(absolute, relative);
    } else if (stat.isFile()) {
      const contentDigest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
      add("F", relative, Buffer.from(`${mode.toString()}\0${stat.size}\0${contentDigest}`));
    } else {
      throw new Error(`unsupported release artifact type: ${relative}`);
    }
  }
}

walk(root);
process.stdout.write(`${digest.digest("hex")}\n`);
