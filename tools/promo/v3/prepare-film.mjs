import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {validateEdit} from '../v2/edit.mjs';
import {validateFilm} from './film-timeline.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),out=resolve(root,'output/v3');
const run=promisify(execFile),ffmpeg=process.env.T1ARC_PROMO_FFMPEG??'ffmpeg';
const previous=validateEdit(JSON.parse(await readFile(resolve(root,'output/v2/edit.json'),'utf8')));
if(previous.approvedRealCaptures!==true)throw new Error('Owner-approved recording provenance missing');
const approval=JSON.parse(await readFile(resolve(out,'film-approval.json'),'utf8'));
if(approval.visualApproved!==true||approval.audio!=='deferred')throw new Error('Visual approval and deferred audio required');
const focuses={opening:'whole',ask:'whole',answer:'top',evidence:'whole',followup:'middle',today:'top',history:'whole',health:'whole',sleep:'whole',food:'whole',portion:'middle',closing:'whole'};
const titles={opening:'Your data.\nA clearer picture.',ask:'Start with\nyour question.',answer:'Ask Tarv1s.\nSee the context.',evidence:'See what\nwent into it.',followup:'Keep asking.',today:'Your day.\nTogether.',history:'Look back.\nSee more.',health:'More than\nglucose.',sleep:'A closer look\nat your sleep.',food:'Find your food.',portion:'Make it\nyour portion.',closing:'T1 Arc.\nMeet Tarv1s.'};
const film={approvedRealCaptures:true,visualApproved:true,audio:'deferred',approval:approval.note,sourceCaptureWidth:1080,fps:60,duration:0,scenes:[]};
await mkdir(resolve(out,'film-assets'),{recursive:true});
for(const input of previous.scenes) {
  const s={...input,start:film.duration,focus:focuses[input.id],title:titles[input.id]};
  const hero=s.kind==='hero';
  const source=resolve(root,s.source);
  const extraction=await run(ffmpeg,['-v','error','-y','-progress','pipe:1','-nostats','-ss',String(hero?(s.posterTime??s.in):s.in),'-i',source,'-t',String(s.duration),'-vf','fps=30,crop=1080:2124:0:162,pad=1080:2400:0:138:color=0x101218',...(hero?['-frames:v','1']:[]),resolve(out,`film-assets/${s.id}-%05d.png`)],{windowsHide:true,maxBuffer:2*1024*1024});
  // Re-preparing a shorter edit must not pull in leftover frames from an older cut.
  const count=Number([...extraction.stdout.matchAll(/^frame=\s*(\d+)/gm)].at(-1)?.[1]);
  if(!Number.isInteger(count)||count<1)throw new Error(`No freshly extracted frames for ${s.id}`);
  const names=Array.from({length:count},(_,i)=>`${s.id}-${String(i+1).padStart(5,'0')}.png`);
  if(!names.length)throw new Error(`No frames for ${s.id}`);
  const hashes=new Map();s.frameLookup=[];
  for(let i=0;i<names.length;i++) {
    const hash=createHash('sha256').update(await readFile(resolve(out,'film-assets',names[i]))).digest('hex');
    if(!hashes.has(hash))hashes.set(hash,i+1);s.frameLookup.push(hashes.get(hash));
  }
  s.uniqueFrames=hashes.size;s.sourceSha256=createHash('sha256').update(await readFile(source)).digest('hex');
  s.detail=s.id==='closing'?'github.com/gregorgregor25/t1-arc':(s.portraitDetail??s.detail);
  if(s.id==='ask')s.detail='Use your own OpenAI API key.';
  if(s.id==='answer')s.detail='Patterns in your records, not proof of cause.';
  if(s.id==='portion')s.detail='Review the amount and nutrition before saving.';
  if(s.id==='closing')s.eyebrow='YOUR RECORDS. YOUR QUESTIONS.';
  film.scenes.push(s);film.duration+=s.duration;
  console.log(`${s.id}: ${names.length} source frames, ${s.uniqueFrames} unique, ${s.duration}s`);
}
await writeFile(resolve(out,'film.json'),JSON.stringify(validateFilm(film),null,2));
console.log(`Prepared ${film.duration}s silent film. No new phone access or hosted requests.`);
