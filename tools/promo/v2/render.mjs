import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { startServer } from './server.mjs';
import { validateEdit, FPS, FORMATS, durationOf } from './edit.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'output/v2');
const args = new Set(process.argv.slice(2));
const format = args.has('--portrait') ? 'portrait' : 'landscape';
const spec = FORMATS[format];
const folder = resolve(out, format);
const edit = validateEdit(JSON.parse(await readFile(resolve(out, 'edit.json'), 'utf8')));
const ffmpeg = process.env.T1ARC_PROMO_FFMPEG ?? 'ffmpeg';
const encodeOptions = ['-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r',String(FPS),'-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart'];
const exec = (program, argv) => run(program, argv, { windowsHide: true, maxBuffer: 4*1024*1024 });
await mkdir(folder, {recursive:true});await mkdir(resolve(out,'assets'), {recursive:true});

// The private edit manifest is the only place containing personal captions and paths.
// Remove OS bars from all footage before anything is served by the preview server.
for (const s of args.has('--skip-prep') ? [] : edit.scenes) {
  const source = resolve(root, s.source);
  await exec(ffmpeg,['-v','error','-y','-ss',String(s.posterTime ?? s.in),'-i',source,'-vf','crop=1080:2124:0:162','-frames:v','1',resolve(out,'assets',`${s.id}.png`)]);
  await exec(ffmpeg,['-v','error','-y','-i',resolve(out,'assets',`${s.id}.png`),'-vf','pad=1080:2400:0:138:color=0x101218','-frames:v','1',resolve(out,'assets',`${s.id}-device.png`)]);
}
const {server,url}=await startServer(0);
let browser;
const reports=[];const errors=[];
try {
  // Isolated offline media renderer, no existing Chrome profile or user browser session.
  browser=await chromium.launch({headless:true,executablePath:process.env.T1ARC_PROMO_BROWSER??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  const page=await browser.newPage({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:1});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/*',route=>route.request().url().startsWith(url+'/')||route.request().url().startsWith('data:')?route.continue():route.abort());
  for(let i=0;i<edit.scenes.length;i++){
    const s=edit.scenes[i];
    await page.goto(`${url}/?format=${format}&scene=${i}&capture=1`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.T1ArcV2?.ready);
    await page.screenshot({path:resolve(folder,`${s.id}-preview.png`)});
    const layout=await page.evaluate(()=>window.T1ArcV2.layout());
    if(layout.copy.y+layout.copy.height>spec.height-(format==='portrait'?1480:125) && s.kind!=='hero'){
      // Portrait only has a short headline area; landscape copy must clear the footer.
      throw new Error(`Caption overflow in ${format}/${s.id}: ${JSON.stringify(layout.copy)}`);
    }
    const segment=resolve(folder,`${String(i).padStart(2,'0')}-${s.id}.mp4`);
    if(!args.has('--stills')){
      if(s.kind==='hero'){
        const encoder=spawn(ffmpeg,['-v','error','-y','-f','image2pipe','-framerate',String(FPS),'-i','pipe:0','-vf','scale=out_color_matrix=bt709:out_range=tv,setsar=1',...encodeOptions,segment],{stdio:['pipe','ignore','pipe'],windowsHide:true});
        let err='';encoder.stderr.on('data',c=>{err+=c;});encoder.stdin.on('error',()=>{});
        const closed=once(encoder,'close');await once(encoder,'spawn');
        for(let frame=0;frame<s.duration*FPS;frame++){
          await page.evaluate(t=>window.T1ArcV2.render(t),frame/FPS);
          const png=await page.screenshot();
          await new Promise((yes,no)=>encoder.stdin.write(png,e=>e?no(e):yes()));
        }
        encoder.stdin.end();const [code]=await closed;if(code!==0)throw new Error(err);
      }else if(!args.has('--reuse-workflows')){
        await page.goto(`${url}/?format=${format}&scene=${i}&capture=1&layer=background`,{waitUntil:'networkidle'});
        await page.waitForFunction(()=>window.T1ArcV2?.ready);
        const background=resolve(folder,`${s.id}-background.png`);await page.screenshot({path:background});
        const mask=await page.evaluate(()=>window.T1ArcV2.mask());
        const maskPath=resolve(folder,'screen-mask.png');await writeFile(maskPath,Buffer.from(mask.split(',')[1],'base64'));
        const r=spec.screen;
        const filters=`[1:v]trim=duration=${s.sourceDuration??s.duration},setpts=PTS-STARTPTS,fps=${FPS},crop=1080:2124:0:162,scale=${r.width}:${r.height}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=${s.duration}[screen];[screen][2:v]alphamerge[masked];[0:v][masked]overlay=${r.x}:${r.y}:shortest=1,scale=out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p[out]`;
        await exec(ffmpeg,['-v','error','-y','-loop','1','-framerate',String(FPS),'-i',background,'-ss',String(s.in),'-i',resolve(root,s.source),'-loop','1','-framerate',String(FPS),'-i',maskPath,'-filter_complex',filters,'-map','[out]','-t',String(s.duration),...encodeOptions,segment]);
      }
    }
    reports.push({id:s.id,duration:s.duration,layout});console.log(`${format}: ${i+1}/${edit.scenes.length} ${s.id}`);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  if(!args.has('--stills')){
    const concat=resolve(folder,'concat.txt');
    await writeFile(concat,edit.scenes.map((s,i)=>`file '${String(i).padStart(2,'0')}-${s.id}.mp4'`).join('\n')+'\n');
    // One final encode fixes the stream parameters across 3D and captured scenes.
    await exec(ffmpeg,['-v','error','-y','-f','concat','-safe','0','-i',concat,'-map','0:v:0','-vf','scale=out_color_matrix=bt709:out_range=tv,setsar=1',...encodeOptions,resolve(folder,`T1-Arc-A-Closer-Look-${format}.mp4`)]);
  }
  await writeFile(resolve(folder,'render.json'),JSON.stringify({format,...spec,duration:durationOf(edit),fps:FPS,stillsOnly:args.has('--stills'),browserErrors:errors,scenes:reports},null,2));
}finally{if(browser)await browser.close();await new Promise(yes=>server.close(yes));}
