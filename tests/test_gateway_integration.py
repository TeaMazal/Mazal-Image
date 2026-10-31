import asyncio
from concurrent.futures import ThreadPoolExecutor
from email.parser import BytesParser
from email.policy import default
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import inspect
import json
import os
from pathlib import Path
import sys
import threading
import time
import unittest
import tempfile
from unittest.mock import patch

CUSTOMER = 'sk-isolated-customer-test'
REVOKED = 'sk-revoked-customer-test'
EMPTY = 'sk-zero-balance-test'
SEEN = []


class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.handle_request()

    def do_POST(self):
        self.handle_request()

    def handle_request(self):
        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        SEEN.append((self.path, token, self.headers.get('X-Real-IP'), body))
        if token in ('main-user-test', 'main-other-test') and self.path == '/api/v1/auth/me':
            code, data = 200, {'code': 0, 'data': {'id': 7 if token == 'main-user-test' else 8, 'role': 'user'}}
        elif token in ('main-user-test', 'main-other-test') and self.path.startswith('/api/v1/keys/'):
            code, data = 200, {'code': 0, 'data': {'id': 1, 'user_id': 7, 'status': 'active',
                'key': CUSTOMER, 'group': {'status': 'active', 'allow_image_generation': not self.path.endswith('/3')}}}
        elif token in (REVOKED, '') or token not in (CUSTOMER, EMPTY):
            code, data = 401, {'message': 'invalid key'}
        elif token == EMPTY and self.path != '/v1/usage':
            code, data = 403, {'message': 'insufficient balance'}
        elif self.path.startswith('/v1/images/'):
            code, data = 200, {'data': [{'url': 'https://example.invalid/test.png'}],
                               'usage': {'output_tokens': 1}}
        elif self.path == '/v1/usage':
            code, data = 200, {'mode': 'unrestricted', 'balance': 0 if token == EMPTY else 12.3456,
                               'remaining': 0 if token == EMPTY else 12.3456,
                               'unit': 'USD', 'key': 'must-not-be-returned', 'model_stats': [{'private': True}]}
        else:
            code, data = 200, {'data': [{'id': 'gpt-image-2'}]}
        encoded = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


server = ThreadingHTTPServer(('127.0.0.1', 0), Gateway)
threading.Thread(target=server.serve_forever, daemon=True).start()
temporary_state = tempfile.TemporaryDirectory(prefix='mazal-image-test-')
os.environ['MI_GATEWAY_URL'] = 'http://127.0.0.1:' + str(server.server_port)
os.environ['MI_MAIN_ORIGIN'] = 'https://main.example.test'
os.environ['MI_PUBLIC_ORIGIN'] = 'https://image.example.test'
os.environ['MI_SITE_NAME'] = 'Integration Test Site'
os.environ['MI_DATA_DIR'] = temporary_state.name + '/data'
os.environ['MI_CONFIG_FILE'] = temporary_state.name + '/config.json'
os.environ['CHATGPT2API_AUTH_KEY'] = 'integration-test-admin-key'
import gateway_integration as integration
from services.config import config
from services.image_task_service import ImageTaskService


async def request(path, token='', method='GET', payload=None, engine=False, ip='198.51.100.42', extra_headers=None, return_headers=False, forbid_body=False):
    body = json.dumps(payload).encode() if payload is not None else b''
    headers = [(b'content-type', b'application/json')]
    if token:
        headers.append((b'authorization', ('Bearer ' + token).encode()))
    if engine:
        headers.append((b'x-mazal-engine-only', b'1'))
    headers.extend(extra_headers or [])
    scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.4'},
             'http_version': '1.1', 'method': method, 'scheme': 'http',
             'path': path, 'raw_path': path.encode(), 'query_string': b'',
             'headers': headers, 'client': (ip, 12345), 'server': ('test', 8080)}
    events = []
    delivered = False
    async def receive():
        nonlocal delivered
        if forbid_body:
            raise AssertionError('Rejected requests must not read the request body')
        if not delivered:
            delivered = True
            return {'type': 'http.request', 'body': body, 'more_body': False}
        await asyncio.sleep(60)
        return {'type': 'http.disconnect'}
    async def send(event):
        events.append(event)
    await integration.app(scope, receive, send)
    start = next(e for e in events if e['type'] == 'http.response.start')
    raw = b''.join(e.get('body', b'') for e in events if e['type'] == 'http.response.body')
    try:
        result = json.loads(raw) if raw else None
    except ValueError:
        result = raw.decode()
    if return_headers:
        return start['status'], result, dict(start['headers'])
    return start['status'], result


class GatewayIntegrationTests(unittest.TestCase):
    def test_local_user_keys_cannot_be_minted_or_reused(self):
        with patch.object(integration.auth_service, 'authenticate', return_value={'id': 'old-local', 'role': 'user'}):
            self.assertIsNone(integration.local_identity('old-local-key'))
        code, _ = asyncio.run(request('/api/auth/users', config.auth_key, 'POST', {'name': 'blocked'}))
        self.assertEqual(code, 403)

    def test_local_engine_keeps_image_only_contract(self):
        before = len(SEEN)
        code, body = asyncio.run(request('/v1/models', config.auth_key, engine=True))
        self.assertEqual(code, 200)
        self.assertEqual([item['id'] for item in body['data']], ['gpt-image-2'])
        code, _ = asyncio.run(request('/v1/chat/completions', config.auth_key, 'POST', {'model': 'gpt-image-2'}, engine=True, forbid_body=True))
        self.assertEqual(code, 404)
        self.assertEqual(len(SEEN), before)

    def test_public_runtime_config_and_manifest_contain_no_credentials(self):
        code, script, headers = asyncio.run(request('/site-config.js', return_headers=True))
        self.assertEqual(code, 200)
        self.assertIn('Integration Test Site', script)
        self.assertIn('https://main.example.test', script)
        self.assertNotIn(config.auth_key, script)
        self.assertNotIn(CUSTOMER, script)
        self.assertEqual(headers[b'cache-control'], b'no-store')
        code, manifest = asyncio.run(request('/manifest.webmanifest'))
        self.assertEqual(code, 200)
        self.assertEqual(manifest['name'], 'Integration Test Site')

    def test_bridge_validates_main_login_ownership_group_and_origin(self):
        path = '/api/workbench/bridge/ticket'
        payload = {'key_id': 1, 'nonce': 'bridge_nonce_for_test_12345678'}
        headers = [(b'origin', b'https://main.example.test')]
        for token, origin, data, expected in (
            ('', headers, payload, 401), (CUSTOMER, headers, payload, 401),
            ('main-other-test', headers, payload, 403),
            ('main-user-test', [(b'origin', b'https://evil.invalid')], payload, 403),
            ('main-user-test', headers, {**payload, 'key_id': 3}, 403),
            ('main-user-test', headers, {**payload, 'nonce': 123456789012345678901}, 400),
            ('main-user-test', headers, {**payload, 'key_id': True}, 400)):
            self.assertEqual(asyncio.run(request(path, token, 'POST', data, extra_headers=origin))[0], expected)

    def test_bridge_ticket_single_use_nonce_bound_expiring_and_no_key_in_issue_response(self):
        TICKETS = integration.TICKETS
        nonce = 'bridge_nonce_for_test_12345678'
        code, issued, headers = asyncio.run(request('/api/workbench/bridge/ticket', 'main-user-test', 'POST',
            {'key_id': 1, 'nonce': nonce}, extra_headers=[(b'origin', b'https://main.example.test')], return_headers=True))
        self.assertEqual(code, 200)
        self.assertNotIn(CUSTOMER, json.dumps(issued))
        self.assertEqual(headers[b'cache-control'], b'no-store')
        payload = {'ticket': issued['ticket'], 'nonce': nonce}
        origin = [(b'origin', b'https://image.example.test')]
        self.assertEqual(asyncio.run(request('/api/workbench/bridge/redeem', method='POST',
            payload=payload, extra_headers=[(b'origin', b'https://evil.invalid')]))[0], 403)
        self.assertEqual(asyncio.run(request('/api/workbench/bridge/redeem', method='POST',
            payload={**payload, 'nonce': nonce + 'wrong'}, extra_headers=origin))[0], 401)
        code, result = asyncio.run(request('/api/workbench/bridge/redeem', method='POST', payload=payload, extra_headers=origin))
        self.assertEqual((code, result['key']), (200, CUSTOMER))
        self.assertEqual(asyncio.run(request('/api/workbench/bridge/redeem', method='POST', payload=payload, extra_headers=origin))[0], 401)
        _, issued = asyncio.run(request('/api/workbench/bridge/ticket', 'main-user-test', 'POST',
            {'key_id': 1, 'nonce': nonce}, extra_headers=[(b'origin', b'https://main.example.test')]))
        TICKETS[issued['ticket']]['expires'] = 0
        self.assertEqual(asyncio.run(request('/api/workbench/bridge/redeem', method='POST',
            payload={'ticket': issued['ticket'], 'nonce': nonce}, extra_headers=origin))[0], 401)

    def test_unknown_pages_and_root_exports_never_serve_legacy_home(self):
        for path in ('/', '/index', '/missing-page', '/index.txt', '/__next._full.txt',
                     '/404.html', '/accounts/missing', '/.env'):
            for method in ('GET', 'HEAD'):
                with self.subTest(path=path, method=method):
                    code, _ = asyncio.run(request(path, method=method))
                    self.assertEqual(code, 404)
        code, body = asyncio.run(request('/api/missing', CUSTOMER))
        self.assertEqual(code, 404)
        self.assertIsInstance(body, dict)

    def test_admin_assets_require_real_files_and_preserve_exported_routes(self):
        with patch.object(integration.support, 'resolve_web_asset', return_value=None) as resolve:
            for path in ('accounts', 'accounts/', 'settings/index.html', 'logs/index.txt',
                         'debug/__next.debug.__PAGE__.txt', 'accounts/__next.accounts/__PAGE__.txt', 'image-manager/', 'login/',
                         'image/index.txt', '_next/static/chunks/test.js', 'openai.svg', 'github.svg'):
                with self.assertRaises(integration.HTTPException) as error:
                    asyncio.run(integration.serve_admin_asset(path))
                self.assertEqual(error.exception.status_code, 404)
            self.assertEqual(resolve.call_count, 12)
            resolve.reset_mock()
            for path in ('accounts/../../index.html', '_next/static/../../index.html', 'index.txt'):
                with self.assertRaises(integration.HTTPException):
                    asyncio.run(integration.serve_admin_asset(path))
            resolve.assert_not_called()

    def test_favicon_uses_workbench_brand(self):
        response = asyncio.run(integration.serve_admin_asset('favicon.ico'))
        self.assertEqual((response.status_code, response.headers['location']), (302, '/pwa-icon.svg'))

    def test_malformed_credentials_are_rejected_without_gateway_calls(self):
        before = len(SEEN)
        for key in ('clé-invalide', 'x' * 513, 'key with spaces'):
            self.assertEqual(asyncio.run(request('/api/workbench/session', key))[0], 401)
            self.assertEqual(asyncio.run(request('/v1/models', key))[0], 401)
        self.assertEqual(asyncio.run(request('/v1/models', CUSTOMER,
            extra_headers=[(b'authorization', b'Bearer sk-other')]))[0], 401)
        self.assertEqual(len(SEEN), before)
        self.assertIsNone(integration.local_identity('clé-invalide'))

    def test_proxy_rejects_missing_or_invalid_keys_before_reading_uploads(self):
        for path in ('/v1/images/edits', '/api/image-tasks/generations', '/api/image-tasks/edits', '/api/auth/users'):
            for key in ('', REVOKED):
                code, _ = asyncio.run(request(path, key, 'POST', forbid_body=True))
                self.assertEqual(code, 401)

    def test_proxy_and_edit_upload_limits_reject_before_body_parsing_and_release(self):
        for slots, path, method in ((integration.PROXY_SLOTS, '/v1/models', 'GET'),
                (integration.TASK_UPLOAD_SLOTS, '/api/image-tasks/edits', 'POST'),
                (integration.TASK_UPLOAD_SLOTS, '/api/image-tasks/generations', 'POST')):
            for _ in range(4):
                self.assertTrue(slots.acquire(blocking=False))
            try:
                self.assertEqual(asyncio.run(request(path, CUSTOMER, method, forbid_body=True))[0], 429)
            finally:
                for _ in range(4):
                    slots.release()
        self.assertEqual(asyncio.run(request('/v1/models', CUSTOMER))[0], 200)
        self.assertEqual(asyncio.run(request('/v1/models', REVOKED))[0], 401)
        for _ in range(4):
            self.assertTrue(integration.PROXY_SLOTS.acquire(blocking=False))
        for _ in range(4):
            integration.PROXY_SLOTS.release()

    def test_task_parameters_are_bounded_before_persisting_or_starting(self):
        service = ImageTaskService(Path('/tmp/gateway-invalid-params.json'))
        identity = integration.customer_identity(CUSTOMER)
        base = {'model': 'gpt-image-2', 'prompt': 'test', 'quality': 'auto', 'size': '1024x1024'}
        with patch.object(integration, 'ORIGINAL_SUBMIT') as original:
            for fields in ({'quality': 'x' * 4096}, {'size': 'x' * 4096}, {'size': '1024x0'},
                    {'model': 'unlisted-model'}, {'prompt': ' '}, {'prompt': 'x' * 16001}):
                with self.subTest(fields=list(fields)):
                    with self.assertRaises(integration.HTTPException) as error:
                        service._submit(identity, client_task_id='invalid', mode='generate', payload={**base, **fields})
                    self.assertEqual(error.exception.status_code, 400)
            original.assert_not_called()
        self.assertFalse(service._tasks)

    def test_private_api_responses_are_never_cacheable(self):
        for path, key in (('/api/customer-balance', CUSTOMER), ('/api/image-tasks', CUSTOMER),
                ('/api/settings', CUSTOMER), ('/api/settings', ''), ('/v1/models', CUSTOMER),
                ('/v1/models', ''), ('/health', ''), ('/api/workbench/session', REVOKED)):
            _, _, headers = asyncio.run(request(path, key, return_headers=True))
            self.assertEqual(headers[b'cache-control'], b'no-store')
            self.assertEqual(headers[b'pragma'], b'no-cache')

    def test_proxy_encodes_untrusted_path_characters_without_500_or_query_injection(self):
        code, _ = asyncio.run(request('/v1/models/模型?unexpected=value', CUSTOMER))
        self.assertEqual(code, 200)
        self.assertEqual(SEEN[-1][0], '/v1/models/%E6%A8%A1%E5%9E%8B%3Funexpected%3Dvalue')

    def test_concurrent_duplicate_tasks_make_one_gateway_request(self):
        path = Path('/tmp/gateway-concurrent-dedup.json')
        path.unlink(missing_ok=True)
        service = ImageTaskService(path)
        identity = {**integration.customer_identity(CUSTOMER), '_gateway_token': CUSTOMER,
            '_gateway_client_ip': '198.51.100.42'}
        before = sum(p[0] == '/v1/images/generations' for p in SEEN)
        with ThreadPoolExecutor(max_workers=12) as pool:
            futures = [pool.submit(service.submit_generation, identity, client_task_id='same-id',
                prompt='test', model='gpt-image-2', size=None) for _ in range(24)]
            for future in futures:
                future.result()
        for _ in range(100):
            task = service.list_tasks(identity, ['same-id'])['items'][0]
            if task['status'] in ('success', 'error'):
                break
            time.sleep(0.02)
        self.assertEqual(task['status'], 'success')
        self.assertEqual(sum(p[0] == '/v1/images/generations' for p in SEEN), before + 1)
        other = integration.customer_identity('another-customer')
        self.assertEqual(service.list_tasks(other, ['same-id'])['missing_ids'], ['same-id'])

    def test_every_admin_route_denies_before_reading_or_changing_data(self):
        routes = [route for route in integration.app.engine.routes
            if getattr(route, 'path', '').startswith('/api/')
            and not route.path.startswith('/api/image-tasks')
            and route.path != '/api/third-party-apps']
        self.assertEqual(len(routes), 57)
        for route in routes:
            for token, expected in (('', 401), (CUSTOMER, 403)):
                with self.subTest(path=route.path, methods=route.methods, expected=expected):
                    identity = integration.customer_identity(token) if token else None
                    marker = integration.CONTEXT.set({'token': token, 'identity': identity})
                    try:
                        args = {name: ('Bearer ' + token if token else None) if name == 'authorization' else object()
                            for name, param in inspect.signature(route.endpoint).parameters.items()
                            if name == 'authorization' or param.default is inspect.Parameter.empty}
                        with self.assertRaises(integration.HTTPException) as error:
                            asyncio.run(route.endpoint(**args))
                        self.assertEqual(error.exception.status_code, expected)
                    finally:
                        integration.CONTEXT.reset(marker)

    def test_health_statistics_are_admin_only(self):
        self.assertEqual(asyncio.run(request('/health'))[0], 401)
        self.assertEqual(asyncio.run(request('/health', CUSTOMER))[0], 403)
        self.assertEqual(asyncio.run(request('/health', REVOKED))[0], 403)
        self.assertEqual(asyncio.run(request('/health', config.auth_key))[0], 200)

    def test_remote_reference_urls_never_trigger_server_downloads(self):
        with patch.object(integration, 'ORIGINAL_IMAGE_DOWNLOAD') as download:
            for source in ('http://127.0.0.1:8080/test.png', 'http://169.254.169.254/test.png', 'https://example.com/reference.png'):
                with self.assertRaises(integration.HTTPException) as error:
                    integration.image_inputs._download_image_url(source)
                self.assertEqual(error.exception.status_code, 400)
            download.assert_not_called()
        with patch.object(integration, 'ORIGINAL_MESSAGE_IMAGE') as download:
            for value in ('http://127.0.0.1/test.png', {'url': 'http://169.254.169.254/test.png'}):
                with self.assertRaises(integration.HTTPException) as error:
                    integration.image_helper._decode_message_image_url(value)
                self.assertEqual(error.exception.status_code, 400)
            download.assert_not_called()
        source = 'data:image/png;base64,aW1hZ2U='
        self.assertEqual(integration.image_inputs._download_image_url(source)[0], b'image')
        self.assertEqual(integration.image_helper._decode_message_image_url({'url': source})[0], b'image')

    def test_workbench_session_reads_zero_balance_and_never_exposes_key(self):
        for key in (CUSTOMER, EMPTY):
            code, body = asyncio.run(request('/api/workbench/session', key))
            self.assertEqual(code, 200)
            self.assertEqual(body['role'], 'user')
            self.assertTrue(body['subject_id'].startswith('sub2api-'))
            self.assertNotIn(key, json.dumps(body))
            self.assertNotIn('model_stats', json.dumps(body))
        self.assertEqual(asyncio.run(request('/api/workbench/session', REVOKED))[0], 401)
        self.assertEqual(asyncio.run(request('/api/workbench/session'))[0], 401)
        self.assertEqual(asyncio.run(request('/api/workbench/session', CUSTOMER, 'POST'))[0], 405)

    def test_workbench_admin_is_identified_without_pool_or_config_disclosure(self):
        code, body = asyncio.run(request('/api/workbench/session', config.auth_key))
        self.assertEqual((code, body['role']), (200, 'admin'))
        self.assertNotIn(config.auth_key, json.dumps(body))

    def test_customer_queue_has_per_owner_and_input_memory_limits(self):
        path = Path('/tmp/gateway-queue-test.json')
        path.unlink(missing_ok=True)
        service = ImageTaskService(path)
        identity = integration.customer_identity(CUSTOMER)
        service._tasks = {str(index): {'id': str(index), 'owner_id': identity['id'], 'status': 'queued'} for index in range(2)}
        with self.assertRaises(integration.HTTPException) as error:
            service._submit(identity, client_task_id='third', mode='generate', payload={'model': 'gpt-image-2', 'prompt': 'test'})
        self.assertEqual(error.exception.status_code, 429)
        service._tasks = {}
        with self.assertRaises(integration.HTTPException) as error:
            service._submit(identity, client_task_id='big', mode='edit', payload={'model': 'gpt-image-2', 'prompt': 'test', 'images': [(b'x' * (24 * 1024**2 + 1), 'x.png', 'image/png')]})
        self.assertEqual(error.exception.status_code, 413)
        integration.PENDING_BYTES[('test', 'reserved')] = 128 * 1024**2
        try:
            with self.assertRaises(integration.HTTPException) as error:
                service._submit(identity, client_task_id='busy', mode='edit', payload={'model': 'gpt-image-2', 'prompt': 'test', 'images': [(b'x', 'x.png', 'image/png')]})
            self.assertEqual(error.exception.status_code, 429)
        finally:
            integration.PENDING_BYTES.pop(('test', 'reserved'), None)

    def test_balance_is_current_customer_only_and_still_readable_without_credit(self):
        for key, amount in ((CUSTOMER, 12.3456), (EMPTY, 0)):
            code, body = asyncio.run(request('/api/customer-balance', key))
            self.assertEqual(code, 200)
            self.assertEqual(body['balance'], amount)
            self.assertEqual(SEEN[-1][0], '/v1/usage')
            self.assertEqual(SEEN[-1][1], key)
            self.assertNotIn('key', body)
            self.assertNotIn('model_stats', body)
        self.assertEqual(asyncio.run(request('/api/customer-balance', REVOKED))[0], 401)
        self.assertEqual(asyncio.run(request('/api/customer-balance'))[0], 401)
        code, body = asyncio.run(request('/api/customer-balance', config.auth_key))
        self.assertEqual((code, body), (200, {'source': 'local'}))

    def test_balance_distinguishes_wallet_key_quota_and_period_limits(self):
        result = integration.customer_balance({'mode': 'quota_limited', 'remaining': 8,
            'quota': {'limit': 10, 'used': 2, 'remaining': 8},
            'rate_limits': [{'window': '1d', 'limit': 3, 'used': 2.5, 'remaining': 0.5}],
            'balance': 'not-a-number', 'api_key': 'private'})
        self.assertIsNone(result['balance'])
        self.assertEqual(result['quota']['remaining'], 8)
        self.assertEqual(result['rate_limits'][0]['remaining'], 0.5)
        self.assertNotIn('api_key', result)
        self.assertIsNone(integration.customer_balance({'remaining': float('nan')})['remaining'])
        self.assertIsNone(integration.customer_balance({'balance': True})['balance'])

    def test_customer_login_is_user_and_forwards_client_ip(self):
        code, body = asyncio.run(request('/auth/login', CUSTOMER, 'POST', {}))
        self.assertEqual(code, 200)
        self.assertEqual(body['role'], 'user')
        self.assertTrue(body['subject_id'].startswith('sub2api-'))
        self.assertEqual(SEEN[-1][2], '198.51.100.42')
        self.assertNotIn(CUSTOMER, json.dumps(body))

    def test_revoked_or_empty_balance_key_cannot_login(self):
        self.assertEqual(asyncio.run(request('/auth/login', REVOKED, 'POST', {}))[0], 401)
        self.assertEqual(asyncio.run(request('/auth/login', EMPTY, 'POST', {}))[0], 403)

    def test_customer_cannot_read_admin_accounts_or_settings(self):
        for path in ['/api/accounts', '/api/settings', '/api/auth/users']:
            self.assertEqual(asyncio.run(request(path, CUSTOMER))[0], 403)

    def test_customer_key_cannot_bypass_gateway_via_engine(self):
        before = len(SEEN)
        code, _ = asyncio.run(request('/v1/images/generations', CUSTOMER, 'POST',
                                      {'model': 'gpt-image-2', 'prompt': 'test'}, engine=True))
        self.assertEqual(code, 401)
        self.assertEqual(len(SEEN), before)

    def test_public_v1_preserves_gateway_failures_and_payload(self):
        code, _ = asyncio.run(request('/v1/images/generations', EMPTY, 'POST',
                                     {'model': 'gpt-image-2', 'prompt': 'test'}))
        self.assertEqual(code, 403)
        code, body = asyncio.run(request('/v1/images/generations', CUSTOMER, 'POST',
                                        {'model': 'gpt-image-2', 'prompt': 'test'}))
        self.assertEqual(code, 200)
        self.assertEqual(body['data'][0]['url'], 'https://example.invalid/test.png')
        self.assertEqual(json.loads(SEEN[-1][3])['prompt'], 'test')

    def test_admin_login_and_engine_models_stay_local(self):
        code, body = asyncio.run(request('/auth/login', config.auth_key, 'POST', {}))
        self.assertEqual((code, body['role']), (200, 'admin'))
        before = len(SEEN)
        self.assertEqual(asyncio.run(request('/v1/models', config.auth_key, engine=True))[0], 200)
        self.assertEqual(len(SEEN), before)

    def test_local_engine_only_advertises_image_model(self):
        before = len(SEEN)
        with patch.object(integration.app, 'engine', side_effect=AssertionError('Must not query upstream model catalog')):
            for marked in (False, True):
                code, body, headers = asyncio.run(request('/v1/models', config.auth_key,
                    engine=marked, return_headers=True))
                self.assertEqual(code, 200)
                self.assertEqual([model['id'] for model in body['data']], ['gpt-image-2'])
                self.assertEqual(headers[b'cache-control'], b'no-store')
        self.assertEqual(len(SEEN), before)

    def test_local_engine_rejects_chat_before_reading_body_or_calling_upstream(self):
        before = len(SEEN)
        with patch.object(integration.app, 'engine', side_effect=AssertionError('Must not invoke chat engine')):
            for marked in (False, True):
                for path in ('/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1/search'):
                    code, _ = asyncio.run(request(path, config.auth_key, 'POST',
                        {'model': 'gpt-6'}, engine=marked, forbid_body=True))
                    self.assertEqual(code, 404)
        self.assertEqual(len(SEEN), before)

    def test_local_engine_image_routes_remain_reachable(self):
        reached = []
        async def image_engine(scope, receive, send):
            reached.append(scope['path'])
            await integration.JSONResponse({'image_route_reached': True})(scope, receive, send)
        with patch.object(integration.app, 'engine', image_engine):
            for path in ('/v1/images/generations', '/v1/images/edits'):
                code, body = asyncio.run(request(path, config.auth_key, 'POST',
                    {'model': 'gpt-image-2', 'prompt': 'test'}, engine=True))
                self.assertEqual((code, body['image_route_reached']), (200, True))
        self.assertEqual(reached, ['/v1/images/generations', '/v1/images/edits'])

    def test_gateway_task_is_billed_once_and_never_persists_customer_key(self):
        path = Path('/tmp/gateway-test-tasks.json')
        path.unlink(missing_ok=True)
        service = ImageTaskService(path)
        identity = {**integration.customer_identity(CUSTOMER), '_gateway_token': CUSTOMER,
                    '_gateway_client_ip': '198.51.100.42'}
        before = sum(p[0] == '/v1/images/generations' for p in SEEN)
        for _ in range(2):
            service.submit_generation(identity, client_task_id='deduplicate', prompt='test',
                                      model='gpt-image-2', size=None, base_url='https://image.example.test')
        for _ in range(50):
            result = service.list_tasks(identity, ['deduplicate'])['items'][0]
            if result['status'] in ('success', 'error'):
                break
            time.sleep(0.05)
        self.assertEqual(result['status'], 'success')
        self.assertEqual(sum(p[0] == '/v1/images/generations' for p in SEEN), before+1)
        self.assertNotIn(CUSTOMER, path.read_text())
        stranger = integration.customer_identity('sk-another-isolated-key')
        self.assertEqual(service.list_tasks(stranger, ['deduplicate'])['items'], [])

    def test_quota_failure_becomes_task_error_without_engine_fallback(self):
        path = Path('/tmp/gateway-empty-tasks.json')
        path.unlink(missing_ok=True)
        service = ImageTaskService(path)
        identity = {**integration.customer_identity(EMPTY), '_gateway_token': EMPTY,
                    '_gateway_client_ip': '198.51.100.42'}
        service.submit_generation(identity, client_task_id='empty', prompt='test',
                                  model='gpt-image-2', size=None)
        for _ in range(50):
            result = service.list_tasks(identity, ['empty'])['items'][0]
            if result['status'] == 'error':
                break
            time.sleep(0.05)
        self.assertEqual(result['status'], 'error')
        self.assertIn('insufficient balance', result['error'])

    def test_multipart_keeps_all_reference_images_and_mask(self):
        payload = {'prompt': 'edit', 'model': 'gpt-image-2', 'n': 1,
                   'images': [(b'first', 'unsafe"\r\nname.png', 'image/png'),
                              (b'second', 'second.png', 'image/png')],
                   'mask': [(b'mask', 'mask.png', 'image/png')]}
        body, content_type = integration.multipart_body(payload)
        parsed = BytesParser(policy=default).parsebytes(
            ('Content-Type: '+content_type+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body)
        parts = list(parsed.iter_parts())
        images = [p.get_payload(decode=True) for p in parts
                  if p.get_param('name', header='content-disposition') == 'image']
        self.assertEqual(images, [b'first', b'second'])
        self.assertEqual([p.get_payload(decode=True) for p in parts if p.get_param('name', header='content-disposition') == 'mask'], [b'mask'])
        self.assertNotIn(b'unsafe', body)


if __name__ == '__main__':
    try:
        unittest.main(verbosity=2)
    finally:
        server.shutdown()
        temporary_state.cleanup()
