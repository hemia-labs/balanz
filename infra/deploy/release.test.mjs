import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isApplicationChangeset, isVersionBatch, releaseTag, validateManifest, verifyLabels, writeReleaseBundle } from './release.mjs';

const note = { path: '.changeset/first-release.md', source: '---\n"api": patch\n"web": patch\n---\n\nPublish images.\n' };
const files = ['apps/api/package.json', 'apps/web/package.json', 'apps/api/CHANGELOG.md', 'apps/web/CHANGELOG.md', 'bun.lock', note.path];

test('bootstrap consumes a Changeset and aligns the unequal existing versions', () => {
  assert(isVersionBatch({ api: '0.0.1', web: '0.1.0' }, { api: '0.1.1', web: '0.1.1' }, files, [note]));
  assert(!isVersionBatch({ api: '0.0.1', web: '0.1.0' }, { api: '0.0.1', web: '0.1.0' }, ['apps/api/Dockerfile'], []));
});

test('functional code and manual version changes cannot accidentally publish a release', () => {
  const before = { api: '0.1.0', web: '0.1.0' }, after = { api: '0.1.1', web: '0.1.1' };
  assert(!isVersionBatch(before, after, [...files, 'apps/api/src/main.ts'], [note]));
  assert(!isVersionBatch(before, after, files, []));
  assert(!isVersionBatch(before, after, files.filter(name => name !== 'bun.lock'), [note]));
  assert.throws(() => isVersionBatch(after, before, files, [note]));
});

test('Changesets only accept application targets and explicit SemVer bump types', () => {
  assert(isApplicationChangeset(note.source));
  assert(!isApplicationChangeset('---\n"unknown": patch\n---\n'));
  assert(!isApplicationChangeset('---\n"api": latest\n---\n'));
  assert(!isApplicationChangeset('# README'));
});

test('retry tags must exactly match both stable package versions', () => {
  assert.equal(releaseTag('balanz-v1.0.0', '1.0.0', '1.0.0'), 'balanz-v1.0.0');
  assert(compareVersions('1.10.0', '1.9.0') > 0);
  assert.throws(() => releaseTag('balanz-v1.0.0', '1.0.1', '1.0.1'));
  assert.throws(() => releaseTag('balanz-v1.0.0', '1.0.0', '1.0.1'));
  assert.throws(() => releaseTag('balanz-v1.0.0-beta.1', '1.0.0-beta.1', '1.0.0-beta.1'));
});

test('published/reused images must match source commit, version and current API domain', () => {
  const labels = { 'org.opencontainers.image.revision': 'a'.repeat(40), 'org.opencontainers.image.version': '1.0.0', 'io.hemia.api-url': 'https://api-contable.hemia.dev/api/v1' };
  verifyLabels(labels, 'a'.repeat(40), '1.0.0', 'web');
  assert.throws(() => verifyLabels(labels, 'b'.repeat(40), '1.0.0', 'web'));
  assert.throws(() => verifyLabels({ ...labels, 'io.hemia.api-url': 'https://other.example' }, 'a'.repeat(40), '1.0.0', 'web'));
});

test('release manifest pins API/worker and web to the expected registry', () => {
  const api = 'registry.hemia.cloud/balanz/api@sha256:' + 'a'.repeat(64);
  const manifest = { schema: 1, files: { 'compose.json': 'd'.repeat(64), 'balanz-deploy.py': 'e'.repeat(64) }, tag: 'balanz-v1.0.0', commit: 'b'.repeat(40), registry: 'registry.hemia.cloud', images: { api, worker: api, web: 'registry.hemia.cloud/balanz/web@sha256:' + 'c'.repeat(64) }, domains: { web: 'https://contable.hemia.dev', api: 'https://api-contable.hemia.dev/api/v1' } };
  validateManifest(manifest, manifest.tag, manifest.commit);
  assert.throws(() => validateManifest({ ...manifest, images: { ...manifest.images, api: 'registry.hemia.cloud/balanz/api:latest' } }, manifest.tag, manifest.commit));
  assert.throws(() => validateManifest({ ...manifest, images: { ...manifest.images, worker: manifest.images.web } }, manifest.tag, manifest.commit));
  assert.throws(() => validateManifest(manifest, manifest.tag, 'd'.repeat(40)));
});

test('real Changesets version + Bun lock refresh produces a publishable version-only commit', async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { execFileSync } = await import('node:child_process');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'balanz-version-test-'));
  const command = (name, ...args) => execFileSync(name, args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' }).trim();
  try {
    for (const relative of ['package.json', 'bun.lock', 'apps/api/package.json', 'apps/web/package.json', 'infra/deploy/release.mjs']) {
      const target = join(directory, relative);
      mkdirSync(target.slice(0, target.lastIndexOf('/')), { recursive: true });
      copyFileSync(join(root, relative), target);
    }
    mkdirSync(join(directory, '.changeset'));
    copyFileSync(join(root, '.changeset/config.json'), join(directory, '.changeset/config.json'));
    writeFileSync(join(directory, note.path), note.source);
    command('git', 'init', '-b', 'main');
    command('git', 'add', '.');
    command('git', '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial release fixture');
    const before = command('git', 'rev-parse', 'HEAD');
    command(join(root, 'node_modules/.bin/changeset'), 'version');
    command('bun', 'install', '--lockfile-only', '--ignore-scripts');
    command('git', 'add', '.');
    command('git', '-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Version release fixture');
    const output = join(directory, 'github-output');
    execFileSync('node', ['infra/deploy/release.mjs', 'classify', before], { cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output } });
    const result = readFileSync(output, 'utf8');
    assert.match(result, /^release=true$/m);
    const version = JSON.parse(readFileSync(join(directory, 'apps/api/package.json'), 'utf8')).version;
    assert.match(result, new RegExp(`^tag=balanz-v${version.replaceAll('.', '\\.')}\\n`, 'm'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('release bundles include closed Compose and a checksummed deploy controller', async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const directory = mkdtempSync(join(tmpdir(), 'balanz-bundle-test-'));
  try {
    const api = 'registry.hemia.cloud/balanz/api@sha256:' + 'a'.repeat(64);
    const manifest = writeReleaseBundle(directory, { schema: 1, tag: 'balanz-v0.1.1', commit: 'b'.repeat(40),
      registry: 'registry.hemia.cloud', migrations: {}, images: { api, worker: api, web: 'registry.hemia.cloud/balanz/web@sha256:' + 'c'.repeat(64) },
      domains: { web: 'https://contable.hemia.dev', api: 'https://api-contable.hemia.dev/api/v1' } });
    const compose = JSON.parse(readFileSync(join(directory, 'compose.json'), 'utf8'));
    assert.deepEqual(Object.keys(compose.services).sort(), ['api', 'migrator', 'web', 'worker']);
    assert.equal(compose.services.worker.image, api);
    assert.deepEqual(compose.services.worker.command, ['node', 'dist/worker.js']);
    assert.equal(compose.services.worker.stop_grace_period, '125s');
    assert(compose.services.migrator.profiles.includes('operations'));
    for (const [name, checksum] of Object.entries(manifest.files))
      assert.equal(createHash('sha256').update(readFileSync(join(directory, name))).digest('hex'), checksum);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('first publication uses the created draft response even before list endpoints expose it', async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'balanz-first-publish-'));
  const commit = 'b'.repeat(40), tag = 'balanz-v0.1.1';
  const put = (path, source, mode) => {
    mkdirSync(join(directory, path, '..'), { recursive: true });
    writeFileSync(join(directory, path), source, { mode });
  };
  try {
    for (const name of ['api', 'web']) {
      put(`apps/${name}/package.json`, JSON.stringify({ version: '0.1.1' }));
      put(`apps/${name}/CHANGELOG.md`, '## 0.1.1\n\nRelease.\n');
    }
    mkdirSync(join(directory, '.changeset'));
    mkdirSync(join(directory, 'apps/api/src/database/migrations'), { recursive: true });
    put('infra/deploy/release.mjs', readFileSync(new URL('./release.mjs', import.meta.url)));
    copyFileSync(new URL('./balanz-deploy.py', import.meta.url), join(directory, 'infra/deploy/balanz-deploy.py'));
    put('bin/git', `#!/bin/sh\nprintf '${commit}\\n'\n`, 0o755);
    put('bin/docker', `#!/bin/sh\nif [ "$1 $2" = "image inspect" ]; then printf '%s\\n' '${JSON.stringify({ 'org.opencontainers.image.revision': commit, 'org.opencontainers.image.version': '0.1.1', 'io.hemia.api-url': 'https://api-contable.hemia.dev/api/v1' })}'; fi\n`, 0o755);
    put('bin/gh', `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2), endpoint = args[1];
fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'api') {
  if (args.includes('POST')) console.log(JSON.stringify({ id: 123, draft: true, target_commitish: '${commit}', assets: [] }));
  else if (endpoint.includes('git/ref/tags/')) {
    if (fs.existsSync(process.env.PUBLISHED)) console.log(JSON.stringify({ object: { type: 'commit', sha: '${commit}' } }));
    else { console.error('HTTP 404'); process.exit(1); }
  } else if (endpoint.includes('releases?')) console.log('[]');
  else if (fs.existsSync(process.env.PUBLISHED)) console.log(JSON.stringify({ immutable: true }));
  else { console.error('HTTP 404'); process.exit(1); }
} else if (args[1] === 'edit') fs.writeFileSync(process.env.PUBLISHED, 'yes');
`, 0o755);
    put('fetch.mjs', `globalThis.fetch = async () => ({ status: 200, headers: new Headers({ 'docker-content-digest': 'sha256:${'a'.repeat(64)}' }) });\n`);
    execFileSync(process.execPath, ['--import', join(directory, 'fetch.mjs'), 'infra/deploy/release.mjs', 'publish', tag], {
      cwd: directory, env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
        GITHUB_SHA: commit, GITHUB_REPOSITORY: 'hemia-labs/balanz', REGISTRY_HOST: 'registry.hemia.cloud',
        REGISTRY_USERNAME: 'test', REGISTRY_PASSWORD: 'test-only', CALLS: join(directory, 'calls'), PUBLISHED: join(directory, 'published') },
    });
    const calls = readFileSync(join(directory, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.filter(args => args.includes('POST')).length, 1);
    assert.equal(calls.filter(args => args[0] === 'release' && args[1] === 'upload').length, 4);
    assert.equal(readFileSync(join(directory, 'published'), 'utf8'), 'yes');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
