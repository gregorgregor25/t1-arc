import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { FORMATS,FPS,DURATION } from './timeline.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=resolve(root,'output/v3'),run=promisify(execFile);
const ffmpeg=process.env.T1ARC_PROMO_FFMPEG??'ffmpeg';
const ffprobe=process.env.T1ARC_PROMO_FFPROBE??'ffprobe';
const exec=(program,args)=>run(program,args,{windowsHide:true,maxBuffer:8*1024*1024});
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
const verification=[];
for(const [format,spec] of Object.entries(FORMATS)) {
  const folder=resolve(out,format),review=resolve(folder,'review');await mkdir(review,{recursive:true});
  for(const quality of ['4K','1080p']) {
    const file=resolve(folder,`T1-Arc-Cinematic-Sample-${format}-${quality}.mp4`);
    const metadata=JSON.parse((await exec(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',file])).stdout);
    const videos=metadata.streams.filter(s=>s.codec_type==='video'),audios=metadata.streams.filter(s=>s.codec_type==='audio');
    assert.equal(videos.length,1);assert.equal(audios.length,1);assert.equal(metadata.streams.length,2);
    const video=videos[0],audio=audios[0],divisor=quality==='4K'?1:2;
    assert.equal(video.width,spec.width/divisor);assert.equal(video.height,spec.height/divisor);
    assert.equal(video.codec_name,'h264');assert.equal(video.pix_fmt,'yuv420p');assert.equal(video.sample_aspect_ratio,'1:1');
    assert.equal(video.r_frame_rate,`${FPS}/1`);assert.equal(Number(video.nb_read_frames),FPS*DURATION);
    assert.ok(Math.abs(Number(metadata.format.duration)-DURATION)<.05);
    assert.equal(video.color_space,'bt709');assert.equal(video.color_primaries,'bt709');assert.equal(video.color_transfer,'bt709');
    assert.equal(audio.codec_name,'aac');assert.equal(Number(audio.sample_rate),48000);assert.equal(audio.channels,2);
    assert.ok(Math.abs(Number(audio.duration)-DURATION)<.05);
    const data=await readFile(file);const moov=data.indexOf(Buffer.from('moov')),mdat=data.indexOf(Buffer.from('mdat'));
    assert.ok(moov>=0&&mdat>moov,'Fast start index');
    await exec(ffmpeg,['-v','error','-xerror','-i',file,'-f','null','-']);
    const audioAnalysis=(await exec(ffmpeg,['-hide_banner','-i',file,'-vn','-af','volumedetect','-f','null','-'])).stderr;
    const peak=Number(audioAnalysis.match(/max_volume: (-?[\d.]+) dB/)?.[1]);assert.ok(Number.isFinite(peak)&&peak<-1);
    verification.push({format,quality,file,width:video.width,height:video.height,durationSeconds:Number(metadata.format.duration),fps:FPS,frames:Number(video.nb_read_frames),bytes:(await stat(file)).size,sha256:await hash(file),fullDecode:'passed',fastStart:true,audio:'Original music only; narration pending approval',audioPeakDb:peak});
    if(quality==='4K') {
      await exec(ffmpeg,['-v','error','-y','-i',file,'-vf',`fps=1,scale=${format==='landscape'?'480:270':'270:480'},tile=4x3`,'-frames:v','1',resolve(review,'contact-sheet.png')]);
      for(const [name,t] of [['reveal',1.8],['approach',4.5],['reading',8]]) {
        await exec(ffmpeg,['-v','error','-y','-ss',String(t),'-i',file,'-frames:v','1',resolve(review,`${name}.png`)]);
      }
      await exec(ffmpeg,['-v','error','-y','-ss','8','-i',file,'-vf',`scale=${format==='portrait'?'390:960':'960:540'}:flags=lanczos`,'-frames:v','1',resolve(review,'normal-viewing-size.png')]);
    }
    console.log(`${format}/${quality}: ${FPS*DURATION} frames, full decode and audio checks passed.`);
  }
}
const previous=JSON.parse(await readFile(resolve(root,'output/v2/verification.json'),'utf8'));
for(const entry of previous)assert.equal(await hash(entry.file),entry.sha256,'Original V2 export unchanged');
await writeFile(resolve(out,'verification.json'),JSON.stringify({files:verification,v2Preserved:true,visualReview:'Pending review of encoded samples and contact sheets'},null,2));
