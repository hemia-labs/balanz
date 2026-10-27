#!/usr/bin/env python3
"""Exercise built images against an isolated, disposable PostgreSQL database.

No host ports, shared environments, Vault credentials or production data are used.
The explicit development profile permits local storage/scanner bypass; production does not.
"""
import json
import secrets
import sys
import subprocess
import time
import uuid

API = 'balanz-api:test'
WEB = 'balanz-web:test'
API_URL = 'https://api-contable.hemia.dev/api/v1'


def docker(*args, check=True):
    result = subprocess.run(['docker', *args], text=True, capture_output=True)
    if check and result.returncode:
        if args[0] == 'exec' and 'is not running' in result.stderr:
            raise ChildProcessError('Test container exited: ' + args[1])
        raise RuntimeError('docker ' + args[0] + ' failed: ' + result.stderr[-3000:])
    return result


def environment(values):
    return [item for key, value in values.items() for item in ('--env', key + '=' + str(value))]


def wait_for(callback, description, timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            return callback()
        except (AssertionError, RuntimeError, ValueError):
            time.sleep(2)
    raise RuntimeError('Timed out: ' + description)


def http(container, url):
    script = "fetch(process.argv[1],{signal:AbortSignal.timeout(5000)}).then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()}))).catch(()=>process.exit(1))"
    return json.loads(docker('exec', container, 'node', '-e', script, url).stdout)


def main(api_only=False):
    prefix = 'balanz-image-' + uuid.uuid4().hex[:10]
    network, storage, postgres, api, worker, web = [prefix + '-' + name for name in ('network', 'storage', 'postgres', 'api', 'worker', 'web')]
    containers = []
    password = secrets.token_urlsafe(32)
    api_password = secrets.token_urlsafe(32)
    worker_password = secrets.token_urlsafe(32)
    common = {'NODE_ENV': 'development', 'SECRETS_ENABLED': 'false', 'DB_HOST': postgres,
              'DB_PORT': '5432', 'DB_DATABASE': 'balanz_image_test', 'DB_LOGGING': 'false'}
    migrator = {**common, 'DB_USERNAME': 'postgres', 'DB_PASSWORD': password}
    runtime = {**common, 'REDIS_ENABLED': 'false', 'REDIS_WAKEUP_ENABLED': 'false',
               'OBJECT_STORAGE_DRIVER': 'local', 'OBJECT_STORAGE_LOCAL_ROOT': '/app/.local/fiscal-object-storage',
               'MALWARE_SCANNER_MODE': 'bypass'}
    try:
        for image in ((API,) if api_only else (API, WEB)):
            user = docker('image', 'inspect', image, '--format', '{{.Config.User}}').stdout.strip()
            assert user == 'node', image + ' must run without root'
        docker('run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', API, '-e',
               "const fs=require('fs');const b=require('bcrypt');if(!b.compareSync('test',b.hashSync('test',4)))process.exit(1);"
               "if(!fs.readdirSync('dist/modules/cfdi-parser/schemas',{recursive:true}).some(p=>p.endsWith('.xsd')))process.exit(1)")
        docker('network', 'create', network)
        docker('volume', 'create', storage)
        docker('run', '--rm', '--network', 'none', '--user', '0', '-v', storage + ':/storage',
               '--entrypoint', 'sh', API, '-c', 'chown 1000:1000 /storage && chmod 0700 /storage')
        containers.append(postgres)
        docker('run', '-d', '--name', postgres, '--network', network,
               '-e', 'POSTGRES_PASSWORD=' + password, '-e', 'POSTGRES_DB=balanz_image_test', 'postgres:16')

        def database_ready():
            assert docker('exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'balanz_image_test', check=False).returncode == 0
        wait_for(database_ready, 'disposable PostgreSQL')
        docker('exec', postgres, 'psql', '-U', 'postgres', '-d', 'balanz_image_test', '-v', 'ON_ERROR_STOP=1',
               '-c', 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
        docker('run', '--rm', '--network', network, *environment(migrator), API,
               'node', 'dist/database/scripts/run-migrations.js')
        docker('run', '--rm', '--network', network,
               *environment({**migrator, 'CFDI_PROVISION_RUNTIME_LOGINS': 'true',
                             'DB_API_USERNAME': 'balanz_image_api', 'DB_API_PASSWORD': api_password,
                             'DB_WORKER_USERNAME': 'balanz_image_worker', 'DB_WORKER_PASSWORD': worker_password}),
               API, 'node', 'dist/database/scripts/provision-fiscal-runtime-logins.js')

        print('Disposable database migrated and distinct runtime roles provisioned', flush=True)
        containers.append(api)
        docker('run', '-d', '--name', api, '--network', network, '--read-only',
               '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-v', storage + ':/app/.local/fiscal-object-storage',
               *environment({**runtime, 'DB_API_USERNAME': 'balanz_image_api', 'DB_API_PASSWORD': api_password,
                             'JWT_SECRET': 'a' * 64, 'JWT_REFRESH_SECRET': 'b' * 64, 'BCRYPT_SALT_ROUNDS': '10',
                             'MFA_ENCRYPTION_KEY': 'M' * 43 + '=',
                             'APP_HOST': '0.0.0.0', 'APP_CORS_ORIGINS': 'https://contable.hemia.dev',
                             'EMAIL_APP_URL': 'https://contable.hemia.dev',
                             'HEMIA_CLIENT_SECRET': 'image-smoke-client-secret',
                             'PAYMENTS_CONNECTION': json.dumps({
                                 'issuer': 'http://localhost:1', 'tokenUrl': 'http://localhost:1/oauth/token',
                                 'clientId': 'balanz-service', 'baseUrl': 'http://localhost:1/api/v1',
                                 'audience': 'billing-api', 'productCode': 'balanz_cfdi',
                                 'successUrl': 'https://contable.hemia.dev/success',
                                 'cancelUrl': 'https://contable.hemia.dev/cancel',
                                 'allowHttpLoopback': True, 'requestTimeoutMs': 100,
                             })}), API)
        containers.append(worker)
        docker('run', '-d', '--name', worker, '--network', network, '--read-only',
               '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-v', storage + ':/app/.local/fiscal-object-storage',
               '--health-cmd', "node -e \"fetch('http://127.0.0.1:3002/liveness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
               *environment({**runtime, 'DB_WORKER_USERNAME': 'balanz_image_worker', 'DB_WORKER_PASSWORD': worker_password,
                             'WORKER_HEALTH_HOST': '0.0.0.0'}), API, 'node', 'dist/worker.js')

        def ready(name, port):
            if docker('inspect', name, '--format', '{{.State.Running}}').stdout.strip() != 'true':
                raise ChildProcessError('Test container exited: ' + name)
            response = http(worker if name == api else api, 'http://' + name + ':' + str(port) + '/readiness')
            assert response['status'] == 200
            assert json.loads(response['body'])['process'] in ('api', 'worker')
        wait_for(lambda: ready(api, 3021), 'API readiness through container network')
        wait_for(lambda: ready(worker, 3002), 'worker readiness through container network')
        print('API and worker readiness verified across the container network', flush=True)

        if not api_only:
            containers.append(web)
            docker('run', '-d', '--name', web, '--network', network, '--read-only',
                   '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
                   '--tmpfs', '/app/apps/web/.next/cache:rw,uid=1000,gid=1000,mode=0700,size=128m', WEB)
            def frontend():
                response = http(api, 'http://' + web + ':5181/')
                assert response['status'] == 200
                assert '<html' in response['body']
            wait_for(frontend, 'standalone frontend through container network')
            docker('exec', web, 'node', '-e',
                   "const fs=require('fs'),p=require('path');const root='apps/web/.next/static';"
                   "const files=fs.readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.js'));"
                   "if(!files.some(f=>fs.readFileSync(p.join(root,f),'utf8').includes(process.argv[1])))process.exit(1)", API_URL)
        # SIGTERM must stop the worker inside its existing 125-second PM2 grace window.
        docker('stop', '--time', '125', worker)
        assert docker('inspect', worker, '--format', '{{.State.ExitCode}}').stdout.strip() == '0'
        assert docker('inspect', worker, '--format', '{{.State.OOMKilled}}').stdout.strip() == 'false'
        print('Images verified: non-root, native bcrypt/XSD assets, isolated DB/runtime roles, API/worker readiness and graceful worker shutdown' + ('; web excluded (--api-only)' if api_only else '; web/domain verified'))
    except Exception:
        for name in containers:
            # Test-only environments contain no real secrets; keep diagnostics bounded.
            result = docker('logs', '--tail', '30', name, check=False)
            if result.returncode == 0:
                print('Test container diagnostics:', name, result.stdout[-2000:], result.stderr[:5000])
        raise
    finally:
        for name in reversed(containers):
            docker('rm', '-f', '-v', name, check=False)
        docker('volume', 'rm', storage, check=False)
        docker('network', 'rm', network, check=False)


if __name__ == '__main__':
    main(api_only='--api-only' in sys.argv)
