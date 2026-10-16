"""Browser regression against a LOCAL seeded environment (never production).

Usage: python scripts/check-mobile-parity.py PATH_TO_FIXTURE_JSON
Fixture: users[{form:{email,password}}], groups[{title}], space{name}.
Requires Playwright + Edge and frontend localhost:4200 / API localhost:8000.
Creates and revokes an invitation on the fixture group; no real users are contacted.
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

fixture = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
base = 'http://localhost:4200'
output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('mobile-parity-review')
output.mkdir(exist_ok=True)

def login(page, user):
    page.goto(base)
    page.get_by_label('Email', exact=True).fill(user['form']['email'])
    page.get_by_label('Пароль', exact=True).fill(user['form']['password'])
    page.get_by_role('button', name='Войти', exact=True).click()
    expect(page.locator('.mobile-mode-footer')).to_be_visible()

def group(page):
    page.locator('.mobile-mode-footer').get_by_role('button', name='Группы', exact=True).click()
    page.locator('app-conversation-list').get_by_role('button', name=fixture['groups'][0]['title'], exact=True).click()
    expect(page.locator('.conversation-head__summary')).to_contain_text(fixture['groups'][0]['title'])

def menu(page):
    page.locator('.conversation-head__settings-toggle').click()
    dialog = page.locator('dialog.action-menu[open]')
    expect(dialog).to_be_visible()
    return dialog

def within(page, locator):
    assert locator.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
    r = locator.bounding_box()
    assert r and r['x'] >= -1 and r['x']+r['width'] <= page.viewport_size['width']+1, r

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    context = browser.new_context(viewport={'width':390,'height':844}, has_touch=True,
                                  permissions=['clipboard-read','clipboard-write'])
    context.add_init_script("Object.defineProperty(navigator,'share',{value:async data=>{window.sharedInvite=data}})")
    context.add_init_script("Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{value:undefined})")
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    login(page, fixture['users'][0]); group(page)
    owner_actions = None
    for width, height in [(320,640),(390,844),(430,850),(844,390),(1280,900)]:
        page.set_viewport_size({'width':width,'height':height})
        actions = menu(page)
        names = actions.locator('button').all_text_contents()
        if owner_actions is None: owner_actions = names
        assert names == owner_actions, (width, names)
        for name in ['Пригласить по ссылке','Участники беседы','Файлы беседы','Поиск сообщений']:
            expect(actions.get_by_role('button', name=name, exact=True)).to_have_count(1)
        within(page, actions)
        actions.get_by_role('button', name='Закрыть меню').click()
    page.set_viewport_size({'width':390,'height':844})
    actions = menu(page); actions.get_by_role('button', name='Пригласить по ссылке', exact=True).click()
    invite = page.get_by_role('dialog', name='Пригласить по ссылке', exact=True)
    expect(invite).to_be_visible(); within(page, invite)
    invite.get_by_role('button', name='Создать ссылку', exact=True).click()
    link_input = invite.get_by_label('Ссылка приглашения', exact=True)
    expect(link_input).to_be_visible(); link = link_input.input_value()
    invite.get_by_role('button', name='Копировать', exact=True).click()
    expect(invite.get_by_role('button', name='Скопировано', exact=True)).to_be_visible()
    assert page.evaluate('navigator.clipboard.readText()') == link
    invite.get_by_role('button', name='Поделиться', exact=True).click()
    assert page.evaluate('window.sharedInvite.url') == link
    guest = browser.new_context(viewport={'width':390,'height':844})
    guest_page = guest.new_page()
    guest_page.on('pageerror', lambda e: errors.append(str(e)))
    guest_page.goto(link)
    expect(guest_page.locator('.invite-entry strong')).to_have_text(fixture['groups'][0]['title'])
    guest.close()
    page.screenshot(path=str(output/'group-invitation.png'))
    invite.get_by_role('button', name='Отключить', exact=True).first.click()
    expect(link_input).to_have_count(0)
    invite.get_by_role('button', name='Закрыть приглашения').click()
    menu(page).get_by_role('button', name='Участники беседы', exact=True).click()
    expect(page.locator('.modal--group-members')).to_be_visible()
    page.locator('.modal--group-members').get_by_role('button', name='Закрыть', exact=True).click()
    menu(page).get_by_role('button', name='Файлы беседы', exact=True).click()
    files = page.locator('.modal--chat-files')
    expect(files).to_be_visible(); within(page, files)
    files.locator('.modal__header button').click()
    menu(page).get_by_role('button', name='Поиск сообщений', exact=True).click()
    page.get_by_placeholder('Поиск по сообщениям').fill('Соберу')
    expect(page.locator('.message-search__result').first).to_be_visible()
    page.locator('.message-search__close').click()
    menu(page).get_by_role('button', name='Информация о беседе', exact=True).click()
    info = page.locator('app-info-panel dialog')
    with page.expect_file_chooser():
        info.get_by_role('button', name='Изменить иконку', exact=True).click()
    # File chooser opened: no upload is needed to prove the mobile gate is gone.
    info.get_by_role('button', name='Закрыть информацию').click()
    message = page.locator('.message-card').last
    message.get_by_role('button', name='Действия с сообщением').click()
    message_actions = page.get_by_role('dialog', name='Действия с сообщением')
    expect(message_actions.get_by_role('button', name='Скопировать текст')).to_be_visible()
    message_actions.get_by_role('button', name='Ответить', exact=True).click()
    expect(page.locator('.composer textarea')).to_be_focused()
    page.locator('.composer textarea').blur()
    page.get_by_role('button', name='Присоединиться к групповому звонку', exact=True).click()
    page.get_by_role('button', name='Развернуть звонок', exact=True).click()
    call = page.get_by_role('region', name='Окно звонка')
    expect(call).to_be_visible()
    call.get_by_role('button', name='Меню звонка', exact=True).click()
    call_menu = page.locator('dialog.action-menu[open]')
    expect(call_menu.get_by_role('button', name='Включить камеру', exact=True)).to_be_enabled(timeout=15000)
    expect(call_menu.get_by_role('button', name='Показать экран', exact=True)).to_be_disabled()
    expect(call_menu.get_by_text('Этот браузер не поддерживает показ вашего экрана.', exact=False)).to_be_visible()
    call_menu.get_by_role('button', name='Звук и устройства', exact=True).click()
    expect(call_menu.get_by_role('slider', name='Громкость звонка')).to_be_visible()
    call_menu.get_by_role('button', name='Закрыть меню').click()
    page.get_by_role('button', name='Завершить звонок', exact=True).filter(visible=True).first.click()
    page.locator('.mobile-mode-footer').get_by_role('button', name='Площадки', exact=True).click()
    page.locator('app-platform-list').get_by_role('button', name=fixture['space']['name'], exact=True).click()
    page.locator('.space-channel').first.click()
    actions = menu(page)
    expect(actions.get_by_role('button', name='Пригласить по ссылке', exact=True)).to_be_visible()
    expect(actions.get_by_role('button', name='Участники беседы', exact=True)).to_be_visible()
    actions.get_by_role('button', name='Закрыть меню').click()
    def personal():
        page.locator('.mobile-mode-footer').get_by_role('button', name='Открыть меню').click()
        return page.get_by_role('dialog', name='Меню', exact=True)
    personal().get_by_role('button', name='Оформление', exact=True).click()
    appearance = page.get_by_role('dialog', name='Оформление')
    within(page, appearance)
    appearance.get_by_role('button', name='Готово', exact=True).click()
    personal().get_by_role('button', name='Инвентарь', exact=False).click()
    within(page, page.get_by_role('dialog', name='Предметы'))
    page.get_by_role('button', name='Закрыть инвентарь').click()
    personal().get_by_role('button', name='Админка', exact=True).click()
    for width in [320,390,844]:
        page.set_viewport_size({'width':width,'height':844})
        nav = page.get_by_role('navigation', name='Разделы админки')
        within(page, nav)
        for tab in nav.locator('button').all():
            tab.click(); within(page, tab)
            # Voice access opens a separate modal; stop before that final button.
            if tab.inner_text() == 'Предметы': break
        page.screenshot(path=str(output/f'admin-{width}.png'))
    page.get_by_role('button', name='Вернуться к чатам').click()
    context.close()
    context = browser.new_context(viewport={'width':390,'height':844}, has_touch=True)
    page = context.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
    login(page, fixture['users'][1]); group(page)
    actions = menu(page)
    expect(actions.get_by_role('button', name='Пригласить по ссылке', exact=True)).to_have_count(0)
    expect(actions.get_by_role('button', name='Участники беседы', exact=True)).to_be_visible()
    actions.get_by_role('button', name='Закрыть меню').click()
    menu(page).get_by_role('button', name='Информация о беседе', exact=True).click()
    expect(page.locator('app-info-panel').get_by_role('button', name='Изменить иконку', exact=True)).to_have_count(0)
    assert not errors, errors
    browser.close()
print('Desktop/mobile action parity, invitation copy/share/revoke, icon picker, platform actions and member permissions passed')
