import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { root, edition, output } from './narration-paths.mjs';
const privacy = edition === 'privacy';
const mixed = edition === 'mixed' || privacy;
const port = privacy ? 4329 : mixed ? 4328 : 4327;
const suffix = privacy ? 'privacy' : 'narration-and-music';
const allowed = new Map(['landscape', 'portrait'].flatMap(format => ['4K', 'sharing'].map(size => {
  const name = mixed ? `T1-Arc-${format}-${size}-${suffix}.mp4` : `T1-Arc-V4-full-${format}-${size}.mp4`;
  return [name, join(mixed ? output : join(root, 'out'), name)];
})));
const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T1 Arc full film review</title>
<style>body{margin:0;padding:24px;background:#0b0d14;color:#eee;font:16px system-ui}h1{font-size:24px;margin:0 0 12px}button,select{font:inherit;padding:10px;margin:4px;background:#24283b;color:#fff;border:1px solid #515a7e;border-radius:6px}button:focus-visible{outline:3px solid #adb5ff}#screen{margin:20px auto;width:min(960px,100%)}video{display:block;width:100%;height:auto;background:#07090f}video::cue{color:#fff;background:#080a10e6;font:18px system-ui}#status{color:#bbb;margin:10px 0}label{margin-right:16px}</style>
<h1>T1 Arc full film review</h1><p>${privacy ? 'Local only. Privacy ending edition. Earlier 80 seconds unchanged.' : mixed ? 'Local only. Conversational George narration and Signal Drift. No spoken closing tagline.' : 'Local only. Both films are silent. Music and narration remain separate.'}</p>
<label>Format <select id="format"><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
<label>Viewing size <select id="size"><option value="normal">Desktop</option><option value="phone">Phone width (390px)</option></select></label>
<label>Export <select id="quality"><option value="sharing">Sharing copy</option><option value="4K">4K master</option></select></label>
<div id="chapters"></div><button id="play">Play full film</button><button id="pause">Pause</button>${mixed ? '<button id="captions">Show subtitles</button>' : ''}<div id="status" role="status">Waiting for export</div>
<div id="screen"><video id="video" controls muted playsinline preload="metadata">${mixed ? '<track kind="captions" src="/captions.vtt" srclang="en" label="English narration">' : ''}</video></div>
<script>
const video=document.querySelector('#video'),format=document.querySelector('#format'),quality=document.querySelector('#quality'),status=document.querySelector('#status');
function load(){video.src=${mixed ? `'/media/T1-Arc-'+format.value+'-'+quality.value+'-${suffix}.mp4'` : "'/media/T1-Arc-V4-full-'+format.value+'-'+quality.value+'.mp4'"};video.load();}
format.onchange=load;quality.onchange=load;
document.querySelector('#size').onchange=e=>document.querySelector('#screen').style.width=e.target.value==='phone'?'390px':'min(960px,100%)';
document.querySelector('#play').onclick=()=>{video.currentTime=0;video.play();};
document.querySelector('#pause').onclick=()=>video.pause();
const captionsButton=document.querySelector('#captions');
if(captionsButton)captionsButton.onclick=()=>{const show=captionsButton.textContent==='Show subtitles';for(const track of video.textTracks)track.mode=show?'showing':'disabled';captionsButton.textContent=show?'Hide subtitles':'Show subtitles';};
for(const [label,time] of [['Today',2],['Health',13],['Sleep',19],['Tarv1s',24],['Question',30],['Answer',42],['Evidence hold',51],['Timeline',59],['Food',73],['Closing',${privacy ? 86 : 85}]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{video.pause();video.currentTime=time;};document.querySelector('#chapters').append(b);}
for(const event of ['loadedmetadata','timeupdate','ended','error'])video.addEventListener(event,()=>{status.textContent=video.error?'Playback error: '+video.error.message:video.currentTime.toFixed(2)+' / '+video.duration.toFixed(2)+' seconds'+(video.ended?' | Finished':'');});
load();
</script></html>`;

createServer((request, response) => {
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(page); return; }
  if (mixed && path === '/captions.vtt') {
    response.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });
    createReadStream(join(output, 'T1-Arc-George-narration.vtt')).pipe(response); return;
  }
  const file = path.startsWith('/media/') ? allowed.get(path.slice(7)) : undefined;
  if (!file || !existsSync(file)) { response.writeHead(404); response.end('Export not available'); return; }
  const size = statSync(file).size;
  const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Number(match[2]) : size - 1;
  if (start > end || end >= size) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }); response.end(); return; }
  response.writeHead(match ? 206 : 200, {
    'Content-Type': 'video/mp4', 'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
    ...(match ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file, { start, end }).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Local review: http://127.0.0.1:${port}`));
