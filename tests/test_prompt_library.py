import asyncio
import copy
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import prompt_library as module
from fastapi import FastAPI, HTTPException
from PIL import Image


class TemplateLibraryTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.previous = module.DATA
        module.DATA = Path(self.directory.name)
        self.addCleanup(setattr, module, 'DATA', self.previous)
        module.OPTIMIZE_HISTORY.clear()
        self.calls = []
        self.app = FastAPI()
        def identity(authorization):
            if authorization not in ('Bearer customer', 'Bearer admin'):
                raise HTTPException(401)
            return {'id': authorization, 'role': 'admin' if authorization == 'Bearer admin' else 'user'}
        def gateway(path, token, ip, **kwargs):
            self.calls.append((path, token, kwargs))
            if path == '/v1/models':
                return {'data': [{'id': 'gpt-image-2'}, {'id': 'gpt-4.1-mini'}, {'id': 'gpt-audio'}]}
            return {'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '优化后的提示词'}]}], 'usage': {'input_tokens': 5}}
        module.install_template_routes(self.app, identity, gateway)

    async def request(self, path, method='GET', value=None, role='customer', body=None, headers=None):
        messages = []
        raw = body if body is not None else json.dumps(value).encode() if value is not None else b''
        sent = False
        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': raw}
            await asyncio.sleep(0)
            return {'type': 'http.disconnect'}
        async def send(message): messages.append(message)
        scope = {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': '2.4'}, 'http_version': '1.1', 'method': method, 'scheme': 'http', 'path': path, 'raw_path': path.encode(), 'query_string': b'', 'headers': [(b'authorization', f'Bearer {role}'.encode())] + (headers or []), 'client': ('127.0.0.1', 1), 'server': ('localhost', 80)}
        await self.app(scope, receive, send)
        status = next(x['status'] for x in messages if x['type'] == 'http.response.start')
        result = b''.join(x.get('body', b'') for x in messages if x['type'] == 'http.response.body')
        try: result = json.loads(result)
        except (ValueError, UnicodeError): pass
        return status, result

    async def test_publication_permissions_and_revision(self):
        status, library = await self.request('/api/admin/template-library', role='admin')
        self.assertEqual(status, 200)
        self.assertEqual(len(library['templates']), 24)
        self.assertEqual((await self.request('/api/admin/template-library'))[0], 403)
        item = copy.deepcopy(library['templates'][0]); item['published'] = False
        route = '/api/admin/template-library/' + item['id']
        self.assertEqual((await self.request(route, 'PUT', {'revision': library['revision'], 'template': item}))[0], 403)
        self.assertEqual((await self.request(route, 'PUT', {'revision': library['revision'], 'template': item}, 'admin'))[0], 200)
        self.assertEqual((await self.request(route, 'PUT', {'revision': library['revision'], 'template': item}, 'admin'))[0], 409)
        status, published = await self.request('/api/workbench/templates')
        self.assertEqual(status, 200)
        self.assertNotIn(item['id'], [x['id'] for x in published['templates']])
        self.assertEqual((await self.request('/api/workbench/templates', role='invalid'))[0], 401)

    async def test_validation_and_untrusted_cover(self):
        item = copy.deepcopy(module.load_library()['templates'][0])
        item['prompt'] += '{{missing}}'
        with self.assertRaises(HTTPException): module.validate_template(item)
        item = copy.deepcopy(module.load_library()['templates'][0]); item['source_url'] = 'javascript:alert(1)'
        with self.assertRaises(HTTPException): module.validate_template(item)
        item['source_url'] = 'https://[invalid'
        with self.assertRaises(HTTPException) as invalid_url: module.validate_template(item)
        self.assertEqual(invalid_url.exception.status_code, 400)
        self.assertEqual((await self.request('/api/admin/template-library/cover', 'POST', role='customer', body=b'invalid'))[0], 403)
        self.assertEqual((await self.request('/api/admin/template-library/cover', 'POST', role='admin', body=b'invalid'))[0], 400)
        self.assertEqual((await self.request('/api/admin/template-library/cover', 'POST', role='admin', body=b'a' * (2 * 1024**2 + 1)))[0], 413)
        output = io.BytesIO(); Image.new('RGB', (40, 20), 'red').save(output, 'PNG')
        status, result = await self.request('/api/admin/template-library/cover', 'POST', role='admin', body=output.getvalue())
        self.assertEqual(status, 200)
        status, content = await self.request(result['cover']); self.assertEqual(status, 200)
        self.assertEqual(Image.open(io.BytesIO(content)).format, 'WEBP')
        self.assertEqual((await self.request('/template-media/not-a-hash.webp'))[0], 404)

    async def test_create_cannot_overwrite_existing_template(self):
        library = module.load_library()
        item = copy.deepcopy(library['templates'][0])
        item['title'] = '不可覆盖'
        route = '/api/admin/template-library/' + item['id']
        status, _ = await self.request(route, 'PUT', {'revision': library['revision'], 'expected_exists': False, 'template': item}, 'admin')
        self.assertEqual(status, 409)
        self.assertEqual(module.load_library(), library)
        item['id'] = 'new-review-template'
        route = '/api/admin/template-library/' + item['id']
        status, _ = await self.request(route, 'PUT', {'revision': library['revision'], 'expected_exists': True, 'template': item}, 'admin')
        self.assertEqual(status, 409)
        status, result = await self.request(route, 'PUT', {'revision': library['revision'], 'expected_exists': False, 'template': item}, 'admin')
        self.assertEqual(status, 200)
        self.assertEqual(result['template']['id'], item['id'])

    async def test_corrupt_library_reports_unavailable(self):
        (module.DATA / 'template-library.json').write_text('{"revision":1,"templates":[{}]}', encoding='utf-8')
        self.assertEqual((await self.request('/api/workbench/templates'))[0], 503)

    async def test_optimizer_billing_routing_and_limits(self):
        status, models = await self.request('/api/workbench/prompt-optimizer')
        self.assertEqual(status, 200); self.assertEqual(models['models'], ['gpt-4.1-mini'])
        value = {'prompt': '水杯', 'model': 'gpt-4.1-mini', 'has_reference': True, 'mode': 'edit'}
        status, result = await self.request('/api/workbench/prompt-optimizer', 'POST', value, headers=[(b'x-prompt-api-key', b'text-customer-key')])
        self.assertEqual(status, 200); self.assertEqual(result['prompt'], '优化后的提示词')
        path, token, kwargs = self.calls[-1]
        self.assertEqual(path, '/v1/responses'); self.assertEqual(token, 'text-customer-key')
        payload = json.loads(kwargs['data']); self.assertFalse(payload['store']); self.assertEqual(payload['max_output_tokens'], 1600)
        self.assertTrue(json.loads(payload['input'])['has_reference'])
        for _ in range(2): self.assertEqual((await self.request('/api/workbench/prompt-optimizer', 'POST', value))[0], 200)
        self.assertEqual((await self.request('/api/workbench/prompt-optimizer', 'POST', value))[0], 429)
        self.assertFalse(list(module.DATA.iterdir()))

    async def test_optimizer_cannot_select_image_or_unlisted_model(self):
        for model in ['gpt-image-2', 'gpt-unlisted']:
            status, _ = await self.request('/api/workbench/prompt-optimizer', 'POST', {'prompt': 'test', 'model': model})
            self.assertEqual(status, 403)
        self.assertFalse(any(x[0] == '/v1/responses' for x in self.calls))


if __name__ == '__main__': unittest.main(verbosity=2)
