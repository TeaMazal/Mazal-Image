"""隔离验收专用：不转发网络，不调用真实账号或付费服务。"""
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGOwbvpGU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAEoszFv/SWGdAAAAAElFTkSuQmCC'
COUNTS = {'mock': True, 'generation': 0}
ROOT = Path(__file__).resolve().parents[1]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()

    def handle_request(self):
        if self.path == '/':
            body = (ROOT / 'tests/embed_fixture.html').read_bytes()
            return self.respond(200, body, 'text/html')
        if self.path.split('?', 1)[0] == '/embedded-workbench.js':
            return self.respond(200, (ROOT / 'integrations/embedded-workbench.js').read_bytes(), 'application/javascript')
        if self.path == '/test-counts': return self.respond(200, COUNTS)
        if self.path == '/favicon.ico': return self.respond(204, b'', 'image/x-icon')
        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
        body = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        if self.path == '/api/v1/image-workbench/ticket':
            request = urllib.request.Request('http://web:8080/api/workbench/bridge/ticket', data=body,
                headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token,
                         'Origin': self.headers.get('Origin', '')})
            try:
                response = urllib.request.urlopen(request, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                return self.respond(response.status, response.read())
        if token == 'mock-main-session' and self.path == '/api/v1/auth/me':
            return self.respond(200, {'data': {'id': 7}})
        if token == 'mock-main-session' and self.path.startswith('/api/v1/keys/'):
            return self.respond(200, {'data': {'user_id': 7, 'status': 'active', 'key': 'mock-customer-key',
                'group': {'status': 'active', 'allow_image_generation': True}}})
        if token not in ('mock-customer-key', 'mock-zero-key'):
            return self.respond(401, {'message': 'Invalid test key'})
        if self.path == '/v1/usage':
            return self.respond(200, {'balance': 0 if token == 'mock-zero-key' else 12.3456, 'remaining': 12.3456})
        if self.path == '/v1/models': return self.respond(200, {'data': [{'id': 'gpt-image-2'}]})
        if self.path.startswith('/v1/images/'):
            if token == 'mock-zero-key': return self.respond(403, {'message': 'insufficient balance'})
            COUNTS['generation'] += 1
            if b'E2E slow ' in body: time.sleep(3)
            return self.respond(200, {'data': [{'b64_json': PIXEL}], 'usage': {'output_tokens': 1}})
        return self.respond(404, {'message': 'Not Found'})

    def respond(self, status, value, content_type='application/json'):
        body = value if isinstance(value, bytes) else json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__': ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
