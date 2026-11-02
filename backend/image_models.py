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
