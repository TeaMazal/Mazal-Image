"""Unified account ownership must preserve user routing and disable the old pool."""
import asyncio
import os
from unittest.mock import Mock, patch
import unittest

import test_gateway_integration as fixture
from services.account_service import AccountService
from api import app as app_module


class RemoteAccountsTests(unittest.TestCase):
    def test_admin_pages_redirect_and_old_management_cannot_mutate(self):
        with patch.object(fixture.integration, 'REMOTE_ACCOUNT_MANAGEMENT', True):
            for path in ('/accounts/', '/proxies/'):
                status, _, headers = asyncio.run(fixture.request(path, return_headers=True))
                self.assertEqual(status, 307)
                self.assertTrue(headers[b'location'].startswith(b'https://main.example.test/admin/'))
            for path in ('/api/accounts', '/api/accounts/oauth/finish', '/api/cpa/pools',
                         '/api/sub2api/servers', '/api/proxy/pool'):
                status, _ = asyncio.run(fixture.request(path, 'integration-test-admin-key',
                    'POST', {'access_token': 'never-import'}, forbid_body=True))
                self.assertEqual(status, 410)

    def test_local_key_cannot_generate_but_user_key_still_uses_gateway(self):
        with patch.object(fixture.integration, 'REMOTE_ACCOUNT_MANAGEMENT', True):
            for path in ('/v1/images/generations', '/v1/images/edits',
                         '/api/image-tasks/generations', '/api/image-tasks/edits'):
                status, _ = asyncio.run(fixture.request(path, 'integration-test-admin-key',
                    'POST', {'prompt': 'must not generate'}, forbid_body=True))
                self.assertEqual(status, 403)
            status, result = asyncio.run(fixture.request('/v1/images/generations',
                fixture.CUSTOMER, 'POST', {'model': 'gpt-image-2', 'prompt': 'gateway only'}))
            self.assertEqual(status, 200)
            self.assertEqual(len(result['data']), 1)
            status, session = asyncio.run(fixture.request('/api/workbench/session', fixture.CUSTOMER))
            self.assertEqual(status, 200)
            self.assertEqual(session['role'], 'user')
            self.assertIn('gpt-image-2', session['models'])

    def test_no_local_account_loading_or_writing(self):
        service = AccountService.__new__(AccountService)
        service.storage = Mock()
        with patch.dict(os.environ, MI_REMOTE_ACCOUNT_MANAGEMENT='1'):
            self.assertEqual(service._load_accounts(), {})
            with self.assertRaisesRegex(RuntimeError, 'managed by the main gateway'):
                service._save_accounts()
        service.storage.load_accounts.assert_not_called()
        service.storage.save_accounts.assert_not_called()

    def test_remote_lifespan_keeps_image_cleanup_without_account_workers(self):
        async def exercise():
            application = app_module.create_app()
            async with application.router.lifespan_context(application):
                pass
        with patch.dict(os.environ, MI_REMOTE_ACCOUNT_MANAGEMENT='1'), \
             patch.object(app_module, 'start_limited_account_watcher') as watcher, \
             patch.object(app_module.account_service, 'activate_proxy_pool') as activate, \
             patch.object(app_module.proxy_pool_store, 'start_health_loop') as pool, \
             patch.object(app_module.proxy_subscriptions, 'start_loop') as subscription, \
             patch.object(app_module, 'start_image_cleanup_scheduler') as cleanup, \
             patch.object(app_module.backup_service, 'start'), \
             patch.object(app_module.backup_service, 'stop'), \
             patch.object(app_module.config, 'cleanup_old_images'):
            asyncio.run(exercise())
            watcher.assert_not_called()
            activate.assert_not_called()
            pool.assert_not_called()
            subscription.assert_not_called()
            cleanup.assert_called_once()
            cleanup.return_value.join.assert_called_once()


if __name__ == '__main__':
    unittest.main()
