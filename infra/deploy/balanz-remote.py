"""Verify an immutable GitHub release, then transfer only its deployment assets."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys

spec = importlib.util.spec_from_file_location('balanz_deploy', Path(__file__).with_name('balanz-deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def main():
    operation, tag, bundle = sys.argv[1:]
    if operation not in ('deploy', 'rollback', 'migrate') or not deploy.TAG.fullmatch(tag):
        raise ValueError('Invalid deployment operation or release tag')
    manifest = deploy.read_manifest(bundle)
    if manifest['tag'] != tag:
        raise ValueError('Bundle and requested release differ')

    def github(path):
        return json.loads(subprocess.check_output(['gh', 'api', 'repos/hemia-labs/balanz/' + path], text=True))

    release = github('releases/tags/' + tag)
    if release['draft'] or release['prerelease'] or release.get('immutable') is not True:
        raise ValueError('Expected an immutable stable release')
    reference = github('git/ref/tags/' + tag)['object']
    for _ in range(5):
        if reference['type'] != 'tag':
            break
        reference = github('git/tags/' + reference['sha'])['object']
    if reference['type'] != 'commit' or reference['sha'] != manifest['commit']:
        raise ValueError('Tag and bundle commit differ')
    if github('compare/' + manifest['commit'] + '...main')['status'] not in ('ahead', 'identical'):
        raise ValueError('Release commit is not on main')

    host, user, root = [os.environ[key] for key in ('DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_PATH')]
    port = int(os.environ.get('DEPLOY_PORT', '22'))
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]*', host) or not re.fullmatch(r'[a-z_][a-z0-9_-]*', user):
        raise ValueError('Invalid SSH host/user')
    mode = os.environ['TARGET_MODE']
    if mode not in ('validation', 'live') or root != '/srv/apps/balanz-docker-' + mode or not 1 <= port <= 65535:
        raise ValueError('Expected dedicated Docker deployment root and valid port')
    if operation == 'migrate' and os.environ.get('BACKUP_CONFIRMATION') != 'I_HAVE_A_BACKUP':
        raise ValueError('Explicit backup confirmation is required')
    options = ['-i', os.environ['DEPLOY_KEY_FILE'], '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
               '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + os.environ['DEPLOY_KNOWN_HOSTS_FILE'],
               '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4']
    target = user + '@' + host
    ssh = ['ssh', *options, '-p', str(port), target]
    temporary = subprocess.check_output(ssh + ['mktemp -d /tmp/balanz-release.XXXXXXXX'], text=True).strip()
    if not re.fullmatch(r'/tmp/balanz-release\.[a-zA-Z0-9]+', temporary):
        raise ValueError('Unexpected remote temporary directory')
    try:
        subprocess.run(['scp', *options, '-P', str(port), *[str(Path(bundle) / name) for name in deploy.ASSETS],
                        target + ':' + temporary + '/'], check=True)
        command = ([] if user == 'root' else ['sudo', '-n', '--']) + [
            'python3', temporary + '/balanz-deploy.py', operation, '--root', root, '--bundle', temporary]
        if os.environ.get('ACKNOWLEDGE_SCHEMA') == 'true':
            command.append('--acknowledge-schema')
        if operation == 'migrate':
            command.append('--backup-confirmed')
        subprocess.run(ssh + [shlex.join(command)], check=True)
    finally:
        subprocess.run(ssh + [shlex.join(['rm', '-rf', '--', temporary])], check=False)


if __name__ == '__main__':
    main()
