"""Image-only protocol adapters. Every generation is billed by the main gateway.

This is a deliberately limited image protocol bridge, not a conversational LLM.
No remote reference downloads, provider model aliases, or local engine fallback.
"""
import asyncio
import base64
import binascii
import hashlib
import json
import re
import time
import uuid

from fastapi import HTTPException
from starlette.responses import JSONResponse, Response, StreamingResponse

MODEL = 'gpt-image-2'
MAX_BODY = 30 * 1024**2
MAX_IMAGES = 8
MAX_INPUT_BYTES = 24 * 1024**2
TASK_ID = re.compile(r'(?:imgtask|resp)_[a-f0-9]{32}')
GEMINI = re.compile(r'/v1beta/models/(gpt-image-2):(generateContent|streamGenerateContent)')
CORS = {'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Goog-Api-Key, X-Client-Request-Id',
        'Access-Control-Expose-Headers': 'X-Request-Id, Location, Retry-After',
        'Cache-Control': 'no-store'}


def invalid(message, status=400):
    raise HTTPException(status, detail={'error': message})


def aliased(obj, camel, snake, default=None):
    if camel in obj and snake in obj and obj[camel] != obj[snake]:
        invalid('Conflicting ' + camel + ' and ' + snake)
    return obj.get(camel, obj.get(snake, default))


def image_source(value):
    if isinstance(value, dict):
        value = value.get('url')
    if not isinstance(value, str):
        invalid('Reference images must be inline data URLs')
    match = re.fullmatch(r'data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)', value)
    if not match:
        invalid('Upload PNG, JPEG or WebP as a data URL; remote image URLs are not supported')
    try:
        content = base64.b64decode(re.sub(r'\s', '', match[2]), validate=True)
    except (ValueError, binascii.Error):
        invalid('Invalid base64 reference image')
    if not content:
        invalid('Reference image is empty')
    return content, 'upload.' + match[1].split('/')[1], match[1]


def content_parts(content, text, images, *, gemini=False):
    if isinstance(content, str):
        text.append(content)
        return
    if not isinstance(content, list):
        invalid('Message content must be text or an array of image/text parts')
    for part in content:
        if not isinstance(part, dict):
            invalid('Invalid message content part')
        kind = part.get('type')
        if (gemini and 'text' in part) or kind in ('text', 'input_text'):
            if not isinstance(part.get('text'), str):
                invalid('Text parts must contain a string')
            text.append(part['text'])
        elif gemini and ('inlineData' in part or 'inline_data' in part):
            data = part.get('inlineData', part.get('inline_data'))
            if not isinstance(data, dict):
                invalid('Invalid inlineData')
            images.append(image_source('data:' + str(data.get('mimeType', data.get('mime_type', ''))) + ';base64,' + str(data.get('data', ''))))
        elif kind in ('image_url', 'input_image'):
            images.append(image_source(part.get('image_url')))
        else:
            invalid('Only text and inline reference image parts are supported')


def parse_request(body, protocol):
    if not isinstance(body, dict):
        invalid('The request body must be a JSON object')
    if body.get('background') and body.get('stream'):
        invalid('Use background=true or stream=true, separately')
    for field in ('mask', 'background_color', 'output_format', 'output_compression', 'moderation', 'input_fidelity'):
        if field in body:
            invalid(field + ' is not supported by this image adapter')
    if 'background' in body and not isinstance(body['background'], bool):
        invalid('background must be a boolean; transparent output is not supported')
    text, images = [], []
    options = body
    if protocol == 'gemini':
        contents = body.get('contents')
        if not isinstance(contents, list) or not contents:
            invalid('contents must contain a user message')
        users = [v for v in contents if isinstance(v, dict) and v.get('role', 'user') == 'user']
        if len(contents) != 1 or len(users) != 1:
            invalid('This image adapter accepts one user message; send reference images explicitly')
        content_parts(users[0].get('parts'), text, images, gemini=True)
        generation = aliased(body, 'generationConfig', 'generation_config', {})
        if not isinstance(generation, dict):
            invalid('generationConfig must be an object')
        candidates = aliased(generation, 'candidateCount', 'candidate_count', 1)
        if type(candidates) is not int or candidates != 1:
            invalid('candidateCount must be 1')
        modalities = aliased(generation, 'responseModalities', 'response_modalities', ['IMAGE'])
        if not isinstance(modalities, list) or 'IMAGE' not in modalities or any(m not in ('TEXT', 'IMAGE') for m in modalities):
            invalid('responseModalities must include IMAGE; this adapter returns images')
        image_config = aliased(generation, 'imageConfig', 'image_config', {})
        if not isinstance(image_config, dict):
            invalid('imageConfig must be an object')
        aspect = aliased(image_config, 'aspectRatio', 'aspect_ratio', '1:1')
        image_size = aliased(image_config, 'imageSize', 'image_size', '1K')
        dims = {'1:1': (1024, 1024), '3:2': (1536, 1024), '2:3': (1024, 1536),
                '16:9': (1536, 864), '9:16': (864, 1536), '4:3': (1344, 1008), '3:4': (1008, 1344)}
        if not isinstance(aspect, str) or aspect not in dims or image_size not in ('1K', '2K', '4K'):
            invalid('Unsupported aspectRatio or imageSize')
        scale = {'1K': 1, '2K': 2, '4K': 4}[image_size]
        options = {'size': '%dx%d' % tuple(v * scale for v in dims[aspect])}
        for field in ('tools', 'systemInstruction', 'system_instruction', 'cachedContent', 'cached_content'):
            if body.get(field):
                invalid(field + ' is not supported by the image adapter')
    elif protocol in ('chat', 'responses'):
        if body.get('model') != MODEL:
            invalid('Use model gpt-image-2 for this image adapter')
        for field in ('previous_response_id', 'conversation', 'response_format', 'functions', 'function_call'):
            if body.get(field):
                invalid(field + ' is not supported by this image adapter')
        if body.get('store') is True:
            invalid('store=true is not supported; use background=true and task queries')
        choice = body.get('tool_choice', 'auto')
        if choice not in ('auto', 'required') and choice != {'type': 'image_generation'}:
            invalid('tool_choice must allow image_generation; text-only and tool_choice=none are not supported')
        tools = body.get('tools', [])
        if not isinstance(tools, list) or len(tools) > 1 or any(not isinstance(t, dict) or t.get('type') != 'image_generation' for t in tools):
            invalid('Only a single image_generation tool is supported')
        if protocol == 'chat':
            if tools:
                invalid('Chat image requests use messages directly, without tools')
            messages = body.get('messages')
            if not isinstance(messages, list) or not messages:
                invalid('messages must contain a user message')
            users = [m for m in messages if isinstance(m, dict) and m.get('role') == 'user']
            if not users:
                invalid('messages must contain a user message')
            # A client may send its entire history. Only the latest user turn
            # is a new generation; previous assistant output is never replayed.
            content_parts(users[-1].get('content'), text, images)
        else:
            value = body.get('input')
            if isinstance(value, str):
                text.append(value)
            elif isinstance(value, list) and value:
                if all(isinstance(v, dict) and v.get('type') in ('input_text', 'input_image') for v in value):
                    content_parts(value, text, images)
                else:
                    if len(value) != 1 or not isinstance(value[0], dict) or value[0].get('role', 'user') != 'user':
                        invalid('Responses input supports one explicit user turn')
                    content_parts(value[0].get('content'), text, images)
            else:
                invalid('input must contain text or a user message')
            if tools:
                tool = tools[0]
                for field in ('background', 'output_format', 'output_compression', 'moderation', 'input_fidelity', 'mask'):
                    if field in tool:
                        invalid(field + ' is not supported by this image adapter')
                if tool.get('model', MODEL) != MODEL:
                    invalid('The image tool model must be gpt-image-2')
                if tool.get('partial_images', 0) != 0:
                    invalid('Partial image previews are not supported; use partial_images=0')
                action = tool.get('action', 'auto')
                if action not in ('auto', 'generate', 'edit'):
                    invalid('image_generation action must be auto, generate or edit')
                if action == 'edit' and not images:
                    invalid('action=edit requires an inline reference image')
                options = {**body, **{k: tool[k] for k in ('size', 'quality') if k in tool}}
            if 'instructions' in body:
                if not isinstance(body['instructions'], str):
                    invalid('instructions must be a string')
                text.insert(0, body['instructions'])
    else:
        if body.get('model', MODEL) != MODEL:
            invalid('Use model gpt-image-2')
        if not isinstance(body.get('prompt'), str):
            invalid('prompt is required')
        text.append(body['prompt'])
        references = body.get('images', [])
        if not isinstance(references, list):
            invalid('images must be an array of inline data URLs')
        images.extend(image_source(v) for v in references)
    prompt = '\n'.join(text).strip()
    if not prompt or len(prompt) > 16000:
        invalid('Prompt must contain 1 to 16000 characters')
    if type(body.get('n', 1)) is not int or body.get('n', 1) != 1:
        invalid('This adapter generates one image per task; use the Images API for n>1')
    if len(images) > MAX_IMAGES or sum(len(i[0]) for i in images) > MAX_INPUT_BYTES:
        invalid('At most 8 reference images, totaling 24 MB, are supported', 413)
    quality = options.get('quality', 'auto')
    size = options.get('size', 'auto')
    if quality not in ('auto', 'low', 'medium', 'high'):
        invalid('quality must be auto, low, medium or high')
    if not isinstance(size, str) or not re.fullmatch(r'auto|[1-9][0-9]{0,3}x[1-9][0-9]{0,3}', size):
        invalid('size must be auto or WIDTHxHEIGHT')
    if size != 'auto' and any(int(v) > 6144 or int(v) < 256 for v in size.split('x')):
        invalid('Image dimensions must be between 256 and 6144')
    for field in ('stream', 'background'):
        if field in body and type(body[field]) is not bool:
            invalid(field + ' must be a boolean')
    result_format = 'b64_json' if protocol in ('responses', 'gemini') else body.get('response_format', 'url')
    if result_format not in ('url', 'b64_json'):
        invalid('response_format must be url or b64_json')
    return {'prompt': prompt, 'model': MODEL, 'n': 1, 'size': size, 'quality': quality,
            'response_format': result_format, **({'images': images} if images else {})}


def public_task(task):
    state = {'queued': 'queued', 'running': 'in_progress', 'success': 'completed', 'error': 'failed'}[task['status']]
    result = {'id': task['id'], 'object': 'image.task', 'model': MODEL, 'status': state,
              'created_at': int(task['created_ts'])}
    if task['status'] == 'success':
        result['result'] = {'data': task.get('data', []), **({'usage': task['usage']} if task.get('usage') else {})}
    if task['status'] == 'error':
        result['error'] = {'message': task.get('error', 'Image generation failed'), 'type': 'image_generation_error'}
    return result


def responses_result(task):
    result = {'id': task['id'], 'object': 'response', 'created_at': int(task['created_ts']),
              'model': MODEL, 'status': {'queued': 'queued', 'running': 'in_progress', 'success': 'completed', 'error': 'failed'}[task['status']],
              'output': [], 'error': None, 'parallel_tool_calls': False}
    if task['status'] == 'success':
        for i, item in enumerate(task.get('data', [])):
            if not isinstance(item, dict) or not isinstance(item.get('b64_json'), str) or not item['b64_json']:
                invalid('The image gateway did not return the requested base64 image', 502)
            result['output'].append({'id': 'ig_' + task['id'].split('_', 1)[1] + '_' + str(i),
                'type': 'image_generation_call', 'status': 'completed', 'result': item['b64_json']})
    if task['status'] == 'error':
        result['error'] = {'code': 'image_generation_failed', 'message': task.get('error', 'Image generation failed')}
    return result


def image_urls(task):
    urls = []
    for item in task.get('data', []):
        if isinstance(item, dict):
            if item.get('b64_json'):
                urls.append('data:image/png;base64,' + item['b64_json'])
            elif isinstance(item.get('url'), str) and re.match(r'^https?://', item['url']):
                urls.append(item['url'])
    if not urls:
        invalid('The image gateway returned no usable images', 502)
    return urls


def chat_result(task):
    urls = image_urls(task)
    message = {'role': 'assistant', 'content': '\n'.join('![image](' + u + ')' for u in urls),
               'images': [{'type': 'image_url', 'image_url': {'url': u}} for u in urls]}
    return {'id': 'chatcmpl-' + task['id'].split('_', 1)[1], 'object': 'chat.completion',
            'created': int(task['created_ts']), 'model': MODEL,
            'choices': [{'index': 0, 'message': message, 'finish_reason': 'stop'}]}


def gemini_result(task):
    parts = []
    for item in task.get('data', []):
        if not isinstance(item, dict) or not isinstance(item.get('b64_json'), str) or not item['b64_json']:
            invalid('The image gateway did not return the requested base64 image', 502)
        parts.append({'inlineData': {'mimeType': 'image/png', 'data': item['b64_json']}})
    return {'candidates': [{'content': {'role': 'model', 'parts': parts}, 'finishReason': 'STOP', 'index': 0}],
            'modelVersion': MODEL, 'responseId': task['id']}


class ImageProtocols:
    def __init__(self, app, integration):
        self.app = app
        self.integration = integration
        self.engine = app.engine

    def __setattr__(self, name, value):
        object.__setattr__(self, name, value)
        if name == 'engine':
            self.app.engine = value

    @staticmethod
    def route(path):
        if path in ('/v1/chat/completions', '/v1/responses', '/v1/images/tasks', '/v1/image-capabilities', '/v1beta/models'):
            return True
        return bool(GEMINI.fullmatch(path) or re.fullmatch(r'/v1/(?:images/tasks|responses)/[A-Za-z0-9_-]+', path))

    def lookup(self, identity, task_id):
        service = self.integration.image_tasks.image_task_service
        with service._lock:
            if service._cleanup_locked():
                service._save_locked()
            task = service._tasks.get(identity['id'] + ':' + task_id)
            if not task or not task.get('api_protocol'):
                invalid('Task not found or expired', 404)
            return dict(task)

    def submit(self, identity, payload, protocol, idempotency):
        service = self.integration.image_tasks.image_task_service
        fingerprint_payload = {k: v for k, v in payload.items() if k != 'images'}
        fingerprint_payload['images'] = [hashlib.sha256(v[0]).hexdigest() for v in payload.get('images', [])]
        fingerprint = hashlib.sha256(json.dumps([protocol, fingerprint_payload], sort_keys=True).encode()).hexdigest()
        prefix = 'resp_' if protocol == 'responses' else 'imgtask_'
        task_id = prefix + (hashlib.sha256((protocol + ':' + idempotency).encode()).hexdigest()[:32] if idempotency else uuid.uuid4().hex)
        key = identity['id'] + ':' + task_id
        with service._lock:
            existing = service._tasks.get(key)
            if existing:
                if existing.get('api_fingerprint') != fingerprint:
                    invalid('Idempotency-Key was already used with a different request', 409)
                return dict(existing)
            service._submit(dict(identity), client_task_id=task_id,
                            mode='edit' if payload.get('images') else 'generate', payload=payload)
            service._tasks[key].update(api_protocol=protocol, api_fingerprint=fingerprint)
            service._save_locked()
            return dict(service._tasks[key])

    async def wait(self, identity, task_id):
        deadline = time.monotonic() + 620
        while True:
            task = await asyncio.to_thread(self.lookup, identity, task_id)
            if task['status'] in ('success', 'error'):
                return task
            if time.monotonic() >= deadline:
                invalid('Wait timed out. Query task ' + task_id + '; do not resubmit with a new Idempotency-Key', 504)
            await asyncio.sleep(.25)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path = scope.get('path', '')
        native_image = path in ('/v1/images/generations', '/v1/images/edits', '/v1/models')
        if not self.route(path) and not native_image:
            return await self.app(scope, receive, send)
        incoming = scope.get('headers', [])
        headers = dict(incoming)
        # Internal engine behavior and its authentication remain untouched.
        if headers.get(b'x-mazal-engine-only') == b'1':
            return await self.app(scope, receive, send)
        original_send = send
        async def cors_send(event):
            if event['type'] == 'http.response.start':
                event = dict(event)
                event['headers'] = [(k, v) for k, v in event.get('headers', [])
                                    if k.lower() not in {x.lower().encode() for x in CORS}]
                event['headers'] += [(k.lower().encode(), v.encode()) for k, v in CORS.items()]
            await original_send(event)
        send = cors_send
        if scope['method'] == 'OPTIONS':
            return await Response(status_code=204)(scope, receive, send)
        if native_image:
            return await self.app(scope, receive, send)
        protocol = 'gemini' if path.startswith('/v1beta/') else 'responses' if path.startswith('/v1/responses') else 'chat' if path.endswith('/chat/completions') else 'task'
        task = None
        location = None
        try:
            if any(sum(k == key for k, _ in incoming) > 1 for key in (b'authorization', b'x-goog-api-key', b'idempotency-key')):
                invalid('Duplicate authentication or idempotency headers', 401)
            auth = headers.get(b'authorization', b'').decode('latin1')
            token = self.integration.support.extract_bearer_token(auth)
            google_key = headers.get(b'x-goog-api-key', b'').decode('latin1')
            if protocol == 'gemini' and google_key:
                if token and token != google_key:
                    invalid('Conflicting API keys', 401)
                token = google_key
            if not token or len(token) > 512 or any(ord(c) < 33 or ord(c) > 126 for c in token):
                invalid('Provide a valid customer API key', 401)
            if await asyncio.to_thread(self.integration.local_identity, token):
                if path in ('/v1/chat/completions', '/v1/responses'):
                    return await self.app(scope, receive, send)
                invalid('Use a main-site customer key for the public image adapters', 403)
            ip = str((scope.get('client') or ('', 0))[0])
            # Querying a task still works with zero credit, but revoked keys and
            # existing account/IP restrictions remain enforced on every read.
            await asyncio.to_thread(self.integration.gateway_request, '/v1/usage', token, ip)
            identity = self.integration.customer_identity(token)
            identity.update(_gateway_token=token, _gateway_client_ip=ip)
            if path == '/v1/image-capabilities':
                if scope['method'] != 'GET':
                    invalid('Method not allowed', 405)
                return await JSONResponse({'model': MODEL, 'protocols': ['images', 'responses-image', 'chat-image', 'gemini-image', 'image-tasks'],
                    'max_images_per_task': 1, 'remote_reference_urls': False,
                    'partial_image_streaming': False, 'task_retention': 'same as existing image tasks; query before the configured expiry',
                    'idempotency': 'Idempotency-Key; scoped to API key and protocol, retained with task',
                    'billing': 'main gateway image pricing; task queries do not generate images'})(scope, receive, send)
            if path == '/v1beta/models':
                if scope['method'] != 'GET':
                    invalid('Method not allowed', 405)
                return await JSONResponse({'models': [{'name': 'models/' + MODEL, 'displayName': MODEL + ' (image protocol adapter)',
                    'supportedGenerationMethods': ['generateContent', 'streamGenerateContent']}]})(scope, receive, send)
            match = re.fullmatch(r'/v1/(images/tasks|responses)/([A-Za-z0-9_-]+)', path)
            if match:
                if scope['method'] != 'GET':
                    invalid('Method not allowed', 405)
                if not TASK_ID.fullmatch(match[2]):
                    invalid('Task not found', 404)
                task = await asyncio.to_thread(self.lookup, identity, match[2])
                if match[1] == 'responses' and task.get('api_protocol') != 'responses':
                    invalid('Response not found', 404)
                result = responses_result(task) if match[1] == 'responses' else public_task(task)
                return await JSONResponse(result)(scope, receive, send)
            if scope['method'] != 'POST':
                invalid('Method not allowed', 405)
            if not headers.get(b'content-type', b'').lower().startswith(b'application/json'):
                invalid('Content-Type must be application/json', 415)
            idem = headers.get(b'idempotency-key', b'').decode('latin1')
            if idem and not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', idem):
                invalid('Idempotency-Key must contain 1 to 128 ASCII letters, digits, dot, underscore, colon or hyphen')
            # Reuse upload limits before reading/decoding a potentially large body.
            if not self.integration.TASK_UPLOAD_SLOTS.acquire(blocking=False):
                invalid('Task submission busy; retry later', 429)
            try:
                raw = bytearray()
                while True:
                    event = await receive()
                    if event['type'] == 'http.disconnect':
                        return
                    raw.extend(event.get('body', b''))
                    if len(raw) > MAX_BODY:
                        invalid('Request exceeds 30 MB', 413)
                    if not event.get('more_body'):
                        break
                try:
                    body = json.loads(raw)
                except (ValueError, UnicodeError):
                    invalid('Invalid JSON')
                payload = parse_request(body, protocol)
                if protocol == 'task' and body.get('stream'):
                    invalid('Task creation returns JSON; query the task for progress')
                await asyncio.to_thread(self.integration.image_tasks.check_request, payload['prompt'])
                task = await asyncio.to_thread(self.submit, identity, payload, protocol, idem)
            finally:
                self.integration.TASK_UPLOAD_SLOTS.release()
            location = ('/v1/responses/' if protocol == 'responses' else '/v1/images/tasks/') + task['id']
            if protocol == 'task' or protocol == 'responses' and body.get('background'):
                result = responses_result(task) if protocol == 'responses' else public_task(task)
                return await JSONResponse(result, status_code=202 if protocol == 'task' else 200,
                    headers={'Location': location, 'X-Request-Id': task['id']})(scope, receive, send)
            streaming = bool(body.get('stream')) or protocol == 'gemini' and path.endswith(':streamGenerateContent')
            if streaming:
                return await StreamingResponse(self.stream(identity, task, protocol), media_type='text/event-stream',
                    headers={'X-Request-Id': task['id'], 'Location': location, 'X-Accel-Buffering': 'no'})(scope, receive, send)
            task = await self.wait(identity, task['id'])
            if task['status'] == 'error':
                invalid(task.get('error', 'Image generation failed'), int(task.get('http_status') or 502))
            result = responses_result(task) if protocol == 'responses' else gemini_result(task) if protocol == 'gemini' else chat_result(task)
            return await JSONResponse(result, headers={'X-Request-Id': task['id'], 'Location': location})(scope, receive, send)
        except HTTPException as error:
            message = self.integration.error_message(error.detail)
            if protocol == 'gemini':
                payload = {'error': {'code': error.status_code, 'message': message,
                    'status': {400: 'INVALID_ARGUMENT', 401: 'UNAUTHENTICATED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 429: 'RESOURCE_EXHAUSTED'}.get(error.status_code, 'INTERNAL')}}
            else:
                payload = {'error': {'message': message, 'type': 'invalid_request_error' if error.status_code < 500 else 'server_error', 'code': error.status_code}}
            response_headers = {}
            if task and location:
                response_headers = {'X-Request-Id': task['id'], 'Location': location}
                payload['error'].update(task_id=task['id'], task_url=location)
            return await JSONResponse(payload, status_code=error.status_code, headers=response_headers)(scope, receive, send)

    async def stream(self, identity, task, protocol):
        sequence = 0
        def event(name, payload):
            nonlocal sequence
            if protocol == 'responses':
                payload = {'type': name, 'sequence_number': sequence, **payload}
                sequence += 1
                return 'event: ' + name + '\ndata: ' + json.dumps(payload) + '\n\n'
            return 'data: ' + json.dumps(payload) + '\n\n'
        if protocol == 'responses':
            initial = responses_result({**task, 'status': 'running'})
            yield event('response.created', {'response': initial})
            yield event('response.in_progress', {'response': initial})
        elif protocol == 'chat':
            yield event('', {'id': 'chatcmpl-' + task['id'].split('_', 1)[1], 'object': 'chat.completion.chunk',
                'model': MODEL, 'created': int(task['created_ts']), 'choices': [{'index': 0, 'delta': {'role': 'assistant'}, 'finish_reason': None}]})
        waiter = asyncio.create_task(self.wait(identity, task['id']))
        try:
            while not waiter.done():
                done, _ = await asyncio.wait({waiter}, timeout=10)
                if not done:
                    yield ': waiting for image\n\n'
            task = await waiter
            if task['status'] == 'error':
                invalid(task.get('error', 'Image generation failed'), int(task.get('http_status') or 502))
            if protocol == 'responses':
                result = responses_result(task)
                for i, item in enumerate(result['output']):
                    yield event('response.output_item.added', {'output_index': i, 'item': {**item, 'status': 'in_progress', 'result': ''}})
                    yield event('response.output_item.done', {'output_index': i, 'item': item})
                yield event('response.completed', {'response': result})
            elif protocol == 'chat':
                result = chat_result(task)
                message = result['choices'][0]['message']
                yield event('', {**{k: result[k] for k in ('id', 'created', 'model')}, 'object': 'chat.completion.chunk',
                    'choices': [{'index': 0, 'delta': {'content': message['content'], 'images': message['images']}, 'finish_reason': None}]})
                yield event('', {**{k: result[k] for k in ('id', 'created', 'model')}, 'object': 'chat.completion.chunk',
                    'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})
                yield 'data: [DONE]\n\n'
            else:
                yield event('', gemini_result(task))
        except HTTPException as error:
            message = self.integration.error_message(error.detail)
            if protocol == 'responses':
                failed = responses_result({**task, 'status': 'error', 'error': message})
                yield event('response.failed', {'response': failed})
            else:
                yield event('', {'error': {'message': message, 'code': error.status_code}})
        finally:
            if not waiter.done():
                waiter.cancel()  # Stop waiting; the single billed task continues.


def install(app, integration):
    return ImageProtocols(app, integration)
