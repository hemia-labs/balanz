import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const versionFiles = ['apps/api/package.json', 'apps/web/package.json',
  'apps/api/CHANGELOG.md', 'apps/web/CHANGELOG.md', 'bun.lock'];
const registry = 'registry.hemia.cloud';
const apiUrl = 'https://api-contable.hemia.dev/api/v1';
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const run = (command, ...args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
const hash = content => createHash('sha256').update(content).digest('hex');
const output = values => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
};

export function compareVersions(left, right) {
  for (const version of [left, right]) assert(semver.test(version), 'Expected stable SemVer');
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function isApplicationChangeset(source) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source)?.[1];
  const lines = header?.split(/\r?\n/).map(line => line.trim()).filter(Boolean) ?? [];
  return lines.length > 0 && lines.every(line => /^["']?(api|web)["']?:\s*(major|minor|patch)$/.test(line));
}

export function isVersionBatch(before, after, files, removedNotes) {
  // The bootstrap commit still has the original, unequal package versions.
  if (before.api === after.api && before.web === after.web) return false;
  assert.equal(after.api, after.web, 'API and web must share a version');
  assert(compareVersions(after.api, before.api) > 0 && compareVersions(after.web, before.web) > 0,
    'Both package versions must increase');
  const notes = new Set(removedNotes.filter(note => isApplicationChangeset(note.source)).map(note => note.path));
  return notes.size > 0 && versionFiles.every(name => files.includes(name)) &&
    files.every(name => versionFiles.includes(name) || notes.has(name));
}

export function releaseTag(tag, api, web) {
  compareVersions(api, web);
  assert.equal(api, web, 'API and web must share a version');
  assert.equal(tag, `balanz-v${api}`, 'Tag must match the committed package versions');
  return tag;
}

export function verifyLabels(labels, commit, version, name) {
  assert.equal(labels?.['org.opencontainers.image.revision'], commit, `${name}: wrong source commit`);
  assert.equal(labels?.['org.opencontainers.image.version'], version, `${name}: wrong version`);
  if (name === 'web') assert.equal(labels?.['io.hemia.api-url'], apiUrl, 'Unexpected web API domain');
}

export function validateManifest(manifest, tag, commit) {
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.tag, tag);
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.registry, registry);
  assert.equal(manifest.domains?.web, 'https://contable.hemia.dev');
  assert.equal(manifest.domains?.api, apiUrl);
  for (const name of ['api', 'web']) assert(new RegExp(`^${registry.replaceAll('.', '\\.')}\\/balanz\\/${name}@sha256:[a-f0-9]{64}$`).test(manifest.images?.[name]), 'Invalid image digest');
  assert.equal(manifest.images.worker, manifest.images.api, 'Worker must reuse the API image');
  assert.deepEqual(Object.keys(manifest.files ?? {}).sort(), ['balanz-deploy.py', 'compose.json']);
  assert(Object.values(manifest.files).every(value => /^[a-f0-9]{64}$/.test(value)), 'Invalid asset checksums');
  return manifest;
}

export function writeReleaseBundle(directory, manifest) {
  writeFileSync(join(directory, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  run('python3', join(root, 'infra/deploy/balanz-deploy.py'), 'bundle', '--bundle', directory);
  return validateManifest(JSON.parse(readFileSync(join(directory, 'release.json'), 'utf8')), manifest.tag, manifest.commit);
}

function findRelease(tag) {
  const published = github(`releases/tags/${tag}`, true);
  if (published) return published;
  for (let page = 1; ; page++) {
    const releases = github(`releases?per_page=100&page=${page}`);
    const match = releases.find(release => release.tag_name === tag);
    if (match) return match;
    if (releases.length < 100) return null;
  }
}

const versions = () => Object.fromEntries(['api', 'web'].map(name =>
  [name, JSON.parse(readFileSync(join(root, 'apps', name, 'package.json'), 'utf8')).version]));
const pendingNotes = () => readdirSync(join(root, '.changeset')).filter(name => name.endsWith('.md') &&
  isApplicationChangeset(readFileSync(join(root, '.changeset', name), 'utf8')));

function notes(version) {
  return ['api', 'web'].map(name => {
    const text = readFileSync(join(root, 'apps', name, 'CHANGELOG.md'), 'utf8');
    const entry = text.split(/^## /m).slice(1).find(section => section.split(/\r?\n/, 1)[0].trim() === version);
    assert(entry, `Missing ${name} changelog for ${version}`);
    return `## ${name}\n\n${entry.slice(version.length).trim()}`;
  }).join('\n\n') + '\n';
}

function classify(base) {
  assert(/^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base), 'Expected previous main commit');
  const before = Object.fromEntries(['api', 'web'].map(name =>
    [name, JSON.parse(git('show', `${base}:apps/${name}/package.json`)).version]));
  const after = versions();
  const files = git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  const removed = git('diff', '--name-only', '--diff-filter=D', base, 'HEAD', '--', '.changeset')
    .split('\n').filter(path => /^\.changeset\/[a-z0-9-]+\.md$/.test(path))
    .map(path => ({ path, source: git('show', `${base}:${path}`) }));
  output({ release: isVersionBatch(before, after, files, removed), tag: `balanz-v${after.api}` });
}

function github(path, optional = false) {
  const result = spawnSync('gh', ['api', `repos/hemia-labs/balanz/${path}`], { encoding: 'utf8' });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (optional && /HTTP 404/.test(result.stderr)) return null;
  throw new Error(`GitHub request failed: ${path} (${result.status})`);
}

async function imageDigest(name, tag) {
  const password = process.env.REGISTRY_PASSWORD;
  assert(password && process.env.REGISTRY_USERNAME, 'Registry credentials are required');
  const response = await fetch(`https://${registry}/v2/balanz/${name}/manifests/${tag}`, {
    method: 'HEAD', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Basic ${Buffer.from(`${process.env.REGISTRY_USERNAME}:${password}`).toString('base64')}`,
      Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' },
  });
  if (response.status === 404) return null;
  assert.equal(response.status, 200, `Registry ${name} request failed: ${response.status}`);
  const digest = response.headers.get('docker-content-digest');
  assert(/^sha256:[a-f0-9]{64}$/.test(digest), 'Registry returned an invalid digest');
  return digest;
}

function verifyTagCommit(tag, commit, required = false) {
  let object = github(`git/ref/tags/${tag}`, true)?.object;
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) object = github(`git/tags/${object.sha}`).object;
  if (required) assert(object, 'Release tag was not created');
  if (object) assert(object.type === 'commit' && object.sha === commit, 'Existing tag belongs to another commit');
}

async function publish(tag) {
  const current = versions();
  releaseTag(tag, current.api, current.web);
  assert.equal(process.env.REGISTRY_HOST, registry, 'Unexpected registry host');
  assert.equal(process.env.GITHUB_REPOSITORY, 'hemia-labs/balanz');
  assert.equal(pendingNotes().length, 0, 'Consume Changesets through the version PR first');
  const commit = git('rev-parse', 'HEAD');
  assert.equal(process.env.GITHUB_SHA, commit, 'Checkout differs from release commit');
  verifyTagCommit(tag, commit);
  let existing = findRelease(tag);
  const temporary = mkdtempSync(join(tmpdir(), 'balanz-release-'));
  try {
    if (existing && !existing.draft) {
      assert(!existing.prerelease, 'Expected a stable release');
      run('gh', 'release', 'download', tag, '--repo', 'hemia-labs/balanz', '--pattern', 'release.json', '--dir', temporary);
      validateManifest(JSON.parse(readFileSync(join(temporary, 'release.json'), 'utf8')), tag, commit);
      console.log(`Release already published: ${tag}`);
      return;
    }
    if (existing) assert.equal(existing.target_commitish, commit, 'Draft belongs to another commit');
    const notesPath = join(temporary, 'notes.md');
    writeFileSync(notesPath, notes(current.api));
    if (!existing) {
      existing = JSON.parse(run('gh', 'api', 'repos/hemia-labs/balanz/releases', '--method', 'POST',
        '-f', `tag_name=${tag}`, '-f', `target_commitish=${commit}`, '-F', 'draft=true',
        '-f', `name=Balanz ${current.api}`, '-f', `body=${readFileSync(notesPath, 'utf8')}`));
    }
    const images = {};
    for (const name of ['api', 'web']) {
      const reference = `${registry}/balanz/${name}:${tag}`;
      let digest = await imageDigest(name, tag);
      if (digest) run('docker', 'pull', reference);
      const source = digest ? reference : `balanz-${name}:test`;
      const labels = JSON.parse(run('docker', 'image', 'inspect', source, '--format', '{{json .Config.Labels}}'));
      verifyLabels(labels, commit, current.api, name);
      if (!digest) {
        run('docker', 'tag', source, reference);
        run('docker', 'push', reference);
        digest = await imageDigest(name, tag);
        assert(digest, 'Published image is missing from registry');
      }
      images[name] = `${registry}/balanz/${name}@${digest}`;
    }
    images.worker = images.api;
    const migrations = Object.fromEntries(readdirSync(join(root, 'apps/api/src/database/migrations')).sort()
      .filter(name => name.endsWith('.ts')).map(name => [name, hash(readFileSync(join(root, 'apps/api/src/database/migrations', name)))]));
    writeReleaseBundle(temporary, { schema: 1, tag, commit, registry, images, migrations,
      domains: { web: 'https://contable.hemia.dev', api: apiUrl } });
    for (const name of ['release.json', 'compose.json', 'balanz-deploy.py', 'SHA256SUMS']) {
      const asset = join(temporary, name);
      if (existing.assets.some(item => item.name === name)) {
        const check = mkdtempSync(join(temporary, 'existing-'));
        run('gh', 'release', 'download', tag, '--repo', 'hemia-labs/balanz', '--pattern', name, '--dir', check);
        assert(readFileSync(asset).equals(readFileSync(join(check, name))), `Refusing to replace existing asset: ${name}`);
      } else run('gh', 'release', 'upload', tag, asset, '--repo', 'hemia-labs/balanz');
    }
    run('gh', 'release', 'edit', tag, '--repo', 'hemia-labs/balanz', '--draft=false');
    verifyTagCommit(tag, commit, true);
    assert(github(`releases/tags/${tag}`).immutable, 'Published release must be immutable');
    console.log(`Published ${tag}; Docker deployment can proceed`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, argument] = process.argv.slice(2);
  if (command === 'classify') classify(argument);
  else if (command === 'pending') output({ pending: pendingNotes().length > 0 });
  else if (command === 'retry') { const current = versions(); output({ release: true, tag: releaseTag(argument, current.api, current.web) }); }
  else if (command === 'publish') await publish(argument);
  else throw new Error('Usage: release.mjs <classify BASE_SHA|pending|retry TAG|publish TAG>');
}
