import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createStudioPhone } from './phone.mjs';
import { stateAt, FORMATS, DURATION } from './timeline.mjs';
import { filmStateAt } from './film-timeline.mjs';

const params = new URLSearchParams(location.search);
const fullFilm = params.has('film');
const film = fullFilm ? await (await fetch('/film.json')).json() : null;
const duration = film?.duration ?? DURATION;
const portrait = params.get('format') === 'portrait';
const spec = FORMATS[portrait?'portrait':'landscape'];
document.body.classList.toggle('portrait',portrait);
document.body.classList.toggle('capture',params.has('capture'));
const manifest = await (await fetch('/sample.json')).json();
document.querySelector('#intro-title').textContent = manifest.copy.intro;
document.querySelector('#reading-title').textContent = manifest.copy.reading;
document.querySelector('#reading-detail').textContent = manifest.copy.detail;
const stage = document.querySelector('#stage');
function fit() { stage.style.transform=`translate(-50%,-50%) scale(${Math.min(innerWidth/spec.width,innerHeight/spec.height)})`; }
addEventListener('resize',fit);fit();
const renderer = new THREE.WebGLRenderer({canvas:document.querySelector('#studio'),antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
const resolution = params.has('capture') ? 1 : Math.min(1, Math.max(innerWidth/spec.width,innerHeight/spec.height)*devicePixelRatio);
renderer.setSize(Math.round(spec.width*resolution),Math.round(spec.height*resolution),false);
renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const world=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(30,spec.width/spec.height,.1,100);
const room=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(renderer);
const environment=pmrem.fromScene(room,.035).texture;world.environment=environment;world.environmentIntensity=.85;room.dispose();pmrem.dispose();
RectAreaLightUniformsLib.init();
for(const [color,intensity,w,h,x,y,z] of [['#f3f1ec',6,5,9,-4,4,7],['#a8b8ef',5,2,8,6,2,3],['#d4dbec',4,3,4,0,7,-3]]) {
  const light=new THREE.RectAreaLight(color,intensity,w,h);light.position.set(x,y,z);light.lookAt(1,0,0);world.add(light);
}
world.add(new THREE.HemisphereLight('#c1cce3','#06080c',.35));
const key=new THREE.SpotLight('#d9e0f4',65,40,.72,.85,2);key.position.set(-3,9,5);key.target.position.set(2,-3,0);
key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.bias=-.0003;key.shadow.normalBias=.04;key.shadow.radius=4;world.add(key,key.target);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({color:'#000000',opacity:.26}));floor.rotation.x=-Math.PI/2;floor.position.y=-4.55;floor.receiveShadow=true;world.add(floor);
const loader=new THREE.TextureLoader();
const textures=await Promise.all(Array.from({length:fullFilm?1:31},async(_,i)=>{const path=fullFilm?`/film/${film.scenes[0].id}-00001.png`:`/media/frame-${String(i+1).padStart(3,'0')}.png`;const t=await loader.loadAsync(path);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());return t;}));
const phone=createStudioPhone(textures[0]);world.add(phone.group);
const intro=document.querySelector('#intro'),reading=document.querySelector('#reading');
let time=0,playing=false,start=0,currentIndex=0;
const textureCache=new Map();
async function filmTexture(s) {
  const path=`/film/${s.scene.id}-${String(s.sourceFrame).padStart(5,'0')}.png`;
  if(textureCache.has(path))return textureCache.get(path);
  const texture=await loader.loadAsync(path);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(16,renderer.capabilities.getMaxAnisotropy());textureCache.set(path,texture);
  if(textureCache.size>8){const key=textureCache.keys().next().value;textureCache.get(key).dispose();textureCache.delete(key);}
  return texture;
}
async function render(seconds) {
  time=seconds;const s=fullFilm?filmStateAt(film,seconds,portrait):stateAt(seconds,portrait);
  camera.position.fromArray(s.camera);camera.lookAt(...s.target);
  phone.group.position.fromArray(s.position);phone.group.rotation.set(...s.rotation);
  phone.glass.material.opacity=s.glassOpacity;
  if(fullFilm) {
    currentIndex=s.index;phone.screen.material.map=await filmTexture(s);
    document.querySelector('#intro-title').textContent=s.scene.title;
    document.querySelector('#reading-title').textContent=s.scene.title;
    document.querySelector('#reading-detail').textContent=s.scene.detail;
    intro.querySelector('.eyebrow').textContent=s.scene.eyebrow;
    reading.querySelector('.eyebrow').textContent=s.scene.eyebrow;
    intro.style.opacity=s.scene.id==='opening'?s.opacity:0;
    reading.style.opacity=s.scene.id==='opening'?0:s.opacity;
  } else {
    phone.screen.material.map=textures[Math.min(30,Math.floor(s.sourceSeconds*30))];
    intro.style.opacity=s.introOpacity;reading.style.opacity=s.readingOpacity;
  }
  document.querySelector('#fade').style.opacity=1-s.endOpacity;
  document.querySelector('#time').textContent=`${seconds.toFixed(1)}s`;
  renderer.render(world,camera);
}
function pause(){playing=false;document.querySelector('#play').textContent=fullFilm?'Play film':'Play sample';}
document.querySelector('#play').onclick=async()=>{
  if(playing){pause();return;}time=0;
  playing=true;start=performance.now();document.querySelector('#play').textContent='Pause';
  const tick=async now=>{if(!playing)return;await render(Math.min(duration,(now-start)/1000));if(time>=duration){pause();return;}requestAnimationFrame(tick);};requestAnimationFrame(tick);
};
document.querySelector('#reveal').onclick=async()=>{pause();await render(fullFilm?film.scenes[currentIndex].start+.5:1.8);};
document.querySelector('#closeup').onclick=async()=>{pause();await render(fullFilm?film.scenes[currentIndex].start+2:8);};
if(fullFilm) {
  for(const [id,step] of [['previous-scene',-1],['next-scene',1]]) {
    const button=document.querySelector('#'+id);button.hidden=false;
    button.onclick=async()=>{pause();currentIndex=Math.max(0,Math.min(film.scenes.length-1,currentIndex+step));await render(film.scenes[currentIndex].start+2);};
  }
  document.querySelector('#play').textContent='Play film';
}
await document.fonts.ready;await render(1.8);
window.T1ArcV3={ready:true,render,diagnostics(){const gl=renderer.getContext();const info=gl.getExtension('WEBGL_debug_renderer_info');return {width:renderer.domElement.width,height:renderer.domElement.height,gpu:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):'unknown',textures:textures.length,time,phoneRotation:phone.group.rotation.toArray().slice(0,3),glassOpacity:phone.glass.material.opacity};}};
