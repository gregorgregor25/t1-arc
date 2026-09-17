import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const files = new Set(['index.html', 'styles.css', 'app.mjs', 'models.mjs', 'storyboard.mjs']);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
export async function startServer(port = 4317) {
  const server = createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\//, '') || 'index.html';
      const allowed = files.has(name) || /^assets\/[a-z0-9-]+\.png$/.test(name) ||
        /^node_modules\/three\/(build|examples\/jsm)\/[a-zA-Z0-9_./-]+\.js$/.test(name);
      const path = resolve(root, name);
      if (request.method !== 'GET' || !allowed || name.split('/').includes('..') || !path.startsWith(resolve(root) + sep)) {
        response.writeHead(403); response.end('Not served'); return;
      }
      const data = await readFile(path);
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(data);
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveStart);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.env.PORT ?? 4317));
  console.log(`T1 Arc film preview: ${url}`);
  console.log(`Vertical preview: ${url}/?format=portrait`);
}
