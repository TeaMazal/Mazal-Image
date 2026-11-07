import json,os,tempfile,unittest,sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend/engine'))
from services import image_protection_service as protection

class ImageProtectionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.env=patch.dict(os.environ,{'MI_DATA_DIR':self.temp.name,'MI_MEDIA_PROTECTION':'1'});self.env.start()
    def tearDown(self):self.env.stop();self.temp.cleanup()
    def test_existing_images_default_to_protected(self):
        self.assertTrue(protection.status('2026/old.png')['protected'])
        self.assertFalse(protection.set_protected('2026/old.png',False)['protected'])
        self.assertTrue(protection.set_protected('2026/old.png',True)['protected'])
    def test_task_reference_wins_over_manual_release(self):
        (self.root/'image_tasks.json').write_text(json.dumps({'tasks':[{'data':[{'url':'https://img.example.invalid/images/2026/used.png'}]}]}))
        result=protection.set_protected('2026/used.png',False)
        self.assertTrue(result['protected']);self.assertEqual(result['protection_reason'],'task_reference')
    def test_corrupt_reference_data_fails_closed(self):
        protection.set_protected('2026/used.png',False)
        (self.root/'image_tasks.json').write_text('{')
        self.assertTrue(protection.status('2026/used.png')['protected'])
        with self.assertRaises(ValueError):protection.set_protected('2026/used.png',False)
    def test_path_traversal_rejected(self):
        for value in ['../config.json','/etc/passwd','a/../../b','C:/credentials','a//b']:
            with self.assertRaises(ValueError):protection.status(value)
    def test_independent_maintenance_preserves_protected_media(self):
        import maintenance
        state=self.root/'data';state.mkdir()
        images=state/'images';images.mkdir()
        (images/'old.png').write_bytes(b'protected')
        with patch.object(maintenance,'ROOT',self.root):
            self.assertNotIn(images/'old.png',maintenance.media_files())
            (state/'drawing-media-protection.json').write_text('{"unprotected":["old.png"]}')
            self.assertIn(images/'old.png',maintenance.media_files())

if __name__=='__main__':unittest.main()
