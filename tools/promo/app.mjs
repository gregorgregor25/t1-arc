import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createPhone, createWatch } from './models.mjs';
import { chapterAt, CHAPTERS, DURATION, FACE_IDS, FACE_NAMES, smooth, clamp01, boundedTime } from './storyboard.mjs';

const query = new URLSearchParams(location.search);
const portrait = query.get('format') === 'portrait';
document.body.classList.toggle('portrait', portrait);
document.body.classList.toggle('capture', query.has('capture'));
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(33, innerWidth / innerHeight, .1, 100);
camera.position.set(0, .26, portrait ? 20.5 : 15.4);
camera.lookAt(0, 0, 0);
const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment, .04).texture;
scene.environmentIntensity = .55;
environment.dispose();
pmrem.dispose();
scene.add(new THREE.HemisphereLight('#c7e1ff', '#111923', 1.1));
const key = new THREE.DirectionalLight('#e1eeff', 2.8);
key.position.set(-4, 8, 8);
key.castShadow = false;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10 });
key.shadow.bias = -.0005;
key.shadow.normalBias = .02;
scene.add(key);
const edge = new THREE.DirectionalLight('#89b8e2', 1.8);
edge.position.set(6, 1, -2);
scene.add(edge);
// Soft studio contact shadows avoid hard, distracting silhouette projections.
const shadowCanvas = document.createElement('canvas');
shadowCanvas.width = shadowCanvas.height = 256;
const shadowContext = shadowCanvas.getContext('2d');
const gradient = shadowContext.createRadialGradient(128, 128, 0, 128, 128, 128);
gradient.addColorStop(0, 'rgba(0,0,0,.46)');
gradient.addColorStop(.4, 'rgba(0,0,0,.23)');
gradient.addColorStop(1, 'rgba(0,0,0,0)');
shadowContext.fillStyle = gradient;
shadowContext.fillRect(0, 0, 256, 256);
const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
function contactShadow(width) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, .62),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  mesh.position.z = -.35;
  scene.add(mesh);
  return mesh;
}
const phoneShadow = contactShadow(5);
const watchShadows = Array.from({ length: 5 }, () => contactShadow(3.4));

const loader = new THREE.TextureLoader();
const load = async name => {
  const texture = await loader.loadAsync(`assets/${name}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
};
const [tarv1s, today, history, food, health, ...faces] = await Promise.all([
  'tarv1s', 'today', 'history', 'food', 'health', ...FACE_IDS,
].map(load));
const screens = { tarv1s, today, history, food, health };
const phone = createPhone(tarv1s);
scene.add(phone.group);
const watchStyles = [
  { metal: '#8095a8', strap: '#152332' }, { metal: '#b29565', strap: '#16191d' },
  { metal: '#a8b4c2', strap: '#18212b' }, { metal: '#687d88', strap: '#18221f' },
  { metal: '#8c8171', strap: '#25251f' },
];
const watches = faces.map((texture, index) => createWatch(texture, watchStyles[index]));
watches.forEach(watch => scene.add(watch.group));

const copy = document.querySelector('#copy');
const eyebrow = document.querySelector('#eyebrow');
const headline = document.querySelector('#headline');
const detail = document.querySelector('#detail');
const note = document.querySelector('#note');
const names = document.querySelector('#face-names');
const progress = document.querySelector('#progress');
let currentChapter = '';

const phonePose = id => {
  if (portrait) {
    if (id === 'watch' || id === 'collection') return { x: 8, y: -1.3, s: .92, ry: -.35, rz: -.07 };
    if (id === 'closing') return { x: -.72, y: -1.10, s: .91, ry: -.17, rz: -.065 };
    return { x: 0, y: -1.20, s: .94, ry: id === 'history' ? .15 : -.14, rz: id === 'food' ? -.025 : .02 };
  }
  if (id === 'history') return { x: -3.35, y: -.05, s: 1.0, ry: .25, rz: .045 };
  if (id === 'watch' || id === 'collection') return { x: 12, y: 0, s: .9, ry: -.55, rz: -.1 };
  if (id === 'closing') return { x: 2.35, y: .10, s: .96, ry: -.18, rz: -.075 };
  return { x: 3.45, y: .02, s: 1.0, ry: id === 'today' ? -.07 : -.24, rz: id === 'food' ? -.045 : -.025 };
};
const mix = (a, b, t) => a + (b - a) * t;
function setCopy(chapter) {
  if (chapter.id === currentChapter) return;
  currentChapter = chapter.id;
  eyebrow.textContent = chapter.eyebrow;
  const titles = portrait && chapter.id === 'collection' ? ['Five faces.', 'One clear glance.'] : chapter.title;
  headline.replaceChildren(...titles.map(line => Object.assign(document.createElement('span'), { textContent: line })));
  detail.replaceChildren(...chapter.detail.map(line => Object.assign(document.createElement('span'), { textContent: line })));
  copy.className = chapter.side;
  note.className = chapter.side;
  note.textContent = chapter.note;
}

export function renderAt(time) {
  const t = boundedTime(time);
  const chapter = chapterAt(t);
  const index = CHAPTERS.indexOf(chapter);
  const local = t - chapter.start;
  const previous = CHAPTERS[Math.max(0, index - 1)];
  setCopy(chapter);
  const entrance = smooth(local / 1.1);
  const exit = chapter.id === 'closing' ? 1 : smooth((chapter.end - t) / .42);
  const textAlpha = smooth((local - .35) / .75) * exit;
  copy.style.opacity = String(textAlpha);
  copy.style.transform = `translateY(${(1 - entrance) * 24}px)`;
  note.style.opacity = String(smooth((local - 1) / .8) * exit);
  const target = phonePose(chapter.id);
  const from = phonePose(previous.id);
  const intro = chapter.id === 'tarv1s' ? smooth(t / 2.2) : 1;
  const pose = Object.fromEntries(Object.keys(target).map(key => [key, mix(from[key], target[key], entrance)]));
  phone.group.position.set(pose.x + (1 - intro) * 1.6, pose.y + Math.sin(t * .48) * .035, 0);
  phone.group.rotation.set(-.055 + Math.sin(t * .28) * .018, pose.ry - (1 - intro) * .65 + Math.sin(t * .32) * .025, pose.rz);
  phone.group.scale.setScalar(pose.s);
  phoneShadow.position.set(phone.group.position.x, pose.y - 3.45 * pose.s, -.35);
  const currentScreen = screens[chapter.screen] ?? screens[previous.screen] ?? tarv1s;
  const oldScreen = previous.id === 'history' ? health : screens[previous.screen] ?? currentScreen;
  phone.screen.material.map = oldScreen;
  phone.nextScreen.material.map = currentScreen;
  phone.nextScreen.material.opacity = entrance;
  // A real health screen follows the history screen without inventing an overlay UI.
  if (chapter.id === 'history' && local > 3.8) {
    phone.screen.material.map = history;
    phone.nextScreen.material.map = health;
    phone.nextScreen.material.opacity = smooth((local - 3.8) / .65);
  }
  watches.forEach(watch => { watch.group.visible = false; });
  names.replaceChildren();
  if (chapter.id === 'watch') {
    const watch = watches[3].group;
    watch.visible = true;
    watch.position.set(portrait ? 0 : 3.35 + (1 - entrance) * 3, portrait ? -1.35 : -.22, .4);
    watch.scale.setScalar(portrait ? 1.28 : 1.10);
    watch.rotation.set(-.10, -.22 + local * .03, -.06);
  } else if (chapter.id === 'collection') {
    const selected = Math.min(4, Math.floor(local / 1.4));
    watches.forEach((watch, i) => {
      watch.group.visible = !portrait || i === selected;
      const reveal = smooth((local - (portrait ? 0 : i * .07)) / .65);
      watch.group.position.set(portrait ? 0 : (i - 2) * 2.84, (portrait ? -1.25 : -.7) - (1 - reveal) * .25, 0);
      watch.group.scale.setScalar((portrait ? 1.25 : .86) * (.94 + reveal * .06));
      watch.group.rotation.set(-.065, portrait ? -.17 + (local % 1.4) * .15 : (i - 2) * -.055 + Math.sin(t * .27) * .03, portrait ? -.035 : 0);
      if (!portrait || i === selected) {
        const label = document.createElement('span');
        label.textContent = FACE_NAMES[i];
        const projected = new THREE.Vector3(watch.group.position.x, 0, 0).project(camera);
        label.style.left = portrait ? '50%' : `${(projected.x + 1) * 50}%`;
        names.append(label);
      }
    });
    names.style.opacity = String(entrance * exit);
  } else if (chapter.id === 'closing') {
    const watch = watches[2].group;
    watch.visible = true;
    watch.position.set(portrait ? 1.30 : 5.0, portrait ? -2.10 : -.9, .90);
    watch.scale.setScalar(portrait ? .63 : .64);
    watch.rotation.set(-.09, -.26, .10);
  }
  watches.forEach((watch, i) => {
    watchShadows[i].visible = watch.group.visible;
    watchShadows[i].position.set(watch.group.position.x,
      watch.group.position.y - 2.34 * watch.group.scale.y, -.4);
    watchShadows[i].scale.setScalar(watch.group.scale.x);
  });
  progress.style.transform = `scaleX(${clamp01(t / DURATION)})`;
  renderer.render(scene, camera);
  return { time: t, chapter: chapter.id, width: innerWidth, height: innerHeight, demoDataOnly: true };
}

let playing = false, position = 0, lastTick = 0;
const play = document.querySelector('#play');
const seek = document.querySelector('#seek');
const timeLabel = document.querySelector('#time');
function tick(now) {
  if (!playing) return;
  if (lastTick) position = Math.min(DURATION, position + (now - lastTick) / 1000);
  lastTick = now;
  renderAt(position);
  seek.value = String(position);
  timeLabel.textContent = `0:${String(Math.floor(position)).padStart(2, '0')} / 0:46`;
  if (position >= DURATION) { playing = false; play.textContent = 'Replay film'; return; }
  requestAnimationFrame(tick);
}
play.addEventListener('click', () => {
  if (position >= DURATION) position = 0;
  playing = !playing;
  lastTick = 0;
  play.textContent = playing ? 'Pause film' : 'Play film';
  if (playing) requestAnimationFrame(tick);
});
seek.addEventListener('input', () => {
  playing = false; play.textContent = 'Play film'; position = Number(seek.value);
  renderAt(position); timeLabel.textContent = `0:${String(Math.floor(position)).padStart(2, '0')} / 0:46`;
});
window.addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderAt(position);
});
await document.fonts.ready;
position = boundedTime(Number(query.get('time') ?? 2.8));
renderAt(position);
seek.value = String(position);
timeLabel.textContent = `0:${String(Math.floor(position)).padStart(2, '0')} / 0:46`;
window.T1ArcFilm = { renderAt, duration: DURATION, ready: true, portrait, demoDataOnly: true,
  inspectLayout() {
    const rect = element => {
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return { chapter: currentChapter, copy: rect(copy), note: rect(note),
      footer: rect(document.querySelector('footer')), names: [...names.children].map(rect),
      playing, position, width: innerWidth, height: innerHeight };
  },
};
