"""Curated UI themes. Ownership is enforced by inventory, not asset visibility."""
from html import escape

BASE = dict(canvas='#10121c', primary='#754bff', cyan='#57c8d5', text='#f6f7fb',
    surface='#161925', raised='#1d2130', hover='#262b3d', border='#30364a', subtle='#8289a4',
    muted='#a6aec4', secondary='#d4d8e8', **{'primary-text':'#c4b5fd', 'primary-hover':'#6940eb',
    'selected':'#242039','danger':'#ff718a','danger-surface':'#a63f56','danger-text':'#ffd4dc',
    'warning':'#f2c46d','shadow':'#000000'})


def theme(name, scheme='dark', **colors):
    return {'name':name, 'scheme':scheme, 'palette':{**BASE, **colors}}


THEMES = {
    'theme-light': theme('Светлая', 'light', canvas='#eef2f7', surface='#ffffff', raised='#f7f9fc',
        hover='#e4ebf5', border='#c4cfdf', text='#17243a', subtle='#60728d', muted='#50627c',
        secondary='#344862', primary='#255fce', cyan='#087487', selected='#dbe8ff',
        danger='#bc2446', warning='#865100', **{'primary-text':'#214fa5','primary-hover':'#1b4fae',
        'danger-surface':'#fce3e9','danger-text':'#9d1c3c'}),
    'theme-dark': theme('Тёмная', canvas='#101113', surface='#191b1e', raised='#23262b',
        hover='#30343a', border='#40464f', text='#f1f2f4', muted='#b2b8c1', secondary='#d8dce2',
        primary='#526da8', cyan='#a4bedf', selected='#29364e', **{'primary-text':'#bdd2f5','primary-hover':'#425e96'}),
    'theme-space': theme('Космос', canvas='#090e24', surface='#111a38', raised='#1a244a',
        hover='#293663', border='#394e7e', primary='#7954d9', cyan='#6bd7f5', selected='#302451',
        text='#edf2ff', muted='#afbddb', secondary='#d2def5', **{'primary-text':'#d1bcff','primary-hover':'#6841c2'}),
    'theme-cyberpunk': theme('Киберпанк', canvas='#0b1017', surface='#111d27', raised='#192936',
        hover='#253d4c', border='#345a66', primary='#a32f88', cyan='#54f1e4', selected='#39203d',
        text='#eafcfb', muted='#afc9cc', secondary='#c8e5e6', warning='#ffda65',
        **{'primary-text':'#ff9ee2','primary-hover':'#88246f'}),
    'theme-viking': theme('Викинг', canvas='#141d24', surface='#1c2933', raised='#293945',
        hover='#394c57', border='#51636a', primary='#866033', cyan='#a0d4d8', selected='#3c342b',
        text='#f2eee3', muted='#c1c8c6', secondary='#e0e4db', warning='#f0c077',
        **{'primary-text':'#f1cd91','primary-hover':'#704f29'}),
}


def theme_svg(key):
    theme_data=THEMES[key];p=theme_data['palette']
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220">
    <rect width="320" height="220" rx="22" fill="{p['canvas']}"/>
    <rect x="12" y="12" width="65" height="196" rx="12" fill="{p['surface']}"/>
    <rect x="23" y="27" width="43" height="9" rx="4" fill="{p['primary']}"/>
    <path d="M25 58h36M25 79h25M25 100h31" stroke="{p['muted']}" stroke-width="5" stroke-linecap="round"/>
    <rect x="89" y="12" width="218" height="42" rx="10" fill="{p['raised']}"/>
    <text x="104" y="39" fill="{p['text']}" font-family="Arial,sans-serif" font-size="18">{escape(theme_data['name'])}</text>
    <rect x="89" y="69" width="166" height="43" rx="12" fill="{p['raised']}"/>
    <path d="M105 87h124M105 98h80" stroke="{p['muted']}" stroke-width="4" stroke-linecap="round"/>
    <rect x="139" y="125" width="168" height="43" rx="12" fill="{p['selected']}"/>
    <path d="M155 144h125M155 155h72" stroke="{p['primary-text']}" stroke-width="4" stroke-linecap="round"/>
    <rect x="89" y="185" width="218" height="23" rx="8" fill="{p['surface']}"/>
    <circle cx="293" cy="196" r="6" fill="{p['cyan']}"/></svg>'''
