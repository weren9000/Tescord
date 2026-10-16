from app.services.emoji_catalog import ALLOWED

ALIASES = dict(zip(
    ['❤️', '👍', '👎', '😡', '😢', '😕', '😒', '😂', '🔥', '😮'],
    ['heart', 'like', 'dislike', 'angry', 'cry', 'confused', 'displeased', 'laugh', 'fire', 'wow'],
))
LEGACY = list(ALIASES.values()) + ['praying_cat']

def normalize_reaction(code: str) -> str:
    if code not in ALLOWED and code not in LEGACY:
        raise ValueError('Unknown reaction')
    return ALIASES.get(code, code)

def ordered_codes(counts):
    return [code for code in LEGACY if code in counts] + sorted(set(counts) - set(LEGACY))
