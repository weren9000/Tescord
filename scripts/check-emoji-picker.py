"""Local browser test. Usage: python scripts/check-emoji-picker.py FIXTURE OUTPUT_DIR."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

fixture=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
out=Path(sys.argv[2]);out.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge')
 def open_chat(context,user):
  page=context.new_page();page.goto('http://localhost:4200')
  form=user['form'];page.get_by_label('Email',exact=True).fill(form['email']);page.get_by_label('Пароль',exact=True).fill(form['password']);page.get_by_role('button',name='Войти',exact=True).click()
  page.locator('.mobile-mode-footer').get_by_role('button',name='Группы',exact=True).click()
  page.locator('app-conversation-list').get_by_role('button',name=fixture['groups'][0]['title'],exact=True).click()
  expect(page.locator('.composer textarea')).to_be_visible();page.wait_for_load_state('networkidle')
  return page
 context=browser.new_context(viewport={'width':390,'height':844},has_touch=True)
 page=open_chat(context,fixture['users'][0]);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 trigger=page.get_by_role('button',name='Эмодзи',exact=True)
 for width,height in [(1366,900),(390,844),(320,700)]:
  page.set_viewport_size({'width':width,'height':height})
  page.wait_for_function("""()=>{const boxes=['.composer__attach','.composer-emoji>button','.composer__submit'].map(s=>document.querySelector(s).getBoundingClientRect());const centers=boxes.map(b=>b.y+b.height/2);return Math.max(...centers)-Math.min(...centers)<=1}""")
  boxes=[page.locator(selector).bounding_box() for selector in ['.composer__attach','.composer-emoji>button','.composer__submit']]
  centers=[box['y']+box['height']/2 for box in boxes]
  page.screenshot(path=str(out/f'composer-{width}.png'))
  assert max(centers)-min(centers)<=1,centers
  assert len({box['height'] for box in boxes})==1
  trigger.click();picker=page.get_by_role('region',name='Выбор эмодзи',exact=True)
  expect(picker.get_by_label('Категория эмодзи')).to_be_visible()
  assert picker.locator('.scroll .grid:not(.favorites) button').count()>400
  box=picker.bounding_box();assert box['x']>=0 and box['x']+box['width']<=width+1 and box['y']>=0,box
  search=picker.get_by_role('searchbox',name='Поиск эмодзи');search.fill('лягушка')
  expect(picker.locator('.grid button')).to_have_count(1)
  with page.expect_response(lambda r:'/api/users/me/emojis/use' in r.url and r.request.method=='POST') as result:
   picker.get_by_role('button',name='Лягушка ква',exact=True).click()
  assert result.value.status==200
  expect(page.locator('.composer textarea')).to_have_value('🐸')
  page.locator('.composer textarea').fill('');page.locator('.composer textarea').blur()
  trigger.click();expect(picker.locator('.favorites button').first).to_have_text('🐸')
  picker.get_by_label('Категория эмодзи').select_option(label='Еда и напитки')
  expect(picker.locator('.favorites')).to_have_count(0)
  expect(picker.get_by_role('button',name='Пицца',exact=True)).to_be_visible()
  picker.get_by_label('Категория эмодзи').select_option('')
  page.screenshot(path=str(out/f'picker-{width}.png'))
  picker.get_by_role('searchbox',name='Поиск эмодзи').press('Escape');expect(picker).to_have_count(0);expect(trigger).to_be_focused()
 # Server persistence: fresh browser context, same account.
 field=page.locator('.composer textarea');field.fill('AB');field.evaluate('(e)=>e.setSelectionRange(1,1)')
 trigger.click();picker.get_by_role('searchbox',name='Поиск эмодзи').fill('лягушка');picker.get_by_role('button',name='Лягушка ква',exact=True).click()
 expect(field).to_have_value('A🐸B');field.fill('')
 fresh=browser.new_context(viewport={'width':390,'height':844})
 other=open_chat(fresh,fixture['users'][0]);other.get_by_role('button',name='Эмодзи',exact=True).click()
 expect(other.locator('app-emoji-picker .favorites button').first).to_have_text('🐸')
 fresh.close();assert not errors,errors
 browser.close()
print('Emoji picker: alignment, 400+ items, search/categories, top usage, cross-session persistence and mobile bounds passed')
