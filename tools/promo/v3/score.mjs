import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 48000;
const tau = Math.PI * 2;
const note = midi => 440 * 2 ** ((midi - 69) / 12);
const smooth = x => {const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};

// An original, deterministic instrumental cue. No samples, borrowed recordings
// or third-party music. Sine-partial synthesis keeps the upper range gentle.
export function composeScore(duration = 12) {
  const samples = Math.round(duration * SAMPLE_RATE);
  const output = Buffer.alloc(44 + samples * 4);
  output.write('RIFF');output.writeUInt32LE(output.length-8,4);output.write('WAVE',8);
  output.write('fmt ',12);output.writeUInt32LE(16,16);output.writeUInt16LE(1,20);
  output.writeUInt16LE(2,22);output.writeUInt32LE(SAMPLE_RATE,24);output.writeUInt32LE(SAMPLE_RATE*4,28);
  output.writeUInt16LE(4,32);output.writeUInt16LE(16,34);output.write('data',36);output.writeUInt32LE(samples*4,40);
  const events = [[.65,69],[2.15,76],[3.275,71],[4.4,73],[6.65,68],[8.15,73],[9.65,76]];
  let peak=0,sum=0;
  for(let i=0;i<samples;i++) {
    const t=i/SAMPLE_RATE;
    const chordBlend=smooth((t-5.1)/2.2);
    const fade=smooth(t/.7)*(1-smooth((t-(duration-1.5))/1.5));
    let left=0,right=0;
    for(let j=0;j<4;j++) {
      const a=[57,64,68,71][j],b=[54,61,64,68][j];
      const env=.018*(1+.12*Math.sin(tau*.11*t+j));
      for(const [midi,blend] of [[a,1-chordBlend],[b,chordBlend]]) {
        const f=note(midi);left+=env*blend*(Math.sin(tau*f*t)+.15*Math.sin(tau*f*2*t));
        right+=env*blend*(Math.sin(tau*f*1.0007*t+.2)+.15*Math.sin(tau*f*2.0003*t));
      }
    }
    for(const [when,midi] of events) {
      const dt=t-when;if(dt<0||dt>4)continue;
      const f=note(midi),env=.052*(1-Math.exp(-dt*60))*Math.exp(-dt*1.45);
      const mallet=env*(Math.sin(tau*f*dt)+.3*Math.sin(tau*f*2*dt)*Math.exp(-dt*4));
      left+=mallet;right+=mallet*.85;
      // A quiet stereo reflection, derived from the original note.
      if(dt>.19) right+=.012*Math.sin(tau*f*(dt-.19))*Math.exp(-(dt-.19)*1.6)*(1-Math.exp(-(dt-.19)*40));
    }
    const pulse=t%.75,root=t<6?55:46.2493;
    const bass=.045*Math.sin(tau*root*t)*Math.exp(-pulse*5)*smooth(pulse/.03);
    // A low, softly swelling texture accompanies the camera approach.
    const swell=.012*Math.exp(-(((t-4.4)/.85)**2))*(Math.sin(tau*174*t)+Math.sin(tau*233.1*t));
    left=(left+bass+swell)*fade;right=(right+bass+swell*.9)*fade;
    for(const [channel,value] of [[0,left],[1,right]]) {
      const safe=Math.tanh(value*1.55)*1.6;peak=Math.max(peak,Math.abs(safe));sum+=safe*safe;
      output.writeInt16LE(Math.round(safe*32767),44+i*4+channel*2);
    }
  }
  return {buffer:output,report:{duration,sampleRate:SAMPLE_RATE,channels:2,peakDb:20*Math.log10(peak),rmsDb:10*Math.log10(sum/(samples*2)),provenance:'Original procedural composition; no third-party audio.'}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=composeScore();const path=fileURLToPath(new URL('../output/v3/assets/score.wav',import.meta.url));
  await writeFile(path,result.buffer);
  await writeFile(fileURLToPath(new URL('../output/v3/score.json',import.meta.url)),JSON.stringify(result.report,null,2));
  console.log(JSON.stringify(result.report,null,2));
}
