"""Use Sub2API customer keys for the workbench; keep engine/admin keys local.

Only the original engine key can reach the engine's /v1 endpoints. Customer
tasks call Sub2API's real image gateway, so its billing cannot be bypassed.
"""
import asyncio
import contextvars
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote, quote_from_bytes

from fastapi import HTTPException
from starlette.responses import FileResponse, JSONResponse, RedirectResponse, StreamingResponse, Response
from site_config import SITE_NAME, MAIN_ORIGIN, IMAGE_ORIGIN, GATEWAY

from api import support
from services.auth_service import auth_service
from services.config import config
from utils import helper as image_helper

CONTEXT = contextvars.ContextVar('mazal_gateway_context', default={})
SLOTS = threading.BoundedSemaphore(2)
PENDING_BYTES = {}
PROXY_SLOTS = threading.BoundedSemaphore(4)
TASK_UPLOAD_SLOTS = threading.BoundedSemaphore(4)
ORIGINAL_IDENTITY = support.require_identity
BRIDGE_LOCK = threading.Lock()
TICKETS = {}


def issue_ticket(key, subject, nonce):
    now = time.monotonic()
    with BRIDGE_LOCK:
        for ticket in list(TICKETS):
            if TICKETS[ticket]['expires'] <= now:
                del TICKETS[ticket]
        if len(TICKETS) >= 512:
            raise HTTPException(429, detail={'error': '登录交接繁忙，请稍后重试'})
        own = [ticket for ticket, item in TICKETS.items() if item['subject'] == subject]
        for ticket in own[:-1]:
            del TICKETS[ticket]
        ticket = secrets.token_urlsafe(32)
        TICKETS[ticket] = {'key': key, 'subject': subject, 'nonce': nonce, 'expires': now + 60}
    return ticket


def consume_ticket(ticket, nonce):
    with BRIDGE_LOCK:
        item = TICKETS.get(ticket)
        if not item or item['expires'] <= time.monotonic():
            TICKETS.pop(ticket, None)
            raise HTTPException(401, detail={'error': '登录交接已过期，请重新连接'})
        if not secrets.compare_digest(item['nonce'], nonce):
            raise HTTPException(401, detail={'error': '登录交接不匹配'})
        del TICKETS[ticket]
        return item['key']


def error_message(payload, fallback='主站请求失败'):
    if isinstance(payload, dict):
        for name in ('message', 'error', 'detail'):
            value = payload.get(name)
            if isinstance(value, str) and value:
                return value[:400]
            if isinstance(value, dict):
                return error_message(value, fallback)
    return fallback


def gateway_request(path, token, client_ip, *, data=None, content_type=None, timeout=12):
    headers = {'Authorization': 'Bearer ' + token,
               'X-Real-IP': client_ip, 'X-Forwarded-For': client_ip,
               'Accept': 'application/json'}
    if content_type:
        headers['Content-Type'] = content_type
    request = urllib.request.Request(GATEWAY + path, data=data, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read(16384))
        except (ValueError, UnicodeError):
            payload = {}
        raise HTTPException(error.code, detail={'error': error_message(payload)}) from None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        raise HTTPException(503, detail={'error': '主站暂时无法连接，请稍后重试'}) from None


def local_identity(token):
    if config.auth_key and hmac.compare_digest(token.encode('utf-8'), str(config.auth_key).encode('utf-8')):
        return {'id': 'admin', 'name': '管理员', 'role': 'admin'}
    return auth_service.authenticate(token) if token else None


def customer_identity(token):
    return {'id': 'sub2api-' + hashlib.sha256(token.encode()).hexdigest()[:32],
            'name': '主站用户', 'role': 'user', 'source': 'sub2api'}


def customer_balance(payload):
    """Return only the caller's financial limits, never account/key metadata."""
    def amount(value):
        if isinstance(value, bool) or not isinstance(value, (float, int)):
            return None
        return max(0, value) if math.isfinite(value) else None

    result = {'source': 'sub2api', 'unit': 'USD', 'balance': amount(payload.get('balance')),
              'remaining': amount(payload.get('remaining')), 'quota': None, 'rate_limits': []}
    quota = payload.get('quota')
    if isinstance(quota, dict):
        result['quota'] = {k: amount(quota.get(k)) for k in ('limit', 'used', 'remaining')}
    for entry in payload.get('rate_limits') or []:
        if isinstance(entry, dict) and entry.get('window') in ('5h', '1d', '7d'):
            result['rate_limits'].append({'window': entry['window'],
                **{k: amount(entry.get(k)) for k in ('limit', 'used', 'remaining')}})
    result['subscription'] = isinstance(payload.get('subscription'), dict) or (
        payload.get('mode') == 'unrestricted' and payload.get('planName') not in (None, '钱包余额')
        and result['balance'] is None)
    return result


async def proxy_gateway(scope, receive, send, token):
    if not token:
        return await JSONResponse({'error': {'message': '请提供有效的 API 密钥'}}, status_code=401)(scope, receive, send)
    if not PROXY_SLOTS.acquire(blocking=False):
        return await JSONResponse({'error': {'message': '接口繁忙，请稍后重试'}}, status_code=429,
            headers={'Retry-After': '3'})(scope, receive, send)
    try:
        client_ip = str((scope.get('client') or ('', 0))[0])
        try:
            await asyncio.to_thread(gateway_request, '/v1/usage', token, client_ip)
        except HTTPException as error:
            return await JSONResponse({'error': {'message': error_message(error.detail)}},
                status_code=error.status_code)(scope, receive, send)
        return await proxy_validated_gateway(scope, receive, send, token)
    finally:
        PROXY_SLOTS.release()


async def proxy_validated_gateway(scope, receive, send, token):
    body = bytearray()
    while True:
        event = await receive()
        if event['type'] == 'http.disconnect':
            return
        body.extend(event.get('body', b''))
        if len(body) > 30 * 1024**2:
            return await JSONResponse({'error': {'message': '请求超过 30 MB'}},
                                      status_code=413)(scope, receive, send)
        if not event.get('more_body'):
            break
    incoming = dict(scope.get('headers', []))
    client_ip = str((scope.get('client') or ('', 0))[0])
    headers = {'Authorization': 'Bearer ' + token, 'X-Real-IP': client_ip,
               'X-Forwarded-For': client_ip, 'X-Forwarded-Proto': 'https'}
    for raw, name in [(b'content-type', 'Content-Type'), (b'accept', 'Accept'),
                      (b'x-client-request-id', 'X-Client-Request-Id')]:
        if incoming.get(raw):
            headers[name] = incoming[raw].decode('latin1')
    path = quote(scope['path'], safe='/')
    if scope.get('query_string'):
        path += '?' + quote_from_bytes(scope['query_string'], safe="!$&'()*+,-./:;=?@_%~")
    request = urllib.request.Request(GATEWAY + path, headers=headers,
                                     data=bytes(body) if body else None,
                                     method=scope['method'])
    def connect():
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            return opener.open(request, timeout=600)
        except urllib.error.HTTPError as error:
            return error
    try:
        response = await asyncio.to_thread(connect)
    except (urllib.error.URLError, TimeoutError, OSError):
        return await JSONResponse({'error': {'message': '主站暂时无法连接'}},
                                  status_code=503)(scope, receive, send)
    def chunks():
        try:
            while True:
                chunk = response.read1(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            response.close()
    safe_headers = {name: value for name, value in response.headers.items()
                    if name.lower() in ('content-type', 'cache-control', 'retry-after',
                                        'x-request-id', 'x-ratelimit-remaining')}
    return await StreamingResponse(chunks(), status_code=response.status,
                                   headers=safe_headers)(scope, receive, send)


def require_identity(authorization=None):
    context = CONTEXT.get()
    token = support.extract_bearer_token(authorization)
    if token and context.get('token') == token and context.get('identity'):
        return context['identity']
    # Fail closed outside a validated HTTP request. No local copy of customer keys.
    return ORIGINAL_IDENTITY(authorization)


support.require_identity = require_identity

# Import routes only after installing the identity function they capture.
from api import accounts, ai, image_inputs, image_tasks, system  # noqa: E402
from api.app import create_app  # noqa: E402
from services.image_task_service import ImageTaskService  # noqa: E402

for module in (accounts, ai, image_tasks, system):
    module.require_identity = require_identity


ORIGINAL_IMAGE_DOWNLOAD = image_inputs._download_image_url


def download_inline_image(source):
    # 图片由客户端上传，避免不受信任的 URL 触发服务器访问内网或元数据端点。
    if not str(source).startswith('data:'):
        raise HTTPException(400, detail={'error': '请上传参考图文件或使用内联图片，不支持服务器下载图片链接'})
    return ORIGINAL_IMAGE_DOWNLOAD(source)


image_inputs._download_image_url = download_inline_image
ORIGINAL_MESSAGE_IMAGE = image_helper._decode_message_image_url


def decode_inline_message_image(value):
    source = image_helper._message_image_url(value)
    if source.startswith(('http://', 'https://')):
        raise HTTPException(400, detail={'error': '请上传参考图文件或使用内联图片，不支持服务器下载图片链接'})
    return ORIGINAL_MESSAGE_IMAGE(value)


image_helper._decode_message_image_url = decode_inline_message_image


def multipart_body(payload):
    boundary = 'mazal-' + secrets.token_hex(16)
    pieces = []
    for name in ('prompt', 'model', 'size', 'quality', 'n', 'response_format'):
        value = payload.get(name)
        if value is not None:
            pieces.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"'
                           f'\r\n\r\n{value}\r\n').encode())
    for source, name in (('images', 'image'), ('mask', 'mask')):
        for content, _filename, media_type in payload.get(source) or []:
            safe_type = str(media_type or 'image/png').split('\r')[0].split('\n')[0]
            pieces.extend([
                (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
                 f'filename="upload.png"\r\nContent-Type: {safe_type}\r\n\r\n').encode(),
                content, b'\r\n',
            ])
    pieces.append(f'--{boundary}--\r\n'.encode())
    return b''.join(pieces), 'multipart/form-data; boundary=' + boundary


def image_request(payload, identity, mode):
    token = identity['_gateway_token']
    client_ip = identity['_gateway_client_ip']
    # Quota enforcement happens on this real gateway request, not on login alone.
    if mode == 'edit':
        data, content_type = multipart_body(payload)
        path = '/v1/images/edits'
    else:
        data = json.dumps({k: payload[k] for k in
                           ('prompt', 'model', 'n', 'size', 'quality', 'response_format')
                           if payload.get(k) is not None}).encode()
        content_type = 'application/json'
        path = '/v1/images/generations'
    return gateway_request(path, token, client_ip, data=data,
                           content_type=content_type, timeout=600)


ORIGINAL_RUN = ImageTaskService._run_task
ORIGINAL_SUBMIT = ImageTaskService._submit


def submit(self, identity, *, client_task_id, mode, payload):
    if identity.get('source') == 'sub2api':
        with self._lock:
            if not str(client_task_id).strip() or len(str(client_task_id)) > 128 or not str(payload.get('prompt') or '').strip() or len(str(payload.get('prompt') or '')) > 16000:
                raise HTTPException(400, detail={'error': '任务编号或提示词为空，或超过长度限制'})
            if payload.get('model') != 'gpt-image-2':
                raise HTTPException(400, detail={'error': '此工作区仅支持 gpt-image-2'})
            if payload.get('quality', 'auto') not in ('auto', 'low', 'medium', 'high'):
                raise HTTPException(400, detail={'error': 'quality 必须为 auto、low、medium 或 high'})
            size = payload.get('size')
            if size is not None and (not isinstance(size, str) or len(size) > 32 or not re.fullmatch(r'auto|[1-9][0-9]{0,4}x[1-9][0-9]{0,4}', size)):
                raise HTTPException(400, detail={'error': 'size 必须为 auto 或 宽x高，例如 1024x1024'})
            existing = f"{identity['id']}:{str(client_task_id).strip()}"
            active = sum(t.get('status') in ('queued', 'running') for t in self._tasks.values())
            if existing not in self._tasks and active >= 32:
                raise HTTPException(429, detail={'error': '绘图任务繁忙，请稍后重试'})
            own_active = sum(t.get('owner_id') == identity['id'] and
                             t.get('status') in ('queued', 'running') for t in self._tasks.values())
            if existing not in self._tasks and own_active >= 2:
                raise HTTPException(429, detail={'error': '你已有两个任务正在处理，请等待完成后再提交'})
            input_bytes = sum(len(content) for name in ('images', 'mask')
                              for content, *_ in payload.get(name) or [])
            if input_bytes > 24 * 1024**2:
                raise HTTPException(413, detail={'error': '参考图和遮罩合计不能超过 24 MB'})
            reservation = (id(self), existing)
            if existing not in self._tasks:
                if sum(PENDING_BYTES.values()) + input_bytes > 128 * 1024**2:
                    raise HTTPException(429, detail={'error': '图片队列繁忙，请稍后重试'})
                PENDING_BYTES[reservation] = input_bytes
            # Original insertion shares this reentrant lock, preventing races.
            try:
                return ORIGINAL_SUBMIT(self, identity, client_task_id=client_task_id,
                                       mode=mode, payload=payload)
            except Exception:
                PENDING_BYTES.pop(reservation, None)
                raise
    return ORIGINAL_SUBMIT(self, identity, client_task_id=client_task_id, mode=mode, payload=payload)


def run_task(self, key, mode, payload, identity, model):
    if identity.get('source') != 'sub2api':
        return ORIGINAL_RUN(self, key, mode, payload, identity, model)
    started = time.time()
    try:
        with SLOTS:
            self._update_task(key, status='running', started_ts=time.time(),
                              progress='gateway_generation', error='')
            result = image_request(payload, identity, mode)
        if not isinstance(result, dict) or not result.get('data'):
            raise RuntimeError(error_message(result, '绘图上游没有返回图片，请检查号池状态'))
        self._update_task(key, status='success', data=result['data'], usage=result.get('usage'),
                          duration_ms=int((time.time()-started)*1000), error='')
        self._log_call(identity, mode, model, started, '调用完成')
    except Exception as error:
        detail = error.detail if isinstance(error, HTTPException) else str(error)
        message = error_message(detail, str(detail)[:400])
        self._update_task(key, status='error', error=message, data=[],
                          duration_ms=int((time.time()-started)*1000))
        self._log_call(identity, mode, model, started, '调用失败', status='failed', error=message)
    finally:
        # The raw key exists only in the executing request/thread, never in task JSON.
        identity.pop('_gateway_token', None)
        with self._lock:
            PENDING_BYTES.pop((id(self), key), None)


ImageTaskService._submit = submit
ImageTaskService._run_task = run_task


class CustomerGateway:
    def __init__(self, engine):
        self.engine = engine

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.engine(scope, receive, send)
        headers = dict(scope.get('headers', []))
        auth = headers.get(b'authorization', b'').decode('latin1')
        token = support.extract_bearer_token(auth)
        path = scope.get('path', '')
        if path in ('/site-config.js', '/manifest.webmanifest'):
            if scope['method'] not in ('GET', 'HEAD'):
                return await Response(status_code=405)(scope, receive, send)
            if path == '/site-config.js':
                payload = json.dumps({'name': SITE_NAME, 'mainOrigin': MAIN_ORIGIN}, ensure_ascii=True).replace('<', '\\u003c')
                response = Response('window.__MAZAL_IMAGE_CONFIG__=' + payload + ';', media_type='application/javascript')
            else:
                response = JSONResponse({'name': SITE_NAME, 'short_name': SITE_NAME[:20], 'description': SITE_NAME + ' 图片创作工作区',
                    'start_url': '/', 'scope': '/', 'display': 'standalone', 'background_color': '#030712', 'theme_color': '#111827',
                    'icons': [{'src': '/pwa-icon.svg', 'sizes': 'any', 'type': 'image/svg+xml', 'purpose': 'any'},
                              {'src': '/pwa-maskable-icon.svg', 'sizes': 'any', 'type': 'image/svg+xml', 'purpose': 'maskable'}]})
            response.headers['Cache-Control'] = 'no-store'
            return await response(scope, receive, send)
        if path in ('/api/workbench/bridge/ticket', '/api/workbench/bridge/redeem'):
            response_headers = {'Cache-Control': 'no-store', 'Pragma': 'no-cache'}
            try:
                if scope['method'] != 'POST':
                    raise HTTPException(405, detail={'error': 'Method not allowed'})
                origin = headers.get(b'origin', b'').decode('latin1')
                expected_origin = MAIN_ORIGIN if path.endswith('/ticket') else IMAGE_ORIGIN
                if origin != expected_origin:
                    raise HTTPException(403, detail={'error': '登录交接来源无效'})
                if path.endswith('/ticket') and (not token or len(token) > 4096 or any(ord(char) < 33 or ord(char) > 126 for char in token) or
                        sum(name.lower() == b'authorization' for name, _ in scope.get('headers', [])) != 1):
                    raise HTTPException(401, detail={'error': '请先登录主站'})
                # 小型 JSON 交接不接收文件，也不接受 URL 查询参数中的凭证。
                body = bytearray()
                while True:
                    event = await receive()
                    if event['type'] == 'http.disconnect':
                        return
                    body.extend(event.get('body', b''))
                    if len(body) > 2048:
                        raise HTTPException(413, detail={'error': '请求过大'})
                    if not event.get('more_body'):
                        break
                try:
                    payload = json.loads(body)
                except (ValueError, UnicodeError):
                    raise HTTPException(400, detail={'error': '请求格式无效'}) from None
                if not isinstance(payload, dict) or not isinstance(payload.get('nonce'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{20,128}', payload['nonce']):
                    raise HTTPException(400, detail={'error': '登录交接编号无效'})
                nonce = payload['nonce']
                client_ip = str((scope.get('client') or ('', 0))[0])
                if path.endswith('/redeem'):
                    ticket = payload.get('ticket')
                    if not isinstance(ticket, str) or not re.fullmatch(r'[A-Za-z0-9_-]{40,64}', ticket):
                        raise HTTPException(401, detail={'error': '登录交接无效'})
                    key = consume_ticket(ticket, nonce)
                    result = {'key': key}
                else:
                    key_id = payload.get('key_id')
                    if type(key_id) is not int or key_id <= 0:
                        raise HTTPException(400, detail={'error': '请选择绘图密钥'})
                    me = await asyncio.to_thread(gateway_request, '/api/v1/auth/me', token, client_ip)
                    me = me.get('data', {})
                    if not isinstance(me, dict) or not me.get('id'):
                        raise HTTPException(401, detail={'error': '请重新登录主站'})
                    item = await asyncio.to_thread(gateway_request, '/api/v1/keys/' + str(key_id), token, client_ip)
                    item = item.get('data', {})
                    group = item.get('group') or {}
                    if item.get('user_id') != me['id']:
                        raise HTTPException(403, detail={'error': '只能使用自己的密钥'})
                    if item.get('status') != 'active' or group.get('status') != 'active' or not group.get('allow_image_generation'):
                        raise HTTPException(403, detail={'error': '此密钥或分组未开放绘图'})
                    key = item.get('key')
                    if not isinstance(key, str) or not key or local_identity(key):
                        raise HTTPException(403, detail={'error': '请使用主站用户密钥'})
                    # 真正的密钥权限、IP 限制和有效期仍由主站校验。
                    await asyncio.to_thread(gateway_request, '/v1/usage', key, client_ip)
                    result = {'ticket': issue_ticket(key, me['id'], nonce), 'expires_in': 60}
                return await JSONResponse(result, headers=response_headers)(scope, receive, send)
            except HTTPException as error:
                return await JSONResponse({'detail': error.detail}, status_code=error.status_code,
                                          headers=response_headers)(scope, receive, send)
        private = path.startswith(('/api/', '/v1/', '/auth/')) or path.rstrip('/') == '/health'
        if private:
            original_send = send
            async def send_private(event):
                if event['type'] == 'http.response.start':
                    event = dict(event)
                    event['headers'] = [(name, value) for name, value in event.get('headers', [])
                        if name.lower() not in (b'cache-control', b'pragma', b'expires')]
                    event['headers'].extend([(b'cache-control', b'no-store'), (b'pragma', b'no-cache')])
                await original_send(event)
            send = send_private
        if private and (sum(name.lower() == b'authorization' for name, _ in scope.get('headers', [])) > 1 or
                token and (len(token) > 512 or any(ord(char) < 33 or ord(char) > 126 for char in token))):
            return await JSONResponse({'detail': {'error': 'API 密钥格式无效'}}, status_code=401)(scope, receive, send)
        if path.startswith(('/api/', '/auth/')) and not token and scope['method'] != 'OPTIONS':
            return await JSONResponse({'detail': {'error': '请先登录'}}, status_code=401)(scope, receive, send)
        context = {'token': token, 'identity': None}
        if path.rstrip('/') == '/health':
            identity = await asyncio.to_thread(local_identity, token)
            if not identity or identity.get('role') != 'admin':
                return await JSONResponse({'detail': {'error': '需要管理员权限'}},
                    status_code=403 if token else 401,
                    headers={'Cache-Control': 'no-store'})(scope, receive, send)
        if path == '/api/workbench/session':
            if scope['method'] != 'GET':
                return await JSONResponse({'detail': {'error': 'Method not allowed'}}, status_code=405)(scope, receive, send)
            if not token:
                return await JSONResponse({'detail': {'error': '请先登录'}}, status_code=401,
                    headers={'Cache-Control': 'no-store'})(scope, receive, send)
            identity = await asyncio.to_thread(local_identity, token)
            if identity:
                if identity.get('role') != 'admin':
                    return await JSONResponse({'detail': {'error': '请使用主站签发的 API 密钥'}}, status_code=403)(scope, receive, send)
                return await JSONResponse({'role': 'admin', 'subject_id': 'admin'},
                    headers={'Cache-Control': 'no-store'})(scope, receive, send)
            client_ip = str((scope.get('client') or ('', 0))[0])
            try:
                usage = await asyncio.to_thread(gateway_request, '/v1/usage', token, client_ip)
            except HTTPException as error:
                return await JSONResponse({'detail': error.detail}, status_code=error.status_code,
                    headers={'Cache-Control': 'no-store'})(scope, receive, send)
            notice = ''
            models = []
            try:
                listing = await asyncio.to_thread(gateway_request, '/v1/models', token, client_ip)
                models = [item['id'] for item in listing.get('data', [])
                          if isinstance(item, dict) and item.get('id') == 'gpt-image-2']
                if not models:
                    notice = '当前密钥的模型列表未提供 gpt-image-2，生成时将由主站检查权限；如失败，请联系管理员。'
            except HTTPException as error:
                notice = error_message(error.detail)
            return await JSONResponse({'role': 'user', 'subject_id': customer_identity(token)['id'],
                'balance': customer_balance(usage), 'models': models, 'notice': notice},
                headers={'Cache-Control': 'no-store'})(scope, receive, send)
        if token:
            identity = await asyncio.to_thread(local_identity, token)
            if identity:
                context['identity'] = identity
                # Local credentials power the drawing engine, never a chat provider.
                # Keep model synchronization from advertising upstream chat models.
                if path.startswith('/v1/'):
                    if path == '/v1/models' and scope['method'] in ('GET', 'HEAD'):
                        return await JSONResponse({'object': 'list', 'data': [
                            {'id': 'gpt-image-2', 'object': 'model', 'created': 0, 'owned_by': 'mazal-image'}
                        ]})(scope, receive, send)
                    if path not in ('/v1/images/generations', '/v1/images/edits'):
                        return await JSONResponse({'detail': {'error': '此引擎仅提供图片生成和编辑'}},
                            status_code=404)(scope, receive, send)
                if path == '/api/customer-balance' and scope['method'] == 'GET':
                    return await JSONResponse({'source': 'local'},
                        headers={'Cache-Control': 'no-store'})(scope, receive, send)
            elif path.startswith('/v1/') and headers.get(b'x-mazal-engine-only') == b'1':
                # Nginx's /engine/v1/ reaches this branch. Customer keys must never
                # call engine handlers directly and bypass Sub2API accounting.
                return await JSONResponse({'detail': {'error': '此入口仅供绘图引擎使用'}},
                                          status_code=401)(scope, receive, send)
            elif path.startswith('/v1/'):
                return await proxy_gateway(scope, receive, send, token)
            elif path == '/auth/login' or path.startswith('/api/'):
                client_ip = str((scope.get('client') or ('', 0))[0])
                read_only_task_poll = path in ('/api/image-tasks', '/api/customer-balance') and scope['method'] == 'GET'
                validation_path = '/v1/usage' if read_only_task_poll else '/v1/models'
                try:
                    validation = await asyncio.to_thread(gateway_request, validation_path, token, client_ip)
                except HTTPException as error:
                    return await JSONResponse({'detail': error.detail}, status_code=error.status_code)(scope, receive, send)
                if path == '/api/customer-balance' and scope['method'] == 'GET':
                    return await JSONResponse(customer_balance(validation),
                        headers={'Cache-Control': 'no-store'})(scope, receive, send)
                identity = customer_identity(token)
                identity.update(_gateway_token=token, _gateway_client_ip=client_ip)
                context['identity'] = identity
        elif path == '/api/customer-balance':
            return await JSONResponse({'detail': {'error': '请先登录'}}, status_code=401,
                headers={'Cache-Control': 'no-store'})(scope, receive, send)
        elif path.startswith('/v1/'):
            return await proxy_gateway(scope, receive, send, '')
        marker = CONTEXT.set(context)
        submitting = path in ('/api/image-tasks/edits', '/api/image-tasks/generations') and scope['method'] == 'POST'
        acquired = False
        try:
            if submitting:
                acquired = TASK_UPLOAD_SLOTS.acquire(blocking=False)
                if not acquired:
                    return await JSONResponse({'detail': {'error': '任务提交繁忙，请稍后重试'}},
                        status_code=429, headers={'Retry-After': '3'})(scope, receive, send)
            return await self.engine(scope, receive, send)
        finally:
            if acquired:
                TASK_UPLOAD_SLOTS.release()
            CONTEXT.reset(marker)


engine_app = create_app()
# 旧版根页会恢复其独立登录状态；只保留明确的管理页及其实际静态资源。
engine_app.router.routes[:] = [route for route in engine_app.router.routes
                              if getattr(route, 'path', None) != '/{full_path:path}']


@engine_app.api_route('/{full_path:path}', methods=['GET', 'HEAD'], include_in_schema=False)
async def serve_admin_asset(full_path: str):
    if any(part in ('.', '..') for part in full_path.split('/')):
        raise HTTPException(404, detail='Not Found')
    if full_path == 'favicon.ico':
        return RedirectResponse('/pwa-icon.svg', status_code=302)
    allowed = re.fullmatch(
        r'(?:accounts|settings|logs|debug|image-manager|login)'
        r'(?:/?|/index\.(?:html|txt)|/__next\.[A-Za-z0-9_.-]+(?:/__PAGE__)?\.txt)'
        r'|_next/static/[^\\\x00]+'
        r'|(?:openai|github)\.svg', full_path)
    if allowed:
        asset = support.resolve_web_asset(full_path)
        if asset is not None:
            return FileResponse(asset, headers={'Cache-Control': 'no-store'}
                                if not full_path.startswith('_next/static/') else None)
    raise HTTPException(404, detail='Not Found')


app = CustomerGateway(engine_app)
