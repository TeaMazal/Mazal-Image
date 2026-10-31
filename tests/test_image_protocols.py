"""Offline protocol contracts, billed-gateway routing and replay/isolation checks."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from email.parser import BytesParser
from email.policy import default
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import test_gateway_integration as fixture
import image_protocols as adapter
from services.image_task_service import ImageTaskService

i = fixture.integration
CUSTOMER = fixture.CUSTOMER
INLINE = 'data:image/png;base64,aW1hZ2U='


def req(path, payload=None, key=CUSTOMER, method='POST', **kwargs):
    return asyncio.run(fixture.request(path, key, method, payload, **kwargs))


def calls():
    return [x for x in fixture.SEEN if x[0] in ('/v1/images/generations', '/v1/images/edits')]


class ImageProtocolsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='protocol-test-')
        self.service = ImageTaskService(Path(self.tmp.name) / 'tasks.json')
        self.service_patch = patch.object(i.image_tasks, 'image_task_service', self.service)
        self.service_patch.start()
        self.before = len(calls())

    def tearDown(self):
        for _ in range(200):
            with self.service._lock:
                active = any(t['status'] in ('queued', 'running') for t in self.service._tasks.values())
            if not active:
                break
            time.sleep(.01)
        self.service_patch.stop()
        self.tmp.cleanup()

    def body(self, **extra):
        return {'model': adapter.MODEL, 'prompt': 'a dog', **extra}

    def chat(self, **extra):
        return {'model': adapter.MODEL, 'messages': [{'role': 'user', 'content': 'a dog'}], **extra}

    def completed(self, task_id, key=CUSTOMER):
        for _ in range(100):
            code, task = req('/v1/images/tasks/' + task_id, method='GET', key=key)
            if code != 200 or task['status'] in ('completed', 'failed'):
                return code, task
            time.sleep(.01)
        self.fail('Task did not finish')

    def test_chat_returns_markdown_and_structured_images_and_bills_once(self):
        code, result = req('/v1/chat/completions', self.chat())
        self.assertEqual(code, 200)
        self.assertEqual(result['object'], 'chat.completion')
        msg = result['choices'][0]['message']
        self.assertIn('https://example.invalid/test.png', msg['content'])
        self.assertEqual(msg['images'][0]['image_url']['url'], 'https://example.invalid/test.png')
        self.assertEqual(len(calls()), self.before + 1)
        self.assertEqual(calls()[-1][1:3], (CUSTOMER, '198.51.100.42'))

    def test_chat_only_submits_latest_user_turn(self):
        body = self.chat(messages=[{'role': 'user', 'content': 'old'}, {'role': 'assistant', 'content': 'old result'},
                                   {'role': 'user', 'content': 'new dog'}])
        self.assertEqual(req('/v1/chat/completions', body)[0], 200)
        self.assertEqual(json.loads(calls()[-1][3])['prompt'], 'new dog')

    def test_responses_returns_image_generation_call_base64(self):
        code, result = req('/v1/responses', {'model': adapter.MODEL, 'input': 'a dog',
            'tools': [{'type': 'image_generation', 'size': '1024x1024', 'partial_images': 0}]})
        self.assertEqual((code, result['status']), (200, 'completed'))
        self.assertEqual(result['output'][0]['type'], 'image_generation_call')
        self.assertEqual(result['output'][0]['result'], 'aW1hZ2U=')
        code, saved = req('/v1/responses/' + result['id'], method='GET')
        self.assertEqual((code, saved), (200, result))
        self.assertEqual(len(calls()), self.before + 1)

    def test_responses_background_returns_retrievable_same_task(self):
        code, result = req('/v1/responses', {'model': adapter.MODEL, 'input': 'a dog', 'background': True})
        self.assertEqual(code, 200)
        self.assertTrue(result['id'].startswith('resp_'))
        self.assertEqual(self.completed(result['id'])[1]['status'], 'completed')
        self.assertEqual(len(calls()), self.before + 1)

    def test_inline_reference_becomes_billed_multipart_edit(self):
        body = self.chat(messages=[{'role': 'user', 'content': [
            {'type': 'text', 'text': 'a dog'}, {'type': 'image_url', 'image_url': {'url': INLINE}}]}])
        self.assertEqual(req('/v1/chat/completions', body)[0], 200)
        self.assertEqual(calls()[-1][0], '/v1/images/edits')
        self.assertIn(b'a dog', calls()[-1][3])
        self.assertIn(b'image', calls()[-1][3])
        self.assertNotIn(b'data:image', calls()[-1][3])

    def test_responses_input_parts_reference(self):
        body = {'model': adapter.MODEL, 'input': [{'type': 'input_text', 'text': 'a dog'},
            {'type': 'input_image', 'image_url': INLINE}]}
        self.assertEqual(req('/v1/responses', body)[0], 200)
        self.assertEqual(calls()[-1][0], '/v1/images/edits')

    def test_gemini_native_headers_response_and_dimensions(self):
        body = {'contents': [{'parts': [{'text': 'a dog'}]}],
                'generationConfig': {'imageConfig': {'aspectRatio': '3:2', 'imageSize': '2K'}}}
        code, result = req('/v1beta/models/gpt-image-2:generateContent', body, key='',
            extra_headers=[(b'x-goog-api-key', CUSTOMER.encode())])
        self.assertEqual(code, 200)
        self.assertEqual(result['candidates'][0]['content']['parts'][0]['inlineData']['data'], 'aW1hZ2U=')
        self.assertEqual(json.loads(calls()[-1][3])['size'], '3072x2048')

    def test_gemini_inline_reference(self):
        body = {'contents': [{'parts': [{'text': 'a dog'}, {'inlineData': {'mimeType': 'image/png', 'data': 'aW1hZ2U='}}]}]}
        self.assertEqual(req('/v1beta/models/gpt-image-2:generateContent', body)[0], 200)
        self.assertEqual(calls()[-1][0], '/v1/images/edits')

    def test_gemini_snake_case_preserves_size_and_rejects_unsupported_count(self):
        path = '/v1beta/models/gpt-image-2:generateContent'
        contents = [{'parts': [{'text': 'a dog'}]}]
        code, _ = req(path, {'contents': contents, 'generation_config': {
            'candidate_count': 1, 'response_modalities': ['IMAGE'],
            'image_config': {'aspect_ratio': '3:2', 'image_size': '2K'}}})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(calls()[-1][3])['size'], '3072x2048')
        before = len(calls())
        for config in [{'candidate_count': 2}, {'candidateCount': True},
                       {'response_modalities': ['TEXT']},
                       {'imageConfig': {'aspectRatio': '1:1'}, 'image_config': {'aspect_ratio': '3:2'}}]:
            self.assertEqual(req(path, {'contents': contents, 'generation_config': config})[0], 400)
        self.assertEqual(len(calls()), before)

    def test_responses_tool_choice_none_and_edit_without_reference_never_generate(self):
        for extra in [{'tool_choice': 'none'}, {'tool_choice': {'type': 'function', 'name': 'x'}},
                      {'tools': [{'type': 'image_generation', 'action': 'edit'}]},
                      {'tools': [{'type': 'image_generation', 'action': 'unknown'}]}]:
            self.assertEqual(req('/v1/responses', {'model': adapter.MODEL, 'input': 'a dog', **extra})[0], 400)
        self.assertEqual(len(calls()), self.before)

    def test_responses_instructions_are_used_in_image_prompt(self):
        code, _ = req('/v1/responses', {'model': adapter.MODEL, 'input': 'a dog',
            'instructions': 'watercolor style', 'tool_choice': {'type': 'image_generation'}})
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(calls()[-1][3])['prompt'], 'watercolor style\na dog')

    def test_wait_timeout_keeps_query_address_and_does_not_resubmit(self):
        async def timeout(*args):
            raise i.HTTPException(504, detail={'error': 'Wait timed out'})
        with patch.object(i.app, 'wait', new=timeout):
            code, body, headers = req('/v1/responses', {'model': adapter.MODEL, 'input': 'a dog'}, return_headers=True)
        self.assertEqual(code, 504)
        task_id = body['error']['task_id']
        self.assertEqual(headers[b'x-request-id'].decode(), task_id)
        self.assertEqual(headers[b'location'].decode(), '/v1/responses/' + task_id)
        self.assertEqual(body['error']['task_url'], '/v1/responses/' + task_id)
        self.assertEqual(self.completed(task_id)[1]['status'], 'completed')
        self.assertEqual(req('/v1/responses/' + task_id, method='GET')[0], 200)
        self.assertEqual(len(calls()), self.before + 1)

    def test_gemini_model_catalog_is_explicit_adapter_not_google_alias(self):
        code, body = req('/v1beta/models', method='GET')
        self.assertEqual(code, 200)
        self.assertEqual(body['models'][0]['name'], 'models/gpt-image-2')
        self.assertNotIn('gemini-2', json.dumps(body))
        self.assertEqual(len(calls()), self.before)

    def test_async_task_queries_make_no_extra_generation(self):
        code, result, headers = req('/v1/images/tasks', self.body(), return_headers=True)
        self.assertEqual(code, 202)
        self.assertEqual(headers[b'location'].decode(), '/v1/images/tasks/' + result['id'])
        self.assertEqual(self.completed(result['id'])[1]['status'], 'completed')
        for _ in range(5):
            self.assertEqual(req('/v1/images/tasks/' + result['id'], method='GET')[0], 200)
        self.assertEqual(len(calls()), self.before + 1)

    def test_same_idempotency_key_same_input_reuses_result(self):
        h = [(b'idempotency-key', b'same-request')]
        a = req('/v1/images/tasks', self.body(), extra_headers=h)[1]
        self.completed(a['id'])
        b = req('/v1/images/tasks', self.body(), extra_headers=h)[1]
        self.assertEqual(a['id'], b['id'])
        self.assertEqual(len(calls()), self.before + 1)
        code, _ = req('/v1/images/tasks', self.body(prompt='different'), extra_headers=h)
        self.assertEqual(code, 409)
        self.assertEqual(len(calls()), self.before + 1)

    def test_idempotency_survives_task_service_reload_without_credentials_on_disk(self):
        h = [(b'idempotency-key', b'restart')]
        first = req('/v1/images/tasks', self.body(), extra_headers=h)[1]
        self.completed(first['id'])
        saved = self.service.path.read_text()
        self.assertNotIn(CUSTOMER, saved)
        self.assertNotIn('a dog', saved)
        reloaded = ImageTaskService(self.service.path)
        with patch.object(i.image_tasks, 'image_task_service', reloaded):
            second = req('/v1/images/tasks', self.body(), extra_headers=h)[1]
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(len(calls()), self.before + 1)

    def test_concurrent_duplicate_submissions_generate_once(self):
        h = [(b'idempotency-key', b'concurrent')]
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: req('/v1/images/tasks', self.body(), extra_headers=h), range(8)))
        accepted = [r[1] for r in results if r[0] == 202]
        self.assertTrue(accepted)
        self.assertEqual(len({r['id'] for r in accepted}), 1)
        self.completed(accepted[0]['id'])
        self.assertEqual(len(calls()), self.before + 1)

    def test_failed_task_status_and_idempotency_survive_reload(self):
        h = [(b'idempotency-key', b'failed-restart')]
        with patch.object(i, 'image_request', side_effect=i.HTTPException(429, detail={'error': 'busy'})):
            self.assertEqual(req('/v1/chat/completions', self.chat(), extra_headers=h)[0], 429)
        reloaded = ImageTaskService(self.service.path)
        with patch.object(i.image_tasks, 'image_task_service', reloaded):
            self.assertEqual(req('/v1/chat/completions', self.chat(), extra_headers=h)[0], 429)
        self.assertEqual(len(calls()), self.before)

    def test_unfinished_task_recovery_does_not_resubmit(self):
        h = [(b'idempotency-key', b'unfinished-restart')]
        task = req('/v1/images/tasks', self.body(), extra_headers=h)[1]
        self.completed(task['id'])
        saved = json.loads(self.service.path.read_text())
        saved['tasks'][0]['status'] = 'running'
        saved['tasks'][0].pop('data', None)
        self.service.path.write_text(json.dumps(saved))
        reloaded = ImageTaskService(self.service.path)
        with patch.object(i.image_tasks, 'image_task_service', reloaded):
            code, replay = req('/v1/images/tasks', self.body(), extra_headers=h)
        self.assertEqual((code, replay['status'], replay['id']), (202, 'failed', task['id']))
        self.assertEqual(len(calls()), self.before + 1)

    def test_other_customer_cannot_query_task_even_with_id(self):
        task = req('/v1/images/tasks', self.body())[1]
        self.completed(task['id'])
        self.assertEqual(req('/v1/images/tasks/' + task['id'], method='GET', key=fixture.EMPTY)[0], 404)
        self.assertEqual(req('/v1/images/tasks/' + task['id'], method='GET', key=fixture.REVOKED)[0], 401)
        self.assertEqual(len(calls()), self.before + 1)

    def test_authentication_failure_rejects_before_body(self):
        for key, expected in [('', 401), (fixture.REVOKED, 401), (i.config.auth_key, 403)]:
            self.assertEqual(req('/v1/images/tasks', {}, key=key, forbid_body=True)[0], expected)
        self.assertEqual(len(calls()), self.before)

    def test_duplicate_and_conflicting_key_headers_rejected(self):
        self.assertEqual(req('/v1/images/tasks', {}, extra_headers=[(b'authorization', b'Bearer other')], forbid_body=True)[0], 401)
        self.assertEqual(req('/v1beta/models/gpt-image-2:generateContent', {},
            extra_headers=[(b'x-goog-api-key', b'other')], forbid_body=True)[0], 401)

    def test_remote_references_and_unsupported_features_rejected_without_charge(self):
        for payload in [self.chat(messages=[{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': 'http://169.254.169.254/'}}]}]),
                        self.chat(model='gpt-6'), self.chat(n=2), self.chat(stream='true'), self.chat(size='9999x1024'),
                        self.chat(tools=[{'type': 'function'}]), self.chat(messages=[])]:
            with self.subTest(payload=payload):
                self.assertEqual(req('/v1/chat/completions', payload)[0], 400)
        for extra in [{'previous_response_id': 'old'}, {'store': True}, {'tools': [{'type': 'image_generation', 'partial_images': 1}]},
                      {'stream': True, 'background': True}, {'output_format': 'jpeg'},
                      {'tools': [{'type': 'image_generation', 'background': 'transparent'}]}]:
            self.assertEqual(req('/v1/responses', {'model': adapter.MODEL, 'input': 'test', **extra})[0], 400)
        self.assertEqual(len(calls()), self.before)

    def test_error_status_and_failed_idempotency_never_fallback_or_charge_twice(self):
        original = i.gateway_request
        attempts = []
        def fail(path, *args, **kwargs):
            if path.startswith('/v1/images/'):
                attempts.append(path)
                raise i.HTTPException(429, detail={'error': 'rate limited'})
            return original(path, *args, **kwargs)
        with patch.object(i, 'gateway_request', side_effect=fail):
            h = [(b'idempotency-key', b'failed')]
            for _ in range(2):
                code, body = req('/v1/chat/completions', self.chat(), extra_headers=h)
                self.assertEqual(code, 429)
                self.assertEqual(body['error']['message'], 'rate limited')
        self.assertEqual(attempts, ['/v1/images/generations'])
        self.assertEqual(len(calls()), self.before)

    def test_zero_balance_submission_is_failed_by_billed_gateway(self):
        code, _ = req('/v1/chat/completions', self.chat(), key=fixture.EMPTY)
        self.assertEqual(code, 403)

    def test_cors_preflight_native_and_adapter_works_without_key(self):
        for path in ['/v1/images/generations', '/v1/images/edits', '/v1/models', '/v1/chat/completions',
                     '/v1/responses', '/v1/images/tasks', '/v1beta/models/gpt-image-2:generateContent']:
            with self.subTest(path=path):
                code, _, headers = req(path, key='', method='OPTIONS', forbid_body=True, return_headers=True)
                self.assertEqual(code, 204)
                self.assertEqual(headers[b'access-control-allow-origin'], b'*')
                self.assertNotIn(b'access-control-allow-credentials', headers)
                self.assertIn(b'Idempotency-Key', headers[b'access-control-allow-headers'])
        self.assertEqual(len(calls()), self.before)

    def test_cors_includes_error_and_no_store(self):
        code, _, headers = req('/v1/responses', {}, key='', return_headers=True)
        self.assertEqual(code, 401)
        self.assertEqual(headers[b'access-control-allow-origin'], b'*')
        self.assertEqual(headers[b'cache-control'], b'no-store')

    def test_capabilities_are_authenticated_and_do_not_call_generation(self):
        code, body = req('/v1/image-capabilities', method='GET')
        self.assertEqual(code, 200)
        self.assertIn('gemini-image', body['protocols'])
        self.assertFalse(body['partial_image_streaming'])
        self.assertEqual(len(calls()), self.before)

    def test_stream_responses_final_event_and_sequence(self):
        code, text, headers = req('/v1/responses', {'model': adapter.MODEL, 'input': 'test', 'stream': True}, return_headers=True)
        self.assertEqual(code, 200)
        events = [json.loads(l[6:]) for l in text.splitlines() if l.startswith('data: ')]
        self.assertEqual(events[0]['type'], 'response.created')
        self.assertEqual(events[-1]['type'], 'response.completed')
        self.assertEqual([e['sequence_number'] for e in events], list(range(len(events))))
        self.assertEqual(events[-1]['response']['output'][0]['result'], 'aW1hZ2U=')
        self.assertEqual(len(calls()), self.before + 1)

    def test_chat_stream_and_gemini_stream_have_final_images(self):
        code, text = req('/v1/chat/completions', self.chat(stream=True))
        self.assertEqual(code, 200)
        self.assertIn('chat.completion.chunk', text)
        self.assertIn('https://example.invalid/test.png', text)
        self.assertTrue(text.endswith('data: [DONE]\n\n'))
        code, text = req('/v1beta/models/gpt-image-2:streamGenerateContent', {'contents': [{'parts': [{'text': 'test'}]}]})
        self.assertEqual(code, 200)
        self.assertIn('inlineData', text)
        self.assertEqual(len(calls()), self.before + 2)

    def test_stream_failure_emits_failed_never_completed(self):
        with patch.object(i, 'image_request', side_effect=i.HTTPException(503, detail={'error': 'upstream unavailable'})):
            code, text = req('/v1/responses', {'model': adapter.MODEL, 'input': 'test', 'stream': True})
        self.assertEqual(code, 200)
        self.assertIn('response.failed', text)
        self.assertNotIn('response.completed', text)

    def test_task_endpoint_rejects_wrong_methods_and_not_found(self):
        self.assertEqual(req('/v1/images/tasks', method='GET')[0], 405)
        self.assertEqual(req('/v1/images/tasks/imgtask_' + 'a' * 32, method='GET')[0], 404)
        self.assertEqual(req('/v1/images/tasks/bad', method='GET')[0], 404)
        self.assertEqual(len(calls()), self.before)

    def test_engine_marker_keeps_customer_keys_out_of_direct_engine(self):
        code, _ = req('/v1/chat/completions', self.chat(), engine=True, forbid_body=True)
        self.assertEqual(code, 401)
        self.assertEqual(len(calls()), self.before)


if __name__ == '__main__':
    try:
        unittest.main(verbosity=2)
    finally:
        fixture.server.shutdown()
        fixture.temporary_state.cleanup()
