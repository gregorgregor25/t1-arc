import test from 'node:test';
import assert from 'node:assert/strict';
import { stateAt,ease,FPS,DURATION,FORMATS,validateManifest } from './timeline.mjs';
import { allowedPath } from './server.mjs';
import { composeScore } from './score.mjs';
import * as THREE from 'three';
import { createStudioPhone } from './phone.mjs';
import { locateScene,filmStateAt,visualKey,validateFilm } from './film-timeline.mjs';

test('native 4K format pair and 720-frame sample',()=>{
  assert.deepEqual(FORMATS.landscape,{width:3840,height:2160});assert.deepEqual(FORMATS.portrait,{width:2160,height:3840});assert.equal(FPS*DURATION,720);
});
test('camera is continuous and reading hold is genuinely still in both formats',()=>{
  for(const portrait of [false,true]) {
    const a=stateAt(6.3,portrait),b=stateAt(11,portrait);
    assert.deepEqual(a.camera,b.camera);assert.deepEqual(a.target,b.target);assert.deepEqual(a.rotation,b.rotation);
    assert.equal(a.glassOpacity,0);assert.ok(Math.abs(a.rotation[1])<.05);
    let previous=stateAt(0,portrait);
    for(let frame=1;frame<720;frame++) {
      const next=stateAt(frame/60,portrait);assert.ok(next.camera.every(Number.isFinite));
      assert.ok(Math.abs(next.camera[2]-previous.camera[2])<.1);assert.ok(Math.abs(next.rotation[1]-previous.rotation[1])<.02);previous=next;
    }
  }
});
test('screen content uses recorded frames, then freezes at one second',()=>{
  assert.equal(stateAt(.5).sourceSeconds,.5);assert.equal(stateAt(2).sourceSeconds,1);assert.equal(stateAt(11).sourceSeconds,1);
});
test('easing is bounded, monotone and has gentle endpoints',()=>{
  assert.equal(ease(-1),0);assert.equal(ease(2),1);assert.ok(ease(.01)<.00002);
  for(let i=1;i<=100;i++)assert.ok(ease(i/100)>=ease((i-1)/100));
});
test('local preview does not expose raw recordings, secrets or traversal',()=>{
  for(const path of ['../.env','media/../../.env','media\\frame-001.png','media/raw.mp4','.qa/capture.xml','sample.json/../.env'])assert.equal(allowedPath(path),null);
  assert.ok(allowedPath('media/frame-001.png'));assert.ok(allowedPath('sample.json'));
});
test('original music has exact stereo duration and safe headroom',()=>{
  const {buffer,report}=composeScore();assert.equal(buffer.length,44+12*48000*4);assert.equal(buffer.toString('ascii',0,4),'RIFF');
  assert.ok(report.peakDb<-6);assert.ok(report.rmsDb>-40);assert.ok(Number.isFinite(report.rmsDb));
});
test('sample requires approval and cannot silently include paid narration',()=>{
  const base={approvedRealCaptures:true,duration:12,source:'capture.mp4',copy:{title:'T1 Arc'},narration:{status:'pending-approval'}};
  assert.equal(validateManifest(base),base);
  assert.throws(()=>validateManifest({...base,approvedRealCaptures:false}));assert.throws(()=>validateManifest({...base,duration:90}));
  assert.throws(()=>validateManifest({...base,narration:{status:'generated'}}));
});

test('original phone geometry is finite and preserves screen texture coordinates',()=>{
  const texture=new THREE.Texture(),phone=createStudioPhone(texture);
  assert.equal(phone.screen.material.map,texture);assert.equal(phone.screen.material.toneMapped,false);
  phone.group.traverse(object=>{
    if(!object.isMesh)return;
    for(const name of ['position','normal'])assert.ok(Array.from(object.geometry.attributes[name].array).every(Number.isFinite));
  });
  const uv=phone.screen.geometry.attributes.uv.array;assert.ok(Math.min(...uv)>=-.00001);assert.ok(Math.max(...uv)<=1.00001);
});

test('question, answer headline and evidence-strength label fit inside both close-ups',()=>{
  for(const [format,spec] of Object.entries(FORMATS)) {
    const s=stateAt(8,format==='portrait'),phone=createStudioPhone(new THREE.Texture());
    phone.group.position.fromArray(s.position);phone.group.rotation.set(...s.rotation);phone.group.updateMatrixWorld(true);
    const camera=new THREE.PerspectiveCamera(30,spec.width/spec.height,.1,100);camera.position.fromArray(s.camera);camera.lookAt(...s.target);camera.updateMatrixWorld(true);
    // Bounds of important recorded text in the padded 1080 x 2400 texture.
    for(const x of [150,1020])for(const y of [160,650]) {
      const point=new THREE.Vector3((x/1080-.5)*2.94,(.5-y/2400)*6.533333,.233);
      point.applyMatrix4(phone.group.matrixWorld).project(camera);
      assert.ok(point.x>-.98&&point.x<.98&&point.y>-.98&&point.y<.98,`${format}: important text clipped`);
    }
  }
});

test('full film uses exact scene boundaries and held source frames without lost output time',()=>{
  const film={duration:12,scenes:[{id:'first',start:0,duration:6,frameLookup:[1],focus:'top'},{id:'second',start:6,duration:6,frameLookup:[1,2],focus:'whole'}]};
  assert.equal(locateScene(film,5.99).index,0);assert.equal(locateScene(film,6).index,1);assert.equal(locateScene(film,12).index,1);
  assert.equal(filmStateAt(film,5).sourceFrame,1);assert.equal(filmStateAt(film,10).sourceFrame,2);
  assert.equal(visualKey(filmStateAt(film,2)),visualKey(filmStateAt(film,3)));
  assert.notEqual(visualKey(filmStateAt(film,1)),visualKey(filmStateAt(film,2)));
});

test('full render cannot proceed without visual approval or with unexpected audio',()=>{
  const film={approvedRealCaptures:true,visualApproved:true,audio:'deferred',duration:4,scenes:[{id:'ask',start:0,duration:4,focus:'whole',frameLookup:[1,2]}]};
  assert.equal(validateFilm(film),film);
  for(const change of [{visualApproved:false},{approvedRealCaptures:false},{audio:'score'},{duration:5}])assert.throws(()=>validateFilm({...film,...change}));
  for(const change of [{id:'../raw'},{start:1},{duration:4.001},{focus:'unknown'},{frameLookup:[]},{frameLookup:[0]},{frameLookup:[NaN]}])assert.throws(()=>validateFilm({...film,scenes:[{...film.scenes[0],...change}]}));
});
