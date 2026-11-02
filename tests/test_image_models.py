"""Model selection, explicit Codex requests and failed-result accounting."""
import asyncio
import base64
from io import BytesIO
import os
import unittest
from unittest.mock import Mock, patch

from PIL import Image
import test_gateway_integration as fixture
from image_models import enabled_image_models, customer_image_models
import image_protocols as protocols
from services import codex_images
from services.protocol.conversation import ImageGenerationError
from services.protocol import openai_v1_image_generations as generations, openai_v1_image_edit as edits

MODEL = 'gpt-image-2.5-flare'
ALL = 'gpt-image-2,' + MODEL + ',gpt-image-2.5-sunburst'
buffer = BytesIO()
Image.new('RGB', (2, 2), 'blue').save(buffer, format='PNG')
PNG = base64.b64encode(buffer.getvalue()).decode()


class ModelAvailabilityTests(unittest.TestCase):
    def test_defaults_and_customer_permissions_intersect(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(enabled_image_models(), ('gpt-image-2',))
            self.assertEqual(customer_image_models({'data': [{'id': MODEL}]}), [])
        with patch.dict(os.environ, MI_ENABLED_IMAGE_MODELS=ALL + ',bogus'):
            self.assertEqual(customer_image_models({'data': [{'id': MODEL}, {'id': 'chat-model'}]}), [MODEL])

    def test_disabled_model_rejected_before_pool_access(self):
        with patch.dict(os.environ, MI_ENABLED_IMAGE_MODELS='gpt-image-2'), patch.object(codex_images.account_service, 'get_available_access_token') as select:
            with self.assertRaises(ImageGenerationError):
                generations.handle({'model': MODEL, 'prompt': 'a circle'})
            select.assert_not_called()

    def test_internal_conversation_cannot_route_25_to_web_image_2(self):
        from services.protocol.conversation import ConversationRequest, stream_image_outputs_with_pool
        with patch.object(codex_images.account_service, 'get_available_access_token') as select:
            with self.assertRaises(ImageGenerationError):
                list(stream_image_outputs_with_pool(ConversationRequest(model=MODEL, prompt='circle')))
            select.assert_not_called()

    def test_public_native_requests_do_not_forward_unreleased_models(self):
        before = len([v for v in fixture.SEEN if v[0].startswith('/v1/images/')])
        with patch.dict(os.environ, MI_ENABLED_IMAGE_MODELS='gpt-image-2'):
            status, _ = asyncio.run(fixture.request('/v1/images/generations', fixture.CUSTOMER, 'POST', {'model': MODEL, 'prompt': 'circle'}))
        self.assertEqual(status, 400)
        self.assertEqual(len([v for v in fixture.SEEN if v[0].startswith('/v1/images/')]), before)

    def test_all_public_protocols_keep_model_and_reject_conflicts(self):
        with patch.dict(os.environ, MI_ENABLED_IMAGE_MODELS=ALL):
            body = {'model': MODEL, 'input': 'circle', 'tools': [{'type': 'image_generation', 'model': MODEL}]}
            self.assertEqual(protocols.parse_request(body, 'responses')['model'], MODEL)
            body['tools'][0]['model'] = 'gpt-image-2'
            with self.assertRaises(protocols.HTTPException):
                protocols.parse_request(body, 'responses')
            gemini = {'contents': [{'role': 'user', 'parts': [{'text': 'circle'}]}]}
            self.assertEqual(protocols.parse_request(gemini, 'gemini', MODEL)['model'], MODEL)
            with self.assertRaises(protocols.HTTPException):
                protocols.parse_request({**gemini, 'model': 'gpt-image-2'}, 'gemini', MODEL)
        task = {'id': 'imgtask_' + 'a' * 32, 'model': MODEL, 'created_ts': 1, 'status': 'success', 'data': [{'b64_json': PNG}]}
        self.assertEqual(protocols.public_task(task)['model'], MODEL)
        self.assertEqual(protocols.responses_result(task)['model'], MODEL)
        self.assertEqual(protocols.chat_result(task)['model'], MODEL)
        self.assertEqual(protocols.gemini_result(task)['modelVersion'], MODEL)


class CodexImagesTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, MI_ENABLED_IMAGE_MODELS=ALL)
        self.env.start()
        self.account = patch.object(codex_images, 'account_service', Mock())
        self.pool = self.account.start()
        self.pool.get_available_access_token.return_value = 'fake-oauth'
        self.pool.get_account.return_value = {'source_type': 'codex', 'type': 'Free'}
        self.pool._decode_jwt_payload.return_value = {'https://api.openai.com/auth': {'chatgpt_account_id': 'fake-id'}}
        self.session_patch = patch.object(codex_images.requests, 'Session')
        self.session = self.session_patch.start().return_value.__enter__.return_value
        self.session.post.return_value.status_code = 200
        self.session.post.return_value.json.return_value = {'model': MODEL, 'data': [{'b64_json': PNG}], 'usage': {'input_tokens': 7, 'output_tokens': 9}}
        self.proxy_patch = patch.object(codex_images.proxy_settings, 'build_session_kwargs', return_value={})
        self.proxy_patch.start()
        self.storage_patch = patch('services.protocol.conversation.format_image_result', side_effect=lambda items, *args: {'created': 1, 'data': items})
        self.storage_patch.start()
        self.addCleanup(patch.stopall)

    def body(self, **extra):
        return {'model': MODEL, 'prompt': 'circle', 'size': '1024x1024', 'quality': 'low', **extra}

    def test_generation_uses_codex_pool_including_free_without_renaming(self):
        result = generations.handle(self.body())
        args, kw = self.session.post.call_args
        self.assertTrue(args[0].endswith('/codex/images/generations'))
        self.assertEqual(kw['json']['model'], MODEL)
        self.assertEqual(kw['json']['n'], 1)
        self.assertFalse(kw['allow_redirects'])
        self.pool.get_available_access_token.assert_called_once_with(plan_type=None, source_type='codex')
        self.pool.mark_image_result.assert_called_once_with('fake-oauth', True)
        self.assertEqual(result['usage'], {'input_tokens': 7, 'output_tokens': 9})

    def test_edit_sends_multiple_references_and_original_mask(self):
        upload = (buffer.getvalue(), 'reference.png', 'image/png')
        edits.handle(self.body(images=[upload, upload], mask=[upload]))
        args, kw = self.session.post.call_args
        self.assertTrue(args[0].endswith('/codex/images/edits'))
        self.assertEqual(len(kw['json']['images']), 2)
        self.assertEqual(kw['json']['mask']['image_url'], 'data:image/png;base64,' + PNG)

    def test_upstream_rejections_never_retry_or_change_model(self):
        for status in (400, 401, 403, 404, 429, 500):
            self.session.post.reset_mock()
            self.pool.mark_image_result.reset_mock()
            self.session.post.return_value.status_code = status
            with self.assertRaises(ImageGenerationError):
                generations.handle(self.body())
            self.session.post.assert_called_once()
            self.pool.mark_image_result.assert_called_once_with('fake-oauth', False)

    def test_invalid_results_never_count_as_success(self):
        cases = [[], [{'b64_json': 'not-base64'}], [{'b64_json': base64.b64encode(b'\x89PNG\r\n\x1a\n').decode()}], [{'b64_json': PNG, 'model': 'gpt-image-2'}]]
        for data in cases:
            self.pool.mark_image_result.reset_mock()
            self.session.post.return_value.json.return_value = {'data': data}
            with self.assertRaises(ImageGenerationError):
                generations.handle(self.body())
            self.pool.mark_image_result.assert_called_once_with('fake-oauth', False)

    def test_setup_exception_releases_selected_slot(self):
        self.pool._decode_jwt_payload.side_effect = ValueError('malformed token')
        with self.assertRaises(ValueError):
            generations.handle(self.body())
        self.pool.mark_image_result.assert_called_once_with('fake-oauth', False)
        self.session.post.assert_not_called()

    def test_timeout_is_one_submission_with_no_fallback(self):
        self.session.post.side_effect = codex_images.requests.RequestsError('timeout')
        with self.assertRaises(ImageGenerationError):
            generations.handle(self.body())
        self.session.post.assert_called_once()
        self.pool.mark_image_result.assert_called_once_with('fake-oauth', False)

    def test_multi_image_partial_completion_keeps_outputs_and_usage(self):
        ok = {'created': 1, 'data': [{'b64_json': PNG}], 'usage': {'output_tokens': 9}}
        with patch.object(codex_images, '_single', side_effect=[ok, ImageGenerationError('rejected')]) as submit:
            result = codex_images.handle(self.body(n=2))
        self.assertEqual(submit.call_count, 2)
        self.assertEqual(len(result['data']), 1)
        self.assertEqual(result['partial_error']['failed_count'], 1)
        self.assertEqual(result['usage'], {'output_tokens': 9})


if __name__ == '__main__':
    unittest.main()
