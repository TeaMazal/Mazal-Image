import asyncio, unittest
from unittest.mock import patch
from test_gateway_integration import integration, request, CUSTOMER
class MetadataTests(unittest.TestCase):
 def test_metadata_reaches_authenticated_task_only(self):
  seen=[]
  def fake(identity,**kwargs):seen.append(dict(identity));return {'id':'metadata-test','status':'queued'}
  with patch.object(integration.image_tasks.image_task_service,'submit_generation',side_effect=fake):
   code,_=asyncio.run(request('/api/image-tasks/generations',CUSTOMER,'POST',{'client_task_id':'metadata-test','prompt':'test','model':'gpt-image-2'},extra_headers=[(b'x-drawing-round-id',b'round-123'),(b'x-drawing-conversation-id',b'chat-123'),(b'x-drawing-round-total',b'2')]))
  self.assertEqual(code,200);self.assertEqual(seen[0]['_drawing_headers']['X-Drawing-Round-Id'],'round-123');self.assertEqual(seen[0]['source'],'sub2api')
 def test_forward_metadata_without_overriding_auth(self):
  class Result:
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def read(self):return b'{}'
  class Opener:
   def open(self,req,timeout):self.req=req;return Result()
  opener=Opener()
  with patch.object(integration.urllib.request,'build_opener',return_value=opener):integration.gateway_request('/v1/images/generations',CUSTOMER,'198.51.100.1',drawing_headers={'X-Drawing-Round-Id':'round','Authorization':'Bearer attacker','X-Real-IP':'attacker'})
  self.assertEqual(opener.req.get_header('Authorization'),'Bearer '+CUSTOMER);self.assertEqual(opener.req.get_header('X-drawing-round-id'),'round');self.assertEqual(opener.req.get_header('X-real-ip'),'198.51.100.1')
if __name__=='__main__':unittest.main()
