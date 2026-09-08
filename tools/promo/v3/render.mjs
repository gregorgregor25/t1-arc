import { chromium } from 'playwright-core';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { startServer } from './server.mjs';
import { FORMATS,FPS,DURATION,validateManifest } from './timeline.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=resolve(root,'output/v3');const args=new Set(process.argv.slice(2));
const format=args.has('--portrait')?'portrait':'landscape',spec=FORMATS[format];
const folder=resolve(out,format);const ffmpeg=process.env.T1ARC_PROMO_FFMPEG??'ffmpeg';
const run=promisify(execFile);const exec=(program,argv)=>run(program,argv,{windowsHide:true,maxBuffer:4*1024*1024});
const manifest=validateManifest(JSON.parse(await readFile(resolve(out,'sample.json'),'utf8')));
await mkdir(folder,{recursive:true});await mkdir(resolve(out,'assets'),{recursive:true});
if(!args.has('--skip-prep')) {
  await exec(ffmpeg,['-v','error','-y','-ss',String(manifest.sourceIn),'-i',resolve(root,manifest.source),'-vf',`fps=30,crop=${manifest.sourceCrop},pad=1080:2400:0:138:color=0x101218`,'-frames:v','31',resolve(out,'assets/frame-%03d.png')]);
}
const {server,url}=await startServer(0);let browser,encoder;
const errors=[],started=Date.now();
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.T1ARC_PROMO_BROWSER??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--use-angle=d3d11']});
  const page=await browser.newPage({viewport:{...spec},deviceScaleFactor:1});
  await page.route('**/*',route=>route.request().url().startsWith(url+'/')||route.request().url().startsWith('data:')?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${url}/?format=${format}&capture=1`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.T1ArcV3?.ready,{},{timeout:60000});
  const diagnostics=await page.evaluate(()=>window.T1ArcV3.diagnostics());console.log(JSON.stringify(diagnostics));
  if(diagnostics.width!==spec.width||diagnostics.height!==spec.height)throw new Error('Native render resolution mismatch');
  for(const t of [0,1.8,4.5,6.3,8,11]) {
    await page.evaluate(t=>window.T1ArcV3.render(t),t);
    await page.screenshot({path:resolve(folder,`frame-${String(t).replace('.','_')}.png`)});
  }
  if(!args.has('--stills')) {
    const silent=resolve(folder,'sample-picture.mp4');
    encoder=spawn(ffmpeg,['-v','error','-y','-f','image2pipe','-framerate',String(FPS),'-i','pipe:0','-vf','scale=out_color_matrix=bt709:out_range=tv,setsar=1','-an','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-r',String(FPS),'-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart',silent],{stdio:['pipe','ignore','pipe'],windowsHide:true});
    let stderr='';encoder.stderr.on('data',x=>{stderr+=x;});encoder.stdin.on('error',()=>{});const closed=once(encoder,'close');await once(encoder,'spawn');
    let readingFrame;
    for(let frame=0;frame<DURATION*FPS;frame++) {
      const time=frame/FPS;
      // All visual state is constant in this interval. Reuse identical pixels,
      // while still encoding every output frame and maintaining the full hold.
      const stable=time>=6.2&&time<11.45;
      let png;
      if(stable&&readingFrame)png=readingFrame;
      else {
        await page.evaluate(t=>window.T1ArcV3.render(t),time);
        png=await page.screenshot();if(stable)readingFrame=png;
      }
      await new Promise((yes,no)=>encoder.stdin.write(png,e=>e?no(e):yes()));
      if(frame%60===0)console.log(`${format}: ${frame}/${DURATION*FPS} frames; ${Math.round((Date.now()-started)/1000)}s elapsed`);
    }
    encoder.stdin.end();const [code]=await closed;encoder=null;if(code!==0)throw new Error(stderr);
    const master=resolve(folder,`T1-Arc-Cinematic-Sample-${format}-4K-silent.mp4`);
    await exec(ffmpeg,['-v','error','-y','-i',silent,'-map','0:v:0','-c:v','copy','-an','-t',String(DURATION),'-movflags','+faststart',master]);
    await exec(ffmpeg,['-v','error','-y','-i',master,'-vf',`scale=${spec.width/2}:${spec.height/2}:flags=lanczos,setsar=1`,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-an','-movflags','+faststart',resolve(folder,`T1-Arc-Cinematic-Sample-${format}-1080p-silent.mp4`)]);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  await writeFile(resolve(folder,'render.json'),JSON.stringify({format,...spec,fps:FPS,duration:DURATION,stillsOnly:args.has('--stills'),elapsedSeconds:(Date.now()-started)/1000,diagnostics,browserErrors:errors,sourceSha256:createHash('sha256').update(await readFile(resolve(root,manifest.source))).digest('hex'),narration:'Not generated or included; pending separate approval'},null,2));
} finally {
  if(encoder){encoder.stdin.destroy();encoder.kill();}
  if(browser)await browser.close();await new Promise(yes=>server.close(yes));
}
