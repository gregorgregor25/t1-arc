import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {once} from 'node:events';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {startServer} from './server.mjs';
import {FORMATS,FPS} from './timeline.mjs';
import {filmStateAt,visualKey,validateFilm} from './film-timeline.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),out=resolve(root,'output/v3');
const args=new Set(process.argv.slice(2)),portrait=args.has('--portrait');
const format=portrait?'portrait':'landscape',spec=FORMATS[format],folder=resolve(out,'film',format);
const film=validateFilm(JSON.parse(await readFile(resolve(out,'film.json'),'utf8')));
if(!film.visualApproved||film.audio!=='deferred'||!film.approvedRealCaptures)throw new Error('Approved silent film manifest required');
await mkdir(folder,{recursive:true});
const ffmpeg=process.env.T1ARC_PROMO_FFMPEG??'ffmpeg',run=promisify(execFile);
const exec=(command,argv)=>run(command,argv,{windowsHide:true,maxBuffer:8*1024*1024});
const {server,url}=await startServer(0);let browser,encoder;const errors=[],report=[],started=Date.now();
const encode=['-an','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-r',String(FPS),'-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart'];
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.T1ARC_PROMO_BROWSER??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',args:['--use-angle=d3d11']});
  const page=await browser.newPage({viewport:{...spec},deviceScaleFactor:1});
  await page.route('**/*',route=>route.request().url().startsWith(url+'/')||route.request().url().startsWith('data:')?route.continue():route.abort());
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`${url}/?format=${format}&capture=1&film=1`,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.T1ArcV3?.ready);
  const diagnostics=await page.evaluate(()=>window.T1ArcV3.diagnostics());
  if(diagnostics.width!==spec.width||diagnostics.height!==spec.height)throw new Error('Native 4K render dimensions required');
  console.log(JSON.stringify(diagnostics));
  for(const scene of film.scenes) {
    await page.evaluate(t=>window.T1ArcV3.render(t),scene.start+Math.min(2,scene.duration/2));
    await page.screenshot({path:resolve(folder,`${scene.id}-preview.png`)});
    const segment=resolve(folder,`${scene.id}.mp4`);let captures=0;
    if(!args.has('--stills')) {
      encoder=spawn(ffmpeg,['-v','error','-y','-f','image2pipe','-framerate',String(FPS),'-i','pipe:0','-vf','scale=out_color_matrix=bt709:out_range=tv,setsar=1',...encode,segment],{stdio:['pipe','ignore','pipe'],windowsHide:true});
      let stderr='';encoder.stderr.on('data',x=>{stderr+=x;});encoder.stdin.on('error',()=>{});const closed=once(encoder,'close');await once(encoder,'spawn');
      let lastKey,lastPng;
      for(let frame=0;frame<scene.duration*FPS;frame++) {
        const t=scene.start+frame/FPS,key=visualKey(filmStateAt(film,t,portrait));
        if(key!==lastKey){await page.evaluate(t=>window.T1ArcV3.render(t),t);lastPng=await page.screenshot();lastKey=key;captures++;}
        await new Promise((yes,no)=>encoder.stdin.write(lastPng,e=>e?no(e):yes()));
        if(frame%120===0)console.log(`${format}/${scene.id}: ${frame}/${scene.duration*FPS}; ${Math.round((Date.now()-started)/1000)}s elapsed`);
      }
      encoder.stdin.end();const [code]=await closed;encoder=null;if(code!==0)throw new Error(stderr);
    }
    report.push({id:scene.id,start:scene.start,duration:scene.duration,frames:scene.duration*FPS,captures,sourceSha256:scene.sourceSha256,sourceUniqueFrames:scene.uniqueFrames});
    console.log(`${format}: ${scene.id} ${args.has('--stills')?'preview':'complete'}`);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  if(!args.has('--stills')) {
    const concat=resolve(folder,'concat.txt');await writeFile(concat,film.scenes.map(s=>`file '${s.id}.mp4'`).join('\n')+'\n');
    const master=resolve(folder,`T1-Arc-Cinematic-${format}-4K-silent.mp4`);
    await exec(ffmpeg,['-v','error','-y','-f','concat','-safe','0','-i',concat,'-map','0:v:0','-c:v','copy','-an','-movflags','+faststart',master]);
    await exec(ffmpeg,['-v','error','-y','-i',master,'-vf',`scale=${spec.width/2}:${spec.height/2}:flags=lanczos,setsar=1`,'-map','0:v:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',resolve(folder,`T1-Arc-Cinematic-${format}-1080p-silent.mp4`)]);
  }
  await writeFile(resolve(folder,'render.json'),JSON.stringify({format,...spec,fps:FPS,duration:film.duration,stillsOnly:args.has('--stills'),elapsedSeconds:(Date.now()-started)/1000,browserErrors:errors,diagnostics,scenes:report,manifestSha256:createHash('sha256').update(await readFile(resolve(out,'film.json'))).digest('hex'),audio:'None. Music and narration deferred by owner.'},null,2));
}finally {
  if(encoder){encoder.stdin.destroy();encoder.kill();}if(browser)await browser.close();await new Promise(yes=>server.close(yes));
}
