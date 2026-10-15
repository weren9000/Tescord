"""Original Nordic landscape, drawn for KVA; no external game assets."""
import random


def valheim_svg(motion=False):
    rng = random.Random(9017)
    stars = ''.join(f'<circle cx="{rng.randrange(1400)}" cy="{rng.randrange(400)}" r="{rng.choice([.6,1,1.4])}" fill="#c9e4ed" opacity="{rng.uniform(.2,.7):.2f}"/>' for _ in range(100))
    trees = ''
    for side in [0, 1]:
        for i in range(23):
            x = rng.randrange(-80, 380) if side == 0 else rng.randrange(1100, 1480)
            y = rng.randrange(590, 860); h = rng.randrange(140, 390)
            trees += f'<g transform="translate({x} {y})"><path d="M-3 0V-{h}h6V0" fill="#081b24"/>'
            for j in range(5):
                top = -h+j*h*.14; w = h*(.13+j*.025)
                trees += f'<path d="M0 {top} L{w} {top+h*.35} L{w*.3} {top+h*.29} L0 {top+h*.36} L{-w*.35} {top+h*.29} L{-w} {top+h*.35}Z" fill="{["#0a222b","#0b2830","#0a1d26"][i%3]}"/>'
            trees += '</g>'
    waves = ''.join(f'<path d="M{x} {y}q{w/2} -3 {w} 0"/>' for x,y,w in [(rng.randrange(300,1100),rng.randrange(535,820),rng.randrange(20,130)) for _ in range(55)])
    css = '''.aurora{animation:veil 19s ease-in-out infinite alternate;transform-origin:700px 180px}.second{animation-delay:-11s;animation-duration:27s}.fog{animation:mist 35s ease-in-out infinite alternate}.boat{animation:rock 8s ease-in-out infinite alternate;transform-origin:830px 570px}.waterlight{animation:shimmer 6s ease-in-out infinite alternate}@keyframes veil{from{transform:translate(-16px,0) skewX(-3deg);opacity:.4}to{transform:translate(18px,12px) skewX(3deg);opacity:.8}}@keyframes mist{from{transform:translateX(-35px);opacity:.4}to{transform:translateX(30px);opacity:.75}}@keyframes rock{from{transform:translateY(0) rotate(-.6deg)}to{transform:translateY(3px) rotate(.6deg)}}@keyframes shimmer{from{opacity:.08}to{opacity:.23}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}''' if motion else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="840" viewBox="0 0 1400 840">
    <defs>
      <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#070e25"/><stop offset=".6" stop-color="#193a49"/><stop offset="1" stop-color="#345862"/></linearGradient>
      <linearGradient id="sea" x2="0" y2="1"><stop stop-color="#315761"/><stop offset="1" stop-color="#091e2c"/></linearGradient>
      <linearGradient id="a" x1="0" y1="1" x2=".15" y2="0"><stop stop-color="#7cf3ba" stop-opacity=".65"/><stop offset=".28" stop-color="#41cfae" stop-opacity=".27"/><stop offset="1" stop-color="#75b5f7" stop-opacity="0"/></linearGradient>
      <linearGradient id="b" x2="0" y2="1"><stop stop-color="#9379ee" stop-opacity="0"/><stop offset=".8" stop-color="#8c80dc" stop-opacity=".16"/><stop offset="1" stop-color="#8cf3de" stop-opacity=".5"/></linearGradient>
      <radialGradient id="fog"><stop stop-color="#a5cbd1" stop-opacity=".3"/><stop offset="1" stop-color="#a5cbd1" stop-opacity="0"/></radialGradient>
      <radialGradient id="halo"><stop stop-color="#c5e5ec" stop-opacity=".14"/><stop offset="1" stop-color="#c5e5ec" stop-opacity="0"/></radialGradient>
      <linearGradient id="v"><stop stop-color="#030d1a" stop-opacity=".4"/><stop offset=".5" stop-color="#030d1a" stop-opacity="0"/><stop offset="1" stop-color="#030d1a" stop-opacity=".4"/></linearGradient>
    </defs><style>{css}</style>
    <path d="M0 0H1400V840H0Z" fill="url(#sky)"/>{stars}
    <circle cx="1010" cy="180" r="170" fill="url(#halo)"/><circle cx="1010" cy="180" r="23" fill="#c2dae0" opacity=".75"/>
    <g class="aurora"><path d="M-100 -100H1500V90C1190 35 1090 310 850 230S450 380 260 225S30 230 -100 300Z" fill="url(#a)"/><path d="M-100 300C30 230 80 80 260 225S610 150 850 230S1190 35 1500 90" fill="none" stroke="#9affd3" stroke-opacity=".18" stroke-width="2"/></g>
    <path class="aurora second" d="M0 -80H1400V140Q1190 330 950 160T500 200T0 130Z" fill="url(#b)"/>
    <g fill="none" stroke="#70b7b5" opacity=".09" stroke-linecap="round"><path d="M1460 30Q1030 20 900 345" stroke-width="35"/><path d="M1200 70Q1000 -30 730 20M1110 130Q1200 15 1400 -20M1020 210Q830 80 600 80" stroke-width="14"/></g>
    <path d="M0 470L100 365 220 420 390 255 580 435 730 350 850 420 1090 290 1250 390 1400 335V570H0Z" fill="#223d4c"/>
    <path d="M290 350L390 255 490 365 410 330 383 307 350 350ZM999 365L1090 290 1170 355 1100 330 1085 320 1060 353Z" fill="#72929c" opacity=".5"/>
    <path d="M0 445L130 420 285 490 480 445 620 510 850 460 1000 495 1220 418 1400 455V570H0Z" fill="#102c39"/>
    <path d="M0 525Q380 505 700 525T1400 515V840H0Z" fill="url(#sea)"/>
    <g class="waterlight" stroke="#94d7cc" stroke-width="1" fill="none" opacity=".16">{waves}</g>
    <g class="fog"><ellipse cx="470" cy="520" rx="620" ry="50" fill="url(#fog)"/><ellipse cx="1050" cy="565" rx="430" ry="70" fill="url(#fog)"/></g>
    <g class="boat"><path d="M735 566Q820 585 915 561L899 580Q820 605 759 582Z" fill="#081722"/><path d="M906 567Q922 546 916 535Q910 524 904 537L913 538" stroke="#091b25" stroke-width="5" fill="none"/><path d="M824 573V443M778 453H873" stroke="#16252d" stroke-width="4"/><path d="M782 456Q800 500 780 540Q825 528 870 542Q854 495 868 456Z" fill="#6b7270"/><path d="M812 456Q823 495 811 535L833 535Q840 496 835 456Z" fill="#654646"/><path d="M824 443L758 571M824 443L900 570" stroke="#71827f" stroke-opacity=".4" fill="none"/></g>
    <path d="M0 610Q110 575 230 650L390 840H0ZM1400 600Q1290 580 1190 710L1110 840H1400Z" fill="#081e28"/>{trees}
    <g transform="translate(260 746)"><path d="M-33 94L-25 -20 -7 -51 24 -32 38 94Z" fill="#263c43"/><path d="M-7 49V-16L10 -4 -7 11 11 25 -7 38" fill="none" stroke="#7edbc4" stroke-width="2" opacity=".65"/></g>
    <path d="M0 0H1400V840H0Z" fill="url(#v)"/>
    </svg>'''
