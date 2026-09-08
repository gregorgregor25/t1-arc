import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { FACE_NAMES } from './storyboard.mjs';

const { server, url } = await startServer(0);
const browser = await chromium.launch({ headless: true,
  ...(process.env.T1ARC_PROMO_BROWSER ? { executablePath: process.env.T1ARC_PROMO_BROWSER } : {}),
});
const results = [];
try {
  for (const format of ['landscape', 'portrait']) {
    await mkdir(new URL(`output/qa/${format}/`, import.meta.url), { recursive: true });
    const width = format === 'landscape' ? 1920 : 1080;
    const height = format === 'landscape' ? 1080 : 1920;
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [], externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => {
      if (!request.url().startsWith(url) && !request.url().startsWith('data:')) externalRequests.push(request.url());
    });
    await page.goto(`${url}/?format=${format}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.T1ArcFilm?.ready);
    assert.equal(await page.evaluate(() => window.T1ArcFilm.inspectLayout().playing), false, 'never auto-play');
    const layouts = [];
    for (const time of [2.8, 11.5, 18.8, 21.8, 26.5, 31.8, 33.7, 35.1, 36.5, 37.9, 39.3, 43.5]) {
      const layout = await page.evaluate(t => {
        window.T1ArcFilm.renderAt(t);
        return window.T1ArcFilm.inspectLayout();
      }, time);
      for (const bounds of [layout.copy, layout.note, layout.footer, ...layout.names]) {
        assert.ok(bounds.left >= 0 && bounds.right <= width + 1 && bounds.top >= 0 && bounds.bottom <= height + 1,
          `${format}/${time}: text outside frame ${JSON.stringify(bounds)}`);
      }
      assert.ok(layout.copy.bottom < layout.footer.top, `${format}/${time}: headline crosses footer`);
      if (layout.names.length) {
        assert.ok(layout.names.every(name => name.bottom < layout.footer.top), 'face names clear of safety footer');
        const names = await page.locator('#face-names span').allTextContents();
        if (format === 'landscape') assert.deepEqual(names, FACE_NAMES);
        else assert.deepEqual(names, [FACE_NAMES[Math.min(4, Math.floor((time - 33) / 1.4))]]);
      }
      layouts.push({ time, ...layout });
      await page.screenshot({ path: fileURLToPath(new URL(`output/qa/${format}/frame-${time}.png`, import.meta.url)) });
    }
    // The same time produces the same pixels; different times contain real motion.
    const hashes = [];
    for (const time of [2.8, 3.8, 2.8]) {
      await page.evaluate(t => window.T1ArcFilm.renderAt(t), time);
      const png = await page.screenshot({ path: fileURLToPath(new URL(`output/qa/${format}/motion-${hashes.length}.png`, import.meta.url)) });
      hashes.push(createHash('sha256').update(png).digest('hex'));
    }
    assert.notEqual(hashes[0], hashes[1], 'model motion is visible');
    assert.equal(hashes[0], hashes[2], 'random-access frames are deterministic');
    await page.locator('#play').click();
    await page.waitForFunction(() => window.T1ArcFilm.inspectLayout().position > 3.1);
    await page.locator('#play').click();
    assert.equal(await page.evaluate(() => window.T1ArcFilm.inspectLayout().playing), false);
    await page.locator('#seek').fill('26.5');
    assert.equal(await page.evaluate(() => window.T1ArcFilm.inspectLayout().chapter), 'food');
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    results.push({ format, width, height, layouts, deterministic: true, motionVerified: true,
      controlsVerified: true, autoplay: false, browserErrors: errors, externalPageRequests: externalRequests });
    await page.close();
    console.log(`${format}: 12 layouts, all five names, deterministic motion, pause/seek and local-only requests passed.`);
  }
  await mkdir(new URL('output/', import.meta.url), { recursive: true });
  await writeFile(new URL('output/preview-verification.json', import.meta.url), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
