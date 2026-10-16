"""Local-only real media integration check; uses existing fixture accounts."""
import json,sys
import httpx
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

fixture=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge',args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'])
    pages=[];errors=[]
    for user in fixture['users'][:2]:
        context=browser.new_context(viewport={'width':1440,'height':900},permissions=['microphone','camera'])
        page=context.new_page();pages.append(page)
        page.on('pageerror',lambda error:errors.append(str(error)))
        # Deterministic screen capture in headless mode; actual WebRTC publication is unchanged.
        page.add_init_script('''navigator.mediaDevices.getDisplayMedia=async()=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const x=c.getContext('2d');const draw=()=>{x.fillStyle='#15435b';x.fillRect(0,0,1280,720);x.fillStyle='white';x.font='48px sans-serif';x.fillText('KVA presentation '+Date.now(),80,360)};draw();setInterval(draw,100);return c.captureStream(10)}''')
        page.goto('http://localhost:4200')
        page.get_by_label('Email',exact=True).fill(user['form']['email'])
        page.get_by_label('Пароль',exact=True).fill(user['form']['password'])
        page.get_by_role('button',name='Войти',exact=True).click()
        page.locator('app-section-navigation').get_by_role('button',name='Группы',exact=True).click()
        page.locator('app-conversation-list').get_by_role('button',name=fixture['groups'][0]['title'],exact=True).click()
        page.wait_for_load_state('networkidle')
        page.locator('.composer textarea').fill('Черновик до звонка')
        page.get_by_role('button',name='Присоединиться к групповому звонку',exact=True).click()
        expect(page.locator('.call-window')).to_be_visible()
        expect(page.get_by_role('button',name='Включить камеру',exact=True)).to_be_enabled(timeout=30000)
        page.screenshot(path=str(out/f'joined-{len(pages)}.png'))
    a,b=pages
    expect(a.locator('.conference-tile')).to_have_count(2,timeout=20000)
    a.get_by_role('button',name='Включить камеру',exact=True).click()
    expect(b.locator('.conference-tile video')).to_have_count(1,timeout=20000)
    b.wait_for_function("document.querySelector('.conference-tile video')?.videoWidth>0")
    # Ten-tile layout fixture; real media synchronization is checked with two clients.
    a.evaluate('''()=>{const g=document.querySelector('.conference-grid');g.classList.remove('conference-grid--pair');g.style.setProperty('--conference-columns','3');for(let i=0;i<8;i++){const t=g.lastElementChild.cloneNode(true);t.dataset.fixture='true';t.querySelector('.conference-name').textContent='Participant '+(i+3);g.append(t)}}''')
    a.screenshot(path=str(out/'ten-tile-layout.png'))
    assert a.locator('.conference-grid').evaluate('e=>e.scrollWidth<=e.clientWidth')
    a.evaluate('''()=>{document.querySelectorAll('[data-fixture]').forEach(e=>e.remove());const g=document.querySelector('.conference-grid');g.classList.add('conference-grid--pair');g.style.setProperty('--conference-columns','2')}''')
    for width,height in [(1440,900),(390,844),(320,700)]:
        a.set_viewport_size({'width':width,'height':height})
        a.wait_for_timeout(300)
        a.wait_for_function('''()=>{const p=document.querySelector('.workspace-main-pane').getBoundingClientRect(),c=document.querySelector('.call-window').getBoundingClientRect();return Math.abs(p.width-c.width)<2&&Math.abs(p.height-c.height)<2}''')
        assert a.evaluate('document.documentElement.scrollWidth<=innerWidth')
        a.screenshot(path=str(out/f'conference-{width}.png'))
        a.get_by_role('button',name='Участники',exact=True).click()
        expect(a.locator('.call-window__roster')).to_be_visible()
        a.get_by_role('button',name='Закрыть участников',exact=True).click()
        a.get_by_role('button',name='Свернуть звонок',exact=True).click()
        expect(a.locator('.composer textarea')).to_have_value('Черновик до звонка')
        expect(a.locator('.composer textarea')).to_be_visible()
        expect(a.locator('.call-tray')).to_have_count(1)
        expect(b.locator('.conference-tile video')).to_have_count(1)
        a.screenshot(path=str(out/f'chat-{width}.png'))
        a.get_by_role('button',name='Развернуть звонок',exact=True).click()
    a.set_viewport_size({'width':1440,'height':900})
    a.get_by_role('button',name='Свернуть звонок',exact=True).click()
    a.locator('app-conversation-list').get_by_role('button',name=fixture['groups'][1]['title'],exact=True).click()
    expect(a.locator('.call-tray')).to_be_visible()
    a.get_by_role('button',name='Развернуть звонок',exact=True).click()
    expect(a.locator('.conference-tile')).to_have_count(2)
    expect(a.locator('.conversation-head__summary strong')).to_have_text(fixture['groups'][0]['title'])
    a.get_by_role('button',name='Свернуть звонок',exact=True).click()
    a.locator('app-conversation-list').get_by_role('button',name=fixture['groups'][0]['title'],exact=True).click()
    expect(a.locator('.composer textarea')).to_have_value('Черновик до звонка')
    a.get_by_role('button',name='Развернуть звонок',exact=True).click()
    a.get_by_role('button',name='Показать экран',exact=True).click()
    expect(b.locator('.conference-presentation video')).to_be_visible(timeout=20000)
    b.wait_for_function("document.querySelector('.conference-presentation video')?.videoWidth>0")
    assert b.locator('.conference-presentation').bounding_box()['width']>800
    b.screenshot(path=str(out/'presentation.png'))
    b.locator('.conference-presentation').get_by_role('button',name='На весь экран').click()
    expect(b.locator('.call-media-fullscreen')).to_be_visible()
    b.keyboard.press('Escape')
    expect(b.locator('.call-media-fullscreen')).to_have_count(0)
    expect(b.locator('.conference-presentation')).to_be_visible()
    for page in pages:
        page.get_by_role('button',name='Завершить звонок',exact=True).click()
        expect(page.locator('.call-window')).to_have_count(0)
    # Direct calls use the same workspace surface and remain usable after relocation.
    with httpx.Client(base_url='http://127.0.0.1:8000') as api:
        for user in fixture['users'][:2]:
            token=api.post('/api/auth/login',json=user['form']).json()['access_token']
            api.post('/api/presence/heartbeat',headers={'Authorization':'Bearer '+token}).raise_for_status()
    a.reload()
    a.wait_for_load_state('networkidle')
    a.locator('app-section-navigation').get_by_role('button',name='Друзья',exact=True).click()
    a.locator('app-conversation-list button.entry').filter(has_text=fixture['users'][1]['user']['nick']).click()
    a.get_by_role('button',name='Позвонить',exact=True).click()
    a.wait_for_timeout(1200)
    a.screenshot(path=str(out/'direct-outgoing.png'))
    b.screenshot(path=str(out/'direct-incoming.png'))
    b.get_by_role('button',name='Ответить',exact=True).click()
    expect(a.get_by_role('button',name='Включить камеру',exact=True)).to_be_enabled(timeout=20000)
    a.get_by_role('button',name='Включить камеру',exact=True).click()
    expect(b.locator('.direct-call-video-stage video')).to_be_visible(timeout=20000)
    b.wait_for_function("document.querySelector('.direct-call-video-stage video')?.videoWidth>0",timeout=20000)
    b.screenshot(path=str(out/'direct-call.png'))
    a.get_by_role('button',name='Завершить звонок',exact=True).click()
    assert not errors,errors
    browser.close()
print('Conference: bounds, camera reception, screen reception, fullscreen, roster and draft preservation passed')
