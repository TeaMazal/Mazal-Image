"""Explicit Codex Images calls with pool credentials, without replay or model fallback."""
from __future__ import annotations

import base64
import binascii
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from typing import Any

from curl_cffi import requests
from PIL import Image

from services.account_service import account_service
from services.proxy_service import proxy_settings
from utils.helper import DIRECT_IMAGE_MODELS, split_image_model


def _single(body: dict[str, Any]) -> dict[str, Any]:
    from services.protocol.conversation import ImageGenerationError, format_image_result

    plan, model = split_image_model(body.get('model'))
    if model not in DIRECT_IMAGE_MODELS:
        raise ImageGenerationError('Unsupported Codex image model', status_code=400)
    try:
        token = account_service.get_available_access_token(plan_type=plan, source_type='codex')
    except RuntimeError:
        raise ImageGenerationError('没有可用的 Codex 绘图账号，请联系管理员。', status_code=503) from None
    success = False
    try:
        account = account_service.get_account(token) or {}
        claims = account_service._decode_jwt_payload(token)
        auth = claims.get('https://api.openai.com/auth') or {}
        headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                   'Accept': 'application/json', 'User-Agent': 'codex_cli_rs/0.155.0',
                   'Originator': 'codex_cli_rs'}
        account_id = auth.get('chatgpt_account_id') if isinstance(auth, dict) else None
        if account_id:
            headers['Chatgpt-Account-Id'] = str(account_id)
        payload: dict[str, Any] = {'model': model, 'prompt': body['prompt'], 'n': 1,
                                   'quality': body.get('quality') or 'auto', 'output_format': 'png'}
        if body.get('size'):
            payload['size'] = body['size']
        endpoint = 'generations'
        if body.get('images'):
            endpoint = 'edits'
            payload['images'] = [{'image_url': 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')}
                                 for data, _, mime in body['images']]
            masks = body.get('mask') or []
            if masks:
                if len(masks) != 1:
                    raise ImageGenerationError('此图片接口每次编辑只支持一个遮罩。', status_code=400)
                data, _, mime = masks[0]
                payload['mask'] = {'image_url': 'data:' + mime + ';base64,' + base64.b64encode(data).decode('ascii')}
        with requests.Session(**proxy_settings.build_session_kwargs(account=account, impersonate='chrome', verify=True)) as session:
            response = session.post('https://chatgpt.com/backend-api/codex/images/' + endpoint,
                                    headers=headers, json=payload, timeout=600, allow_redirects=False)
        if response.status_code != 200:
            status = response.status_code if response.status_code in (400, 401, 403, 404, 429) else 502
            messages = {400: '上游未接受此图片模型或参数。', 401: '绘图账号授权已失效，请联系管理员。',
                        403: '当前账号没有获得此图片接口的访问权限，请联系管理员。',
                        404: '当前账号的图片接口不可用，请联系管理员。', 429: '绘图账号额度不足或暂时繁忙，请稍后重试。'}
            raise ImageGenerationError(messages.get(status, '图片上游请求失败，请核对原任务后重试。'),
                                       status_code=status, code='codex_images_rejected')
        try:
            raw = response.json()
        except ValueError as exc:
            raise ImageGenerationError('图片上游返回了无法解析的结果，请勿自动重试。') from exc
        items = raw.get('data') if isinstance(raw, dict) else None
        if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
            raise ImageGenerationError('图片上游未返回预期数量的图片，请核对用量后重试。')
        item = items[0]
        reported = item.get('model') or raw.get('model')
        if reported and reported != model:
            raise ImageGenerationError('上游报告的图片模型与请求不一致，请联系管理员。')
        try:
            image = base64.b64decode(item.get('b64_json') or '', validate=True)
        except (binascii.Error, ValueError, TypeError) as exc:
            raise ImageGenerationError('图片上游返回了无效图片，请核对用量后重试。') from exc
        if not image.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ImageGenerationError('图片上游没有返回请求的 PNG 图片，请核对用量后重试。')
        try:
            with Image.open(BytesIO(image)) as picture:
                picture.verify()
        except Exception as exc:
            raise ImageGenerationError('图片上游返回了损坏的图片，请核对用量后重试。') from exc
        result = format_image_result(items, body['prompt'], body.get('response_format') or 'b64_json', body.get('base_url'))
        result['model'] = body['model']
        if reported:
            result['upstream_model'] = reported
        if isinstance(raw.get('usage'), dict):
            result['usage'] = raw['usage']
        success = True
        return result
    except requests.RequestsError:
        raise ImageGenerationError('图片上游连接中断，结果尚未确认，请核对用量；系统不会自动重复生成。') from None
    finally:
        account_service.mark_image_result(token, success)


def handle(body: dict[str, Any]):
    from image_models import enabled_image_models
    from services.protocol.conversation import ImageOutput, ImageGenerationError

    if body.get('model') not in enabled_image_models():
        raise ImageGenerationError('此图片模型尚未开放，请选择当前可用模型。', status_code=400)

    count = int(body.get('n') or 1)
    if body.get('stream'):
        def chunks():
            with ThreadPoolExecutor(max_workers=count) as pool:
                futures = {pool.submit(_single, body): index for index in range(count)}
                for future in as_completed(futures):
                    result = future.result()
                    chunk = ImageOutput(kind='result', model=body['model'], index=futures[future] + 1, total=count, data=result['data']).to_chunk()
                    if 'usage' in result:
                        chunk['usage'] = result['usage']
                    yield chunk
        return chunks()
    if count == 1:
        return _single(body)
    # 每个任务只提交一张；部分失败不重放已经完成的任务。
    with ThreadPoolExecutor(max_workers=count) as pool:
        futures = [pool.submit(_single, body) for _ in range(count)]
        results = []
        errors = []
        for future in futures:
            try:
                results.append(future.result())
            except Exception as exc:
                errors.append(exc)
    if not results:
        raise errors[0]
    merged = {'created': results[0]['created'], 'model': body['model'],
              'data': [item for result in results for item in result['data']]}
    if errors:
        merged['partial_error'] = {'message': '部分图片生成失败；已完成图片已保留。', 'failed_count': len(errors)}
    # 只合计上游明确报告的计数，不使用其他图片模型的估算值。
    if all(isinstance(r.get('usage'), dict) for r in results):
        usage = {}
        for name in ('input_tokens', 'output_tokens', 'total_tokens'):
            values = [r['usage'].get(name) for r in results]
            if all(type(v) is int and v >= 0 for v in values):
                usage[name] = sum(values)
        if usage:
            merged['usage'] = usage
    return merged
