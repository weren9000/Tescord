// Read-only check: no login, invitation creation or membership changes.
const {request} = require('../desktop/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
  const baseURL = process.env.KVA_TEST_ORIGIN || 'https://kvachat.ru';
  const client = await request.newContext({baseURL});
  try {
    const login = await client.get('/login');
    assert.equal(login.status(), 200);
    const html = await login.text();
    for (const suffix of ['', '/', '?source=chat']) {
      const response = await client.get('/platform-invite/' + 'x'.repeat(43) + suffix);
      assert.equal(response.status(), 200, 'Invitation entry must load the application');
      assert.equal(await response.text(), html);
      assert.match(response.headers()['x-robots-tag'] || '', /noindex/);
    }
    const missing = await client.get('/not-an-application-route');
    assert.equal(missing.status(), 404, 'Unknown files must not return application HTML');
    console.log('PASS: platform invite URLs load the application; unknown paths remain 404');
  } finally { await client.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
