import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';

test('the preview serves only its own public render inputs on loopback', async () => {
  const { server, url } = await startServer(0);
  try {
    assert.equal(server.address().address, '127.0.0.1');
    const html = await fetch(url);
    assert.equal(html.status, 200);
    assert.match(await html.text(), /DEMO · EXAMPLE DATA/);
    assert.equal((await fetch(`${url}/assets/tarv1s.png`)).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${url}/node_modules/three/build/three.module.js`)).status, 200);
    for (const path of ['/package.json', '/.env', '/README.md', '/assets/missing.png',
      '/node_modules/three/build/%252e%252e/%252e%252e/playwright-core/index.js',
      '/node_modules/three/build/..%2f..%2f..%2fserver.mjs', '/%5C..%5Cpackage.json']) {
      assert.ok([403, 404].includes((await fetch(`${url}${path}`)).status), path);
    }
    assert.equal((await fetch(url, { method: 'POST', body: 'not accepted' })).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
