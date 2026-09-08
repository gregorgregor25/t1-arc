import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startServer } from './server.mjs';
import { DURATION, FPS } from './storyboard.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const args = new Set(process.argv.slice(2));
const portrait = args.has('--portrait');
const draft = args.has('--draft');
const stills = args.has('--stills');
const format = portrait ? 'portrait' : 'landscape';
const width = draft ? (portrait ? 540 : 960) : (portrait ? 1080 : 1920);
const height = draft ? (portrait ? 960 : 540) : (portrait ? 1920 : 1080);
const fps = draft ? 15 : FPS;
const outputDir = resolve(root, 'output', `${format}${draft ? '-draft' : ''}`);
await mkdir(outputDir, { recursive: true });
const { server, url } = await startServer(0);
let browser, encoder;
let encoderError = '';
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.T1ARC_PROMO_BROWSER ? { executablePath: process.env.T1ARC_PROMO_BROWSER } : {}),
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${url}/?format=${format}&capture=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.T1ArcFilm?.ready, null, { timeout: 60_000 });
  if (errors.length) throw new Error(errors.join('\n'));
  const moments = [2.8, 11.5, 18.8, 21.8, 26.5, 31.8, 36.1, 43.5];
  for (let i = 0; i < moments.length; i++) {
    await page.evaluate(t => window.T1ArcFilm.renderAt(t), moments[i]);
    await page.screenshot({ path: resolve(outputDir, `scene-${i + 1}.png`), animations: 'disabled' });
  }
  console.log(`Reviewed-frame candidates saved: ${outputDir}`);
  if (!stills) {
    const output = resolve(outputDir, `t1-arc-${format}${draft ? '-draft' : ''}.mp4`);
    encoder = spawn(process.env.T1ARC_PROMO_FFMPEG ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
      '-an', '-c:v', 'libx264', '-preset', draft ? 'veryfast' : 'medium', '-crf', draft ? '23' : '18',
      '-pix_fmt', 'yuv420p', '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', output,
    ], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    encoder.stderr.on('data', chunk => { encoderError += chunk.toString(); });
    encoder.stdin.on('error', error => { encoderError += error.message; });
    const closed = new Promise((resolveClose, rejectClose) => {
      encoder.once('close', code => resolveClose(code));
      encoder.once('error', rejectClose);
    });
    // Mark the promise handled while frames are being sent; await it below.
    closed.catch(() => {});
    await once(encoder, 'spawn');
    for (let frame = 0; frame < DURATION * fps; frame++) {
      await page.evaluate(t => window.T1ArcFilm.renderAt(t), frame / fps);
      const png = await page.screenshot({ animations: 'disabled' });
      await new Promise((resolveWrite, rejectWrite) => {
        encoder.stdin.write(png, error => error ? rejectWrite(error) : resolveWrite());
      });
      if (frame % (fps * 5) === 0) console.log(`${format}: ${frame / fps}s / ${DURATION}s`);
    }
    encoder.stdin.end();
    const code = await closed;
    if (code !== 0) throw new Error(`Video encoder failed (${code}): ${encoderError}`);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Video saved: ${output}`);
  }
  await writeFile(resolve(outputDir, 'render.json'), JSON.stringify({
    format, width, height, fps, durationSeconds: DURATION, stillsOnly: stills,
    syntheticScreensOnly: true, audio: 'Silent, captioned', engine: 'Three.js 0.185.1',
    originalDeviceGeometry: true, browserErrors: errors, screenshotTimes: moments,
  }, null, 2));
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill();
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
