"""Integration regressions for the five upstream PRs and existing site policies."""
import asyncio
import base64
from io import BytesIO
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

from PIL import Image
import test_gateway_integration as fixture
from services import proxy_service, proxy_pool_service, image_storage_service
from services.config import config
from services.protocol import conversation, openai_v1_image_generations as generations


class Chat2UpdateTests(unittest.TestCase):
    def test_admin_prefetch_prefers_current_nested_export_over_stale_dotted_file(self):
        from api import support
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            nested = root / 'settings/__next.settings/__PAGE__.txt'
            nested.parent.mkdir(parents=True)
            nested.write_text('current-webpack-payload')
            stale = root / 'settings/__next.settings.__PAGE__.txt'
            stale.write_text('old-turbopack-payload')
            with patch.object(support, 'WEB_DIST_DIR', root):
                self.assertEqual(support.resolve_web_asset('settings/__next.settings.__PAGE__.txt'), nested)
                nested.unlink()
                self.assertEqual(support.resolve_web_asset('settings/__next.settings.__PAGE__.txt'), stale)
                self.assertIsNone(support.resolve_web_asset('../../outside.txt'))

    def test_disabled_pool_preserves_account_global_and_runtime_proxies(self):
        cfg = Mock()
        cfg.get_proxy_settings.return_value = 'http://global.test:8080'
        cfg.get_proxy_runtime_settings.return_value = {'enabled': False}
        store = proxy_service.ProxySettingsStore(cfg)
        with patch.object(proxy_pool_service.proxy_pool, 'is_enabled', return_value=False):
            self.assertEqual(store.get_profile(account={'proxy': 'socks5://own.test:1080'}).proxy_url, 'socks5h://own.test:1080')
            self.assertEqual(store.get_profile().proxy_url, 'http://global.test:8080')

    def test_enabled_empty_pool_never_falls_back_to_global_or_direct(self):
        with patch.object(proxy_pool_service.proxy_pool, 'is_enabled', return_value=True), patch.object(
                proxy_pool_service.proxy_pool, 'route_anonymous', return_value=(None, 'empty')):
            with self.assertRaisesRegex(RuntimeError, 'no available egress'):
                proxy_service.proxy_settings.get_profile()

    def test_web_25_route_keeps_explicit_model_and_never_calls_direct_adapter(self):
        model = 'gpt-image-2.5-sunburst'
        output = conversation.ImageOutput(kind='result', model=model, index=1, total=1, data=[])
        with patch.dict(os.environ, MI_IMAGE25_ROUTE='web', MI_ENABLED_IMAGE_MODELS=model), patch.object(
                conversation, '_generate_single_image', return_value=[output]) as submit, patch(
                'services.codex_images.handle') as direct, patch.object(generations, 'count_text_tokens', return_value=1):
            generations.handle({'model': model, 'prompt': 'circle'})
        self.assertEqual(submit.call_args.args[0].model, model)
        direct.assert_not_called()

    def test_alias_and_mapping_cannot_bypass_unreleased_model_gate(self):
        with patch.dict(os.environ, MI_ENABLED_IMAGE_MODELS='gpt-image-2'), patch.object(
                conversation, '_generate_single_image') as submit:
            for model in ('gpt-image-2.5', 'codex-gpt-image-2.5', 'plus-codex-gpt-image-2.5'):
                with self.assertRaises(conversation.ImageGenerationError):
                    generations.handle({'model': model, 'prompt': 'circle'})
            with patch.dict(config.data, {'image_model_mapping': {'gpt-image-2': 'gpt-image-2.5-flare'}}):
                with self.assertRaises(conversation.ImageGenerationError):
                    list(conversation.stream_image_outputs_with_pool(conversation.ConversationRequest(model='gpt-image-2')))
            submit.assert_not_called()

    def test_gif_customer_calls_are_rejected_without_upstream_submission(self):
        before = list(fixture.SEEN)
        for path in ('/v1/images/generations/gif', '/v1/images/edits/gif'):
            for token, expected in (('', 401), (fixture.CUSTOMER, 403)):
                status, _ = asyncio.run(fixture.request(path, token, 'POST', {'prompt': 'animate'}))
                self.assertEqual(status, expected)
        self.assertEqual(fixture.SEEN, before)

    def test_proxy_pool_administration_rejects_customer_identity(self):
        status, _ = asyncio.run(fixture.request('/api/proxy/pool', fixture.CUSTOMER))
        self.assertEqual(status, 403)

    def test_gif_bytes_frames_and_metadata_survive_storage(self):
        buf = BytesIO()
        Image.new('RGB', (8, 8), 'red').save(buf, format='GIF', save_all=True,
            append_images=[Image.new('RGB', (8, 8), 'blue')], duration=100, loop=0)
        raw = buf.getvalue()
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            settings = Mock(images_dir=directory)
            settings.get_image_storage_settings.return_value = {'mode': 'local', 'enabled': False}
            storage = image_storage_service.ImageStorageService(directory/'index.json')
            with patch.object(image_storage_service, 'config', settings), patch.object(storage, 'mode', return_value='local'):
                saved = storage.save(raw, 'https://img.example.test')
                self.assertTrue(saved.rel.endswith('.gif'))
                self.assertEqual(storage.get_bytes(saved.rel), raw)
                with Image.open(BytesIO(storage.get_bytes(saved.rel))) as image:
                    self.assertEqual(image.n_frames, 2)
            with patch.object(conversation, 'save_image_bytes', return_value=saved.url):
                result = conversation.format_image_result([{'b64_json': base64.b64encode(raw).decode()}], 'animate', 'b64_json')
            self.assertEqual(result['data'][0]['mime_type'], 'image/gif')
            self.assertTrue(result['data'][0]['animated'])


if __name__ == '__main__':
    unittest.main()
