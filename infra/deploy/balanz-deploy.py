"""Package, validate and activate digest-pinned Balanz releases; never manages PM2."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.request

REGISTRY = 'registry.hemia.cloud'
TAG = re.compile(r'balanz-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
ASSETS = ('release.json', 'compose.json', 'balanz-deploy.py', 'SHA256SUMS')
DOMAINS = {'web': 'https://contable.hemia.dev', 'api': 'https://api-contable.hemia.dev/api/v1'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def compose_config(images):
    def health(port, path):
        return {'test': ['CMD', 'node', '-e',
                "fetch('http://127.0.0.1:" + str(port) + path + "',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
                'interval': '5s', 'timeout': '5s', 'start_period': '15s', 'retries': 12}

    shared = {'init': True, 'restart': 'unless-stopped', 'read_only': True,
              'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'],
              'pids_limit': 128, 'tmpfs': ['/tmp:rw,noexec,nosuid,size=64m'],
              'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}}}
    storage = '${BALANZ_STORAGE_ROOT:?Set private storage root}:/var/lib/balanz/object-storage'
    api = {**shared, 'image': images['api'],
           'env_file': [{'path': '${BALANZ_API_ENV_FILE:?Set API env}', 'format': 'raw'}],
           'environment': {'APP_HOST': '0.0.0.0', 'APP_PORT': '3021', 'NODE_OPTIONS': '--max-old-space-size=384'},
           'ports': ['${BALANZ_BIND_ADDRESS}:${BALANZ_API_PORT}:3021'],
           'extra_hosts': ['host.docker.internal:host-gateway'], 'volumes': [storage],
           'mem_limit': '512m', 'stop_grace_period': '30s', 'healthcheck': health(3021, '/readiness')}
    worker = {**shared, 'image': images['worker'], 'command': ['node', 'dist/worker.js'],
              'env_file': [{'path': '${BALANZ_WORKER_ENV_FILE:?Set worker env}', 'format': 'raw'}],
              'environment': {'WORKER_HEALTH_HOST': '0.0.0.0', 'WORKER_HEALTH_PORT': '3002', 'NODE_OPTIONS': '--max-old-space-size=384'},
              'ports': ['${BALANZ_BIND_ADDRESS}:${BALANZ_WORKER_PORT}:3002'],
              'extra_hosts': ['host.docker.internal:host-gateway'], 'volumes': [storage],
              'mem_limit': '768m', 'stop_grace_period': '125s', 'healthcheck': health(3002, '/readiness')}
    web = {**shared, 'image': images['web'], 'mem_limit': '384m',
           'environment': {'NODE_ENV': 'production', 'HOSTNAME': '0.0.0.0', 'PORT': '5181', 'NODE_OPTIONS': '--max-old-space-size=256'},
           'tmpfs': shared['tmpfs'] + ['/app/apps/web/.next/cache:rw,uid=1000,gid=1000,mode=0700,size=128m'],
           'ports': ['${BALANZ_BIND_ADDRESS}:${BALANZ_WEB_PORT}:5181'],
           'depends_on': {'api': {'condition': 'service_healthy'}}, 'healthcheck': health(5181, '/')}
    migrator = {**shared, 'image': images['api'], 'profiles': ['operations'], 'restart': 'no',
                'mem_limit': '512m', 'healthcheck': {'disable': True},
                'env_file': [{'path': '${BALANZ_MIGRATION_ENV_FILE:?Set migration env}', 'format': 'raw'}],
                'extra_hosts': ['host.docker.internal:host-gateway'],
                'command': ['node', 'dist/database/scripts/run-migrations.js']}
    return {'services': {'api': api, 'worker': worker, 'web': web, 'migrator': migrator},
            'networks': {'default': {'name': '${BALANZ_DOCKER_NETWORK:?Set dedicated network}', 'external': True}}}


def validate_identity(data):
    if data.get('schema') != 1 or not TAG.fullmatch(data.get('tag', '')):
        raise ValueError('Invalid Balanz release')
    if not re.fullmatch('[a-f0-9]{40}', data.get('commit', '')) or data.get('registry') != REGISTRY:
        raise ValueError('Unexpected commit or registry')
    if data.get('domains') != DOMAINS:
        raise ValueError('Public domains must remain unchanged')
    for service in ('api', 'web'):
        if not re.fullmatch(re.escape(REGISTRY) + '/balanz/' + service + r'@sha256:[a-f0-9]{64}', data.get('images', {}).get(service, '')):
            raise ValueError('Expected a pinned Balanz image')
    if data['images'].get('worker') != data['images']['api']:
        raise ValueError('Worker must reuse the API image')
    if not isinstance(data.get('migrations'), dict) or any(
            not re.fullmatch(r'[A-Za-z0-9_-]+\.ts', name) or not re.fullmatch('[a-f0-9]{64}', value)
            for name, value in data['migrations'].items()):
        raise ValueError('Invalid migration manifest')
    return data


def bundle(directory):
    directory = Path(directory)
    data = validate_identity(json.loads((directory / 'release.json').read_text()))
    (directory / 'compose.json').write_text(json.dumps(compose_config(data['images']), indent=2) + '\n')
    (directory / 'balanz-deploy.py').write_bytes(Path(__file__).read_bytes())
    data['files'] = {name: digest(directory / name) for name in ('compose.json', 'balanz-deploy.py')}
    (directory / 'release.json').write_text(json.dumps(data, indent=2) + '\n')
    (directory / 'SHA256SUMS').write_text(''.join(digest(directory / name) + '  ' + name + '\n' for name in ASSETS[:-1]))
    return read_manifest(directory)


def read_manifest(directory):
    directory = Path(directory)
    for name in ASSETS:
        if (directory / name).is_symlink() or not (directory / name).is_file():
            raise ValueError('Missing or symlinked release asset: ' + name)
    data = validate_identity(json.loads((directory / 'release.json').read_text()))
    if data.get('files') != {name: digest(directory / name) for name in ('compose.json', 'balanz-deploy.py')}:
        raise ValueError('Release asset checksum mismatch')
    if json.loads((directory / 'compose.json').read_text()) != compose_config(data['images']):
        raise ValueError('Compose differs from the closed release template')
    expected = ''.join(digest(directory / name) + '  ' + name + '\n' for name in ASSETS[:-1])
    if (directory / 'SHA256SUMS').read_text() != expected:
        raise ValueError('Invalid SHA256SUMS')
    return data


def private_env(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Environment file must be private and not a symlink: ' + path.name)
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        if not match or match[1] in values:
            raise ValueError('Invalid or duplicate environment entry in ' + path.name)
        values[match[1]] = match[2]
    return values


def host_settings(root):
    settings = json.loads((root / 'shared/host.json').read_text())
    if settings.get('registry_host') != REGISTRY or settings.get('bind_address') != '127.0.0.1':
        raise ValueError('Expected public registry and loopback-only ports')
    if settings.get('mode') not in ('validation', 'live'):
        raise ValueError('Expected validation or live mode')
    if not re.fullmatch(r'hemia-balanz-[a-z0-9-]+', settings.get('project', '')):
        raise ValueError('Invalid dedicated Compose project')
    if not re.fullmatch(r'balanz-[a-z0-9-]+', settings.get('network', '')):
        raise ValueError('Invalid dedicated Docker network')
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', settings.get('database_name', '')):
        raise ValueError('Expected database name is required')
    ports = tuple(settings.get(name) for name in ('api_port', 'web_port', 'worker_port'))
    if settings['mode'] == 'validation':
        if ports != (53021, 55181, 53002) or not re.fullmatch(r'balanz_docker_[a-z0-9_]+_test', settings['database_name']):
            raise ValueError('Validation must use isolated test database and alternate ports')
        if not re.fullmatch(r'balanz-[a-z0-9-]+', settings.get('database_host', '')):
            raise ValueError('Validation requires a dedicated database container')
        for name in ('api', 'worker', 'migration'):
            values = private_env(root / 'shared' / (name + '.env'))
            required = {'SECRETS_ENABLED': 'false', 'DB_HOST': settings['database_host'], 'DB_DATABASE': settings['database_name']}
            if name != 'migration':
                required.update({'NODE_ENV': 'development', 'REDIS_ENABLED': 'false', 'REDIS_WAKEUP_ENABLED': 'false',
                                 'OBJECT_STORAGE_DRIVER': 'local', 'OBJECT_STORAGE_LOCAL_ROOT': '/var/lib/balanz/object-storage', 'MALWARE_SCANNER_MODE': 'bypass'})
            if any(values.get(key) != value for key, value in required.items()):
                raise ValueError('Validation environment is not isolated: ' + name)
    elif settings.get('enable_live') is not True or ports != (3021, 5181, 3002):
        raise ValueError('Live deployment is disabled or uses unexpected ports')
    for name in ('api', 'worker', 'migration'):
        private_env(root / 'shared' / (name + '.env'))
    storage = root / 'shared/object-storage'
    if not storage.is_dir() or storage.is_symlink() or storage.stat().st_uid != 1000:
        raise ValueError('Provision private object storage owned by container UID 1000')
    return settings


def link(root, name, target):
    temporary = root / ('.' + name + '.next')
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    temporary.replace(root / name)


def version(tag):
    return tuple(map(int, tag.removeprefix('balanz-v').split('.')))


def schema_compatible(before, after):
    return before['migrations'] == after['migrations']


def perform(root, directory, operation, acknowledge_schema=False, backup_confirmed=False):
    root = Path(root).resolve()
    settings = host_settings(root)
    incoming = read_manifest(directory)
    release = root / 'releases' / incoming['tag']
    release.parent.mkdir(mode=0o700, exist_ok=True)
    if release.exists():
        if read_manifest(release) != incoming:
            raise ValueError('Refusing to overwrite an existing release')
    else:
        staging = release.with_name('.' + incoming['tag'] + '.incoming')
        staging.mkdir(mode=0o700)
        for name in ASSETS:
            shutil.copy2(Path(directory) / name, staging / name)
        staging.rename(release)
    current = (root / 'current').resolve() if (root / 'current').exists() else None
    if current and current.parent != root / 'releases':
        raise ValueError('Current release escapes deployment root')
    old = read_manifest(current) if current else None
    if operation == 'rollback':
        if not old or version(incoming['tag']) >= version(old['tag']):
            raise ValueError('Rollback must select an older release')
        if not schema_compatible(old, incoming) and not acknowledge_schema:
            raise ValueError('Review schema compatibility and acknowledge before rollback')
    elif operation == 'deploy' and old and version(incoming['tag']) < version(old['tag']):
        raise ValueError('Use rollback to deploy an older release')
    if operation == 'migrate' and not backup_confirmed:
        raise ValueError('Verify and confirm backup before migrations')

    def environment(directory):
        config = root / 'runtime-config' / directory.name
        config.mkdir(mode=0o700, parents=True, exist_ok=True)
        for name in ('api', 'worker'):
            original = root / 'shared' / (name + '.env')
            destination = config / (name + '.env')
            if destination.exists():
                private_env(destination)
            else:
                shutil.copyfile(original, destination)
                destination.chmod(0o600)
        return {'PATH': os.environ['PATH'], 'HOME': os.environ['HOME'],
                'BALANZ_API_ENV_FILE': str(config / 'api.env'), 'BALANZ_WORKER_ENV_FILE': str(config / 'worker.env'),
                'BALANZ_MIGRATION_ENV_FILE': str(root / 'shared/migration.env'),
                'BALANZ_STORAGE_ROOT': str(root / 'shared/object-storage'), 'BALANZ_DOCKER_NETWORK': settings['network'],
                'BALANZ_BIND_ADDRESS': settings['bind_address'], 'BALANZ_API_PORT': str(settings['api_port']),
                'BALANZ_WEB_PORT': str(settings['web_port']), 'BALANZ_WORKER_PORT': str(settings['worker_port'])}

    def compose(directory, *args):
        return subprocess.run(['docker', 'compose', '--env-file', '/dev/null', '-p', settings['project'],
                               '-f', str(directory / 'compose.json'), *args], env=environment(directory),
                              check=True, text=True)

    def ready(directory):
        compose(directory, 'run', '--rm', '--no-deps', 'migrator', 'node',
                'dist/database/scripts/check-release-schema.js', settings['database_name'])

    def start(directory):
        compose(directory, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120', 'api', 'worker', 'web')
        for name, port, process in [('api', settings['api_port'], 'api'), ('worker', settings['worker_port'], 'worker'), ('web', settings['web_port'], None)]:
            with urllib.request.urlopen('http://127.0.0.1:' + str(port) + ('/readiness' if process else '/'), timeout=15) as response:
                if response.status != 200 or (process and json.load(response).get('process') != process):
                    raise ValueError('Host health probe failed: ' + name)
        if settings['mode'] == 'live':
            for url in (DOMAINS['web'], 'https://api-contable.hemia.dev/readiness'):
                with urllib.request.urlopen(url, timeout=15) as response:
                    if response.status != 200:
                        raise ValueError('Public HTTPS probe failed')

    def record(status, **extra):
        with (root / 'history.jsonl').open('a') as history:
            history.write(json.dumps({'time': datetime.now(timezone.utc).isoformat(), 'operation': operation,
                          'tag': incoming['tag'], 'commit': incoming['commit'], 'mode': settings['mode'],
                          'status': status, **extra}) + '\n')

    compose(release, 'config', '--quiet')
    compose(release, 'pull')
    for name in ('api', 'web'):
        result = subprocess.check_output(['docker', 'image', 'inspect', incoming['images'][name], '--format', '{{json .Config.Labels}}'], text=True)
        if json.loads(result).get('org.opencontainers.image.revision') != incoming['commit']:
            raise ValueError('Image belongs to another commit')
    if operation == 'migrate':
        try:
            compose(release, 'run', '--rm', '--no-deps', 'migrator', 'node', 'dist/database/scripts/run-migrations.js')
        except Exception:
            record('migration_failed')
            raise
        record('migrated')
        return
    try:
        ready(release)
    except Exception:
        record('preflight_failed')
        raise
    try:
        start(release)
    except Exception:
        record('failed')
        if current and schema_compatible(old, incoming):
            try:
                ready(current)
                start(current)
                record('recovered', recovered_tag=old['tag'])
            except Exception:
                record('recovery_failed')
                raise
        elif not current:
            compose(release, 'down')
        else:
            record('recovery_disabled')
            compose(release, 'stop', 'api', 'worker', 'web')
        raise
    if current and current != release:
        link(root, 'previous', current)
    link(root, 'current', release)
    record('healthy')
    print('Healthy Balanz Docker release: ' + incoming['tag'] + ' (' + settings['mode'] + ')')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['bundle', 'validate', 'deploy', 'rollback', 'migrate'])
    parser.add_argument('--root')
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--acknowledge-schema', action='store_true')
    parser.add_argument('--backup-confirmed', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    if args.operation == 'bundle':
        bundle(args.bundle)
    elif args.operation == 'validate':
        read_manifest(args.bundle)
    else:
        root = Path(args.root or '')
        if not root.is_absolute() or not root.is_dir() or root.resolve() == Path('/'):
            raise ValueError('Expected existing absolute deployment root')
        with (root / '.deploy.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            perform(root, args.bundle, args.operation, args.acknowledge_schema, args.backup_confirmed)


if __name__ == '__main__':
    main()
