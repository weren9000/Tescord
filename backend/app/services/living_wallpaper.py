"""Original KVA marsh illustration. Raster poster is used by older clients."""
import random

CATALOG_ID = 'wallpaper-living-marsh'


def marsh_svg(motion=False):
    rng = random.Random(7341)
    stars = ''.join(f'<circle cx="{rng.randrange(1400)}" cy="{rng.randrange(340)}" r="{rng.choice([.6,.8,1.2])}" fill="#b5e9dd" opacity="{rng.uniform(.12,.5):.2f}"/>' for _ in range(65))
    reeds = ''
    for side in [0, 1]:
        for i in range(32):
            x = rng.randrange(0,260) if side == 0 else rng.randrange(1140,1400)
            y = rng.randrange(690,850);height=rng.randrange(60,240);lean=rng.randrange(-55,55)
            reeds += f'<path d="M{x} {y} Q{x+lean} {y-height*.6} {x+lean} {y-height}" stroke="{rng.choice(["#153d3c","#123331","#204a43"])}" stroke-width="{rng.choice([2,3,4])}" fill="none"/>'
            if i%3==0:reeds += f'<path d="M{x+lean} {y-height} v-24" stroke="#456348" stroke-width="6" stroke-linecap="round"/>'
    pads=''
    for x,y,scale in [(180,590,1),(1060,610,.8),(1120,730,1.2),(285,755,1.1),(430,650,.5),(905,540,.45),(95,700,.7)]:
        pads+=f'<g transform="translate({x} {y}) scale({scale})"><ellipse cy="6" rx="62" ry="17" fill="#061b26" opacity=".7"/><path d="M0 0 L43 -17 A60 22 0 1 0 55 -8 Z" fill="url(#leaf)" stroke="#41816e" stroke-opacity=".4"/><path d="M-40 3 Q-10 -11 20 -6" stroke="#6da58c" stroke-opacity=".3" fill="none"/></g>'
    flies=''
    for i in range(23):
        x=rng.randrange(90,1320);y=rng.randrange(320,730)
        flies+=f'<g class="fly" style="animation-delay:-{i*1.7}s;animation-duration:{8+i%5}s"><circle cx="{x}" cy="{y}" r="11" fill="url(#glow)"/><circle cx="{x}" cy="{y}" r="1.6" fill="#e6ffc1"/></g>'
    ripples=''.join(f'<ellipse class="ripple" cx="{x}" cy="{y}" rx="{r}" ry="{r*.21}" style="animation-delay:-{i*3}s" fill="none" stroke="#83d9c2" stroke-width="1" opacity=".16"/>' for i,(x,y,r) in enumerate([(310,510,60),(850,620,85),(620,740,95),(1090,470,45)]))
    css='''
      .fly{animation:drift 10s ease-in-out infinite alternate}
      .mist{animation:mist 36s ease-in-out infinite alternate}
      .ripple{transform-box:fill-box;transform-origin:center;animation:ripple 12s ease-out infinite}
      @keyframes drift{0%{transform:translate(0,0);opacity:.25}50%{opacity:.95}100%{transform:translate(14px,-18px);opacity:.4}}
      @keyframes mist{from{transform:translateX(-35px);opacity:.22}to{transform:translateX(35px);opacity:.45}}
      @keyframes ripple{0%{transform:scale(.65);opacity:0}25%{opacity:.2}100%{transform:scale(1.65);opacity:0}}
      @media(prefers-reduced-motion:reduce){*{animation:none!important}}
    ''' if motion else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="840" viewBox="0 0 1400 840">
    <defs>
      <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#080f22"/><stop offset=".52" stop-color="#112d36"/><stop offset="1" stop-color="#09242b"/></linearGradient>
      <linearGradient id="water" x2=".2" y2="1"><stop stop-color="#1a4148"/><stop offset=".35" stop-color="#103039"/><stop offset="1" stop-color="#081d28"/></linearGradient>
      <radialGradient id="moon"><stop stop-color="#c1e6ca" stop-opacity=".15"/><stop offset="1" stop-color="#93dcca" stop-opacity="0"/></radialGradient>
      <radialGradient id="glow"><stop stop-color="#cdff9a" stop-opacity=".5"/><stop offset="1" stop-color="#bfff8f" stop-opacity="0"/></radialGradient>
      <radialGradient id="fog"><stop stop-color="#82bcb3" stop-opacity=".18"/><stop offset="1" stop-color="#82bcb3" stop-opacity="0"/></radialGradient>
      <linearGradient id="leaf" x2="0" y2="1"><stop stop-color="#357465"/><stop offset="1" stop-color="#173f3e"/></linearGradient>
      <linearGradient id="shade"><stop stop-color="#060f20" stop-opacity=".5"/><stop offset=".5" stop-color="#060f20" stop-opacity="0"/><stop offset="1" stop-color="#060f20" stop-opacity=".5"/></linearGradient>
    </defs><style>{css}</style>
    <path fill="url(#sky)" d="M0 0h1400v840H0z"/>{stars}
    <circle cx="1050" cy="155" r="210" fill="url(#moon)"/><circle cx="1050" cy="155" r="28" fill="#c0d9c8" opacity=".68"/><circle cx="1062" cy="145" r="27" fill="#101e2b"/>
    <path d="M0 350Q150 300 280 345T540 335T810 345T1090 320T1400 345V460H0Z" fill="#0b222d"/>
    <path d="M0 380Q200 345 370 388T700 378T1000 390T1400 365V840H0Z" fill="url(#water)"/>
    <g stroke="#88c4b6" opacity=".09" fill="none"><path d="M850 410h210m-140 18h180m-210 20h250m-290 27h300m-310 30h360m-400 33h400"/><path d="M130 550h180m290 30h100m-230 120h270m-520 80h160"/></g>
    <g class="mist"><ellipse cx="400" cy="415" rx="600" ry="85" fill="url(#fog)"/><ellipse cx="1070" cy="460" rx="480" ry="75" fill="url(#fog)"/></g>
    {ripples}{pads}
    <g transform="translate(1130 714)"><path d="M0 0Q-32 -4 -19 -26Q-2 -20 0 0Q-13 -25 0 -38Q15 -24 0 0Q3 -22 21 -25Q33 -3 0 0Z" fill="#b0c6b4" opacity=".8"/><ellipse rx="5" ry="3" fill="#e4d58e"/></g>
    {reeds}{flies}<path fill="url(#shade)" d="M0 0h1400v840H0z"/>
    </svg>'''
