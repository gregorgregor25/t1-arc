import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4' };
export function allowedPath(name) {
  if (name.includes('..') || name.includes('\\')) return null;
  if (name === 'edit.json') return resolve(root, 'output/v2/edit.json');
  if (/^media\/[a-z0-9-]+\.png$/.test(name)) return resolve(root, 'output/v2/assets', name.slice(6));
  if (['index.html', 'styles.css', 'app.mjs'].includes(name)) return resolve(root, 'v2', name);
  if (name === 'models.mjs') return resolve(root, name);
  if (/^node_modules\/three\/(build|examples\/jsm)\/[a-zA-Z0-9_./-]+\.js$/.test(name)) return resolve(root, name);
  return null;
}
export async function startServer(port = 4318) {
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1) || 'index.html';
      const path = allowedPath(name);
      if (req.method !== 'GET' || !path || !path.startsWith(resolve(root) + sep)) { res.writeHead(403); res.end(); return; }
      const data = await readFile(path);
      res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log((await startServer()).url);
