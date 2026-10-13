from pathlib import Path
from secrets import choice

AVATAR_PRESETS = (
    'frog', 'cat', 'dog', 'fox', 'bear', 'wolf', 'panda', 'rabbit', 'raccoon', 'owl',
    'tiger', 'penguin', 'bat', 'koala', 'elephant', 'deer', 'capybara', 'monkey', 'hedgehog', 'otter',
)
AVATAR_DIRECTORY = Path(__file__).resolve().parents[1] / 'assets' / 'avatars'


def random_avatar_preset() -> str:
    return choice(AVATAR_PRESETS)
