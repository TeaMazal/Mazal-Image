"""Models implemented by the workbench; exposure requires an explicit release decision."""
import os

IMAGE_MODEL_NAMES = {
    'gpt-image-2': 'GPT Image 2',
    'gpt-image-2.5-flare': 'GPT Image 2.5 Flare',
    'gpt-image-2.5-sunburst': 'GPT Image 2.5 Sunburst',
}


def enabled_image_models():
    configured = os.environ.get('MI_ENABLED_IMAGE_MODELS', 'gpt-image-2').split(',')
    return tuple(model for model in IMAGE_MODEL_NAMES if model in {v.strip() for v in configured})


def customer_image_models(listing):
    offered = {item.get('id') for item in listing.get('data', []) if isinstance(item, dict)}
    return [model for model in enabled_image_models() if model in offered]


def image25_route():
    """Select one explicit transport; never retry on a different transport."""
    from services.config import config
    route = str(os.environ.get('MI_IMAGE25_ROUTE') or config.data.get('image25_route') or 'codex').strip().lower()
    if route not in ('codex', 'web'):
        raise ValueError('image25_route must be codex or web')
    return route


def validate_engine_image_model(model):
    from services.config import config
    from services.protocol.conversation import ImageGenerationError
    from utils.helper import split_image_model
    _, canonical = split_image_model(model)
    if canonical == 'codex-gpt-image-2.5':
        canonical = config.codex_image_model_25_name
    if canonical in ('gpt-image-2.5-flare', 'gpt-image-2.5-sunburst') and canonical not in enabled_image_models():
        raise ImageGenerationError('此图片模型尚未开放，请选择当前可用模型。', status_code=400)
