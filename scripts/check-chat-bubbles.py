"""Local-only chat browser regression. Usage: python scripts/check-chat-bubbles.py FIXTURE_JSON OUTPUT_DIR. Creates test messages and an image in local fixture chats."""
import json,time,sys
from PIL import Image
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
f=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
out=Path(sys.argv[2]);out.mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge');context=b.new_context(viewport={'width':390,'height':844},has_touch=True,permissions=['clipboard-read','clipboard-write']);page=context.new_page()
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:4200');u=f['users'][0]['form']
 page.get_by_label('Email',exact=True).fill(u['email']);page.get_by_label('Пароль',exact=True).fill(u['password']);page.get_by_role('button',name='Войти',exact=True).click()
 page.locator('.mobile-mode-footer').get_by_role('button',name='Группы',exact=True).click()
 with page.expect_response(lambda r:'/api/channels/' in r.url and '/messages' in r.url and r.request.method=='GET'):
  page.locator('app-conversation-list').get_by_role('button',name=f['groups'][0]['title'],exact=True).click()
 expect(page.locator('.composer textarea')).to_be_visible()
 page.wait_for_load_state('networkidle')
 sample='Проверка пузырьков '+str(int(time.time()))
 def send(text):
  page.locator('.composer textarea').fill(text)
  page.get_by_role('button',name='Отправить сообщение',exact=True).click()
  expect(page.locator('.message-card__text').filter(has_text=text).last).to_be_visible()
 send(sample)
 send('Короткое сообщение 🐸')
 for width,height in [(1366,900),(390,844),(320,700)]:
  page.set_viewport_size({'width':width,'height':height})
  last=page.locator('.message-card').last;last.scroll_into_view_if_needed()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.locator('.message-list').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  assert last.locator('.message-card__body').bounding_box()['width']<500
  expect(last.locator('.bubble-footer')).to_be_visible()
  if width>980:last.click(button='right')
  else:last.get_by_role('button',name='Действия с сообщением',exact=True).click()
  menu=page.get_by_role('dialog',name='Действия с сообщением');expect(menu).to_be_visible()
  r=menu.bounding_box();assert r['x']>=0 and r['y']>=0 and r['x']+r['width']<=width+1 and r['y']+r['height']<=height+1,r
  page.screenshot(path=str(out/f'menu-{width}.png'))
  menu.get_by_role('button',name='Ответить',exact=True).click()
  expect(page.locator('.composer textarea')).to_be_focused()
  send('Ответ на короткое '+str(width))
  reply=page.locator('.message-card').last
  reply.locator('.message-card__reply-preview').click()
  expect(page.locator('.message-card--search-focused')).to_be_visible()
  page.get_by_role('button',name='Эмодзи',exact=True).click()
  page.get_by_role('group',name='Выбор эмодзи').get_by_role('button',name='🐸',exact=True).click()
  expect(page.locator('.composer textarea')).to_have_value('🐸')
  page.locator('.composer textarea').fill('');page.locator('.composer textarea').blur()
  page.screenshot(path=str(out/f'chat-{width}.png'))
 # Image preview keeps its box; quick reaction and copy use real APIs/clipboard.
 picture=out/'test-image.png';Image.new('RGB',(800,500),(35,120,90)).save(picture)
 with page.expect_file_chooser() as picker:page.get_by_role('button',name='Прикрепить файл',exact=True).click()
 picker.value.set_files(str(picture))
 page.get_by_role('button',name='Отправить сообщение',exact=True).click()
 image_message=page.locator('.message-card').last
 expect(image_message.locator('.attachment-card__preview img')).to_be_visible()
 assert page.locator('.message-list').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
 page.screenshot(path=str(out/'image-mobile.png'))
 send('https://kvachat.ru/ '+('Длинное сообщение без потери текста. '*20))
 last=page.locator('.message-card').last
 expect(last.locator('a.message-link')).to_have_attribute('href','https://kvachat.ru/')
 last.get_by_role('button',name='Действия с сообщением',exact=True).click()
 page.get_by_role('dialog',name='Действия с сообщением').get_by_role('button',name='Сердце',exact=True).click()
 expect(last.locator('.reaction-chip--active')).to_be_visible()
 page.locator('.composer textarea').fill(('Строка\n'*20))
 assert page.locator('.composer textarea').evaluate('(e)=>e.scrollHeight>e.clientHeight&&getComputedStyle(e).overflowY==="auto"')
 page.locator('.composer textarea').fill('')
 # New messages must not pull a reader away from history.
 page.locator('.message-list').evaluate('(e)=>e.scrollTop=160')
 expect(page.get_by_role('button',name='К последним сообщениям',exact=True)).to_be_visible()
 before=page.locator('.message-list').evaluate('(e)=>e.scrollTop')
 peer_context=b.new_context(viewport={'width':390,'height':844});peer=peer_context.new_page();peer.goto('http://localhost:4200')
 peer_user=f['users'][1]['form'];peer.get_by_label('Email',exact=True).fill(peer_user['email']);peer.get_by_label('Пароль',exact=True).fill(peer_user['password']);peer.get_by_role('button',name='Войти',exact=True).click()
 peer.locator('.mobile-mode-footer').get_by_role('button',name='Группы',exact=True).click();peer.locator('app-conversation-list').get_by_role('button',name=f['groups'][0]['title'],exact=True).click()
 incoming='Входящее во время чтения '+str(int(time.time()));peer.locator('.composer textarea').fill(incoming);peer.get_by_role('button',name='Отправить сообщение',exact=True).click()
 expect(page.locator('.message-card__text').filter(has_text=incoming)).to_be_attached()
 assert abs(page.locator('.message-list').evaluate('(e)=>e.scrollTop')-before)<3
 peer_context.close()
 page.get_by_role('button',name='К последним сообщениям',exact=True).click()
 expect(last.locator('.message-card__text')).to_be_visible()
 page.locator('.mobile-mode-footer').get_by_role('button',name='Площадки',exact=True).click()
 page.locator('app-platform-list').get_by_role('button',name=f['space']['name'],exact=True).click()
 page.locator('.space-channel').first.click()
 send('Проверка канала '+str(int(time.time())))
 assert page.locator('.message-list').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
 page.locator('.mobile-mode-footer').get_by_role('button',name='Друзья',exact=True).click()
 page.locator('app-conversation-list button.entry').first.click()
 send('Проверка личного чата '+str(int(time.time())))
 expect(page.locator('.message-card').last).to_have_class(__import__('re').compile('message-card--direct'))
 expect(page.locator('.message-card').last.locator('.message-card__meta')).to_be_hidden()
 # Rendering check with a bright wallpaper and a light palette (no account mutation).
 page.evaluate("""()=>{const s=document.documentElement.style;for(const [k,v] of Object.entries({canvas:'#f1f4f6',surface:'#ffffff',raised:'#ffffff',text:'#17212b',muted:'#607487',primary:'#3390ec','primary-text':'#2270aa',border:'#d8e1e8'}))s.setProperty('--palette-'+k,v);document.querySelector('.message-list').style.backgroundImage='linear-gradient(45deg,#ffdb85,#5acbd0)'}""")
 page.screenshot(path=str(out/'light-direct.png'))
 assert not errors,errors
 b.close()
print('Chat bubbles, compact layout, context menu bounds, reply navigation and emoji insertion passed at 1366/390/320px')
