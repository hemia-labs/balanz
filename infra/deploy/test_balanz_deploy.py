import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('balanz_deploy', Path(__file__).with_name('balanz-deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
COMMIT = 'a' * 40


def make_bundle(path, tag='balanz-v0.1.1', migrations=None):
    path.mkdir(parents=True)
    api = deploy.REGISTRY + '/balanz/api@sha256:' + 'b' * 64
    data = {'schema': 1, 'tag': tag, 'commit': COMMIT, 'registry': deploy.REGISTRY,
            'domains': deploy.DOMAINS, 'images': {'api': api, 'worker': api, 'web': deploy.REGISTRY + '/balanz/web@sha256:' + 'c' * 64},
            'migrations': migrations or {}}
    (path / 'release.json').write_text(json.dumps(data))
    return deploy.bundle(path)


def response(url, **kwargs):
    value = io.BytesIO(json.dumps({'process': 'api' if ':53021' in url else 'worker'}).encode())
    value.status = 200
    return value


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / 'host'
        (self.root / 'shared').mkdir(parents=True)
        for name in ('api', 'worker', 'migration'):
            path = self.root / 'shared' / (name + '.env')
            path.write_text('SECRET=test-only-' + name + '\n')
            path.chmod(0o600)
        self.bundle = self.base / 'bundle'
        make_bundle(self.bundle)
        self.settings = {'mode': 'validation', 'registry_host': deploy.REGISTRY, 'project': 'hemia-balanz-validation',
                         'network': 'balanz-docker-validation', 'bind_address': '127.0.0.1',
                         'api_port': 53021, 'web_port': 55181, 'worker_port': 53002,
                         'database_name': 'balanz_docker_validation_test', 'database_host': 'balanz-validation-postgres'}
        self.commands = []
        self.host = patch.object(deploy, 'host_settings', return_value=self.settings)
        self.host.start()
        self.addCleanup(self.host.stop)
        self.run = patch.object(deploy.subprocess, 'run', side_effect=self.command)
        self.run_mock = self.run.start()
        self.addCleanup(self.run.stop)
        self.inspect = patch.object(deploy.subprocess, 'check_output', return_value=json.dumps({'org.opencontainers.image.revision': COMMIT}))
        self.inspect.start()
        self.addCleanup(self.inspect.stop)
        self.http = patch.object(deploy.urllib.request, 'urlopen', side_effect=response)
        self.http.start()
        self.addCleanup(self.http.stop)

    def command(self, args, **kwargs):
        self.commands.append(args)
        return subprocess.CompletedProcess(args, 0)

    def statuses(self):
        return [json.loads(line)['status'] for line in (self.root / 'history.jsonl').read_text().splitlines()]

    def install_current(self, migrations=None):
        current = self.root / 'releases/balanz-v0.1.0'
        make_bundle(current, 'balanz-v0.1.0', migrations)
        (self.root / 'current').symlink_to(current)
        return current

    def test_bundle_and_closed_compose(self):
        data = deploy.read_manifest(self.bundle)
        config = json.loads((self.bundle / 'compose.json').read_text())
        self.assertEqual(config['services']['worker']['image'], data['images']['api'])
        self.assertEqual(config['services']['worker']['stop_grace_period'], '125s')
        self.assertEqual(config['services']['migrator']['profiles'], ['operations'])
        self.assertTrue(all('build' not in value for value in config['services'].values()))
        config['services']['api']['privileged'] = True
        (self.bundle / 'compose.json').write_text(json.dumps(config))
        with self.assertRaisesRegex(ValueError, 'checksum'):
            deploy.read_manifest(self.bundle)

    def test_healthy_deploy_promotes_after_checks_and_freezes_runtime_envs(self):
        deploy.perform(self.root, self.bundle, 'deploy')
        self.assertEqual((self.root / 'current').resolve().name, 'balanz-v0.1.1')
        snapshot = self.root / 'runtime-config/balanz-v0.1.1/api.env'
        self.assertEqual(snapshot.read_text(), 'SECRET=test-only-api\n')
        (self.root / 'shared/api.env').write_text('SECRET=rotated\n')
        deploy.perform(self.root, self.bundle, 'deploy')
        self.assertEqual(snapshot.read_text(), 'SECRET=test-only-api\n')
        commands = ' '.join(' '.join(args) for args in self.commands)
        self.assertIn('pull', commands)
        self.assertIn('check-release-schema.js', commands)
        self.assertNotIn('seed', commands)
        self.assertNotIn('pm2', commands)
        self.assertNotIn('migration:run', commands)
        self.assertEqual(self.statuses(), ['healthy', 'healthy'])

    def test_pending_migrations_do_not_replace_containers(self):
        self.install_current()
        def command(args, **kwargs):
            self.commands.append(args)
            if 'dist/database/scripts/check-release-schema.js' in args:
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0)
        self.run_mock.side_effect = command
        with self.assertRaises(subprocess.CalledProcessError):
            deploy.perform(self.root, self.bundle, 'deploy')
        self.assertFalse(any('up' in args for args in self.commands))
        self.assertEqual((self.root / 'current').resolve().name, 'balanz-v0.1.0')
        self.assertEqual(self.statuses(), ['preflight_failed'])

    def test_failed_health_restores_previous_release_when_schema_matches(self):
        current = self.install_current()
        def command(args, **kwargs):
            self.commands.append(args)
            if 'up' in args and '/balanz-v0.1.1/compose.json' in ' '.join(args):
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0)
        self.run_mock.side_effect = command
        with self.assertRaises(subprocess.CalledProcessError):
            deploy.perform(self.root, self.bundle, 'deploy')
        self.assertEqual((self.root / 'current').resolve(), current.resolve())
        self.assertTrue(any('up' in args and '/balanz-v0.1.0/compose.json' in ' '.join(args) for args in self.commands))
        self.assertEqual(self.statuses(), ['failed', 'recovered'])

    def test_failed_health_with_new_schema_stops_only_own_services(self):
        self.install_current()
        newer = self.base / 'new-schema'
        make_bundle(newer, migrations={'New123.ts': 'd' * 64})
        def command(args, **kwargs):
            self.commands.append(args)
            if 'up' in args:
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0)
        self.run_mock.side_effect = command
        with self.assertRaises(subprocess.CalledProcessError):
            deploy.perform(self.root, newer, 'deploy')
        self.assertEqual(self.statuses(), ['failed', 'recovery_disabled'])
        self.assertTrue(any(args[-4:] == ['stop', 'api', 'worker', 'web'] for args in self.commands))
        self.assertEqual((self.root / 'current').resolve().name, 'balanz-v0.1.0')

    def test_first_failed_release_is_removed_without_deleting_data(self):
        def command(args, **kwargs):
            self.commands.append(args)
            if 'up' in args:
                raise subprocess.CalledProcessError(1, args)
            return subprocess.CompletedProcess(args, 0)
        self.run_mock.side_effect = command
        with self.assertRaises(subprocess.CalledProcessError):
            deploy.perform(self.root, self.bundle, 'deploy')
        self.assertTrue(any(args[-1] == 'down' for args in self.commands))
        self.assertFalse(any('--volumes' in args for args in self.commands))
        self.assertFalse((self.root / 'current').exists())

    def test_rollback_requires_schema_acknowledgement(self):
        current = self.root / 'releases/balanz-v0.2.0'
        make_bundle(current, 'balanz-v0.2.0', {'New123.ts': 'd' * 64})
        (self.root / 'current').symlink_to(current)
        with self.assertRaisesRegex(ValueError, 'schema compatibility'):
            deploy.perform(self.root, self.bundle, 'rollback')
        self.assertEqual(self.commands, [])
        deploy.perform(self.root, self.bundle, 'rollback', acknowledge_schema=True)
        self.assertEqual((self.root / 'previous').resolve(), current.resolve())

    def test_migration_requires_backup_and_does_not_promote_or_seed(self):
        with self.assertRaisesRegex(ValueError, 'backup'):
            deploy.perform(self.root, self.bundle, 'migrate')
        deploy.perform(self.root, self.bundle, 'migrate', backup_confirmed=True)
        commands = ' '.join(' '.join(args) for args in self.commands)
        self.assertIn('run-migrations.js', commands)
        self.assertNotIn('seed', commands)
        self.assertFalse((self.root / 'current').exists())
        self.assertEqual(self.statuses(), ['migrated'])

    def test_validation_rejects_pm2_ports_and_production_database(self):
        self.host.stop()
        for field, value in [('api_port', 3021), ('database_name', 'accounting_dev')]:
            settings = {**self.settings, field: value}
            (self.root / 'shared/host.json').write_text(json.dumps(settings))
            with self.assertRaisesRegex(ValueError, 'isolated test database and alternate ports'):
                deploy.host_settings(self.root)

    def test_live_requires_explicit_host_opt_in(self):
        self.host.stop()
        (self.root / 'shared/host.json').write_text(json.dumps({**self.settings, 'mode': 'live', 'api_port': 3021, 'web_port': 5181, 'worker_port': 3002}))
        with self.assertRaisesRegex(ValueError, 'Live deployment is disabled'):
            deploy.host_settings(self.root)



class RemoteReleaseTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('balanz_remote', Path(__file__).with_name('balanz-remote.py'))
        self.remote = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.remote)
        self.manifest = {'tag': 'balanz-v0.1.1', 'commit': 'a' * 40}
        self.release = {'draft': False, 'prerelease': False, 'immutable': True}
        self.reference = {'object': {'type': 'commit', 'sha': 'a' * 40}}
        self.comparison = {'status': 'ahead'}
        self.environment = {
            'DEPLOY_HOST': '167.114.113.141', 'DEPLOY_USER': 'ubuntu',
            'DEPLOY_PATH': '/srv/apps/balanz-docker-validation', 'TARGET_MODE': 'validation',
            'DEPLOY_KEY_FILE': '/tmp/key', 'DEPLOY_KNOWN_HOSTS_FILE': '/tmp/known',
        }

    def invoke(self):
        from unittest.mock import patch
        with patch.object(self.remote.sys, 'argv', ['remote', 'deploy', 'balanz-v0.1.1', '/tmp/bundle']), \
             patch.dict(self.remote.os.environ, self.environment, clear=True), \
             patch.object(self.remote.deploy, 'read_manifest', return_value=self.manifest), \
             patch.object(self.remote.subprocess, 'check_output', side_effect=[
                 json.dumps(self.release), json.dumps(self.reference), json.dumps(self.comparison),
                 '/tmp/balanz-release.ABC12345\n',
             ]), patch.object(self.remote.subprocess, 'run') as run:
            self.remote.main()
            return run.call_args_list

    def test_rejects_mutable_release_before_ssh(self):
        self.release['immutable'] = False
        with self.assertRaisesRegex(ValueError, 'immutable stable release'):
            self.invoke()

    def test_rejects_tag_commit_mismatch(self):
        self.reference['object']['sha'] = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'Tag and bundle commit differ'):
            self.invoke()

    def test_rejects_commit_outside_main(self):
        self.comparison['status'] = 'diverged'
        with self.assertRaisesRegex(ValueError, 'not on main'):
            self.invoke()

    def test_transfers_only_bundle_and_cleans_remote_directory(self):
        calls = self.invoke()
        self.assertEqual(len(calls), 3)
        transfer, activate, cleanup = [call.args[0] for call in calls]
        self.assertEqual(transfer[0], 'scp')
        for asset in self.remote.deploy.ASSETS:
            self.assertIn('/tmp/bundle/' + asset, transfer)
        self.assertIn('StrictHostKeyChecking=yes', activate)
        self.assertIn('sudo -n -- python3', activate[-1])
        self.assertIn('--root /srv/apps/balanz-docker-validation', activate[-1])
        self.assertEqual(cleanup[-1], 'rm -rf -- /tmp/balanz-release.ABC12345')

if __name__ == '__main__':
    unittest.main()
