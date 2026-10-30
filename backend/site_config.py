"""站点公开配置与可信来源，启动时校验以避免回退到其他站点。"""
import os
from urllib.parse import urlsplit


def origin(value, name):
    parsed = urlsplit(value.strip())
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username or parsed.password or parsed.path not in ('', '/') or
            parsed.query or parsed.fragment or any(c.isspace() for c in value)):
        raise ValueError(name + ' must be an absolute http(s) origin without path or credentials')
    parsed.port  # 校验非法端口。
    return parsed.scheme.lower() + '://' + parsed.netloc.lower()


SITE_NAME = os.environ.get('MI_SITE_NAME', 'Mazal Image').strip()
if not SITE_NAME or len(SITE_NAME) > 80:
    raise ValueError('MI_SITE_NAME must contain 1 to 80 characters')
MAIN_ORIGIN = origin(os.environ.get('MI_MAIN_ORIGIN', ''), 'MI_MAIN_ORIGIN')
IMAGE_ORIGIN = origin(os.environ.get('MI_PUBLIC_ORIGIN', ''), 'MI_PUBLIC_ORIGIN')
GATEWAY = os.environ.get('MI_GATEWAY_URL', '').rstrip('/')
parsed_gateway = urlsplit(GATEWAY)
if (parsed_gateway.scheme not in ('http', 'https') or not parsed_gateway.hostname or
        parsed_gateway.username or parsed_gateway.password or parsed_gateway.query or
        parsed_gateway.fragment or any(c.isspace() for c in GATEWAY)):
    raise ValueError('MI_GATEWAY_URL must be an absolute http(s) URL without credentials')
parsed_gateway.port
