import { ease } from './timeline.mjs';

export function validateFilm(film) {
  if (film.approvedRealCaptures !== true || film.visualApproved !== true || film.audio !== 'deferred') throw new Error('Approved real footage and silent visual pass required');
  if (!Array.isArray(film.scenes) || !film.scenes.length) throw new Error('Film scenes required');
  const ids = new Set(); let end = 0;
  for (const scene of film.scenes) {
    if (!/^[a-z0-9-]+$/.test(scene.id) || ids.has(scene.id)) throw new Error('Unique safe scene IDs required');
    ids.add(scene.id);
    if (scene.start !== end || !Number.isFinite(scene.duration) || scene.duration <= 0 || !Number.isInteger(scene.duration * 60)) throw new Error('Contiguous frame-aligned scenes required');
    if (!['whole', 'middle', 'top'].includes(scene.focus)) throw new Error('Unknown camera focus');
    if (!Array.isArray(scene.frameLookup) || !scene.frameLookup.length || !scene.frameLookup.every(n => Number.isInteger(n) && n > 0 && n < 100000)) throw new Error('Prepared recorded frames required');
    end += scene.duration;
  }
  if (end !== film.duration) throw new Error('Duration must match complete scene sequence');
  return film;
}

const mix=(a,b,t)=>a+(b-a)*t;
export function locateScene(film,seconds) {
  const t=Math.max(0,Math.min(film.duration-1/60,seconds));
  const index=film.scenes.findIndex(s=>t<s.start+s.duration);
  const scene=film.scenes[index];return {scene,index,local:t-scene.start};
}
export function filmStateAt(film,seconds,portrait=false) {
  const {scene,index,local}=locateScene(film,seconds);
  const entering=ease(local/1.6),leaving=ease((local-(scene.duration-.9))/.9);
  const approach=entering*(1-leaving);
  const hero=scene.kind==='hero';
  const focus=scene.focus??'whole';
  const close=focus==='top'?1:focus==='middle'?.55:0;
  const zoom=hero?0:approach*close;
  const frame=Math.min(scene.frameLookup.length-1,Math.floor(local*30));
  const sourceFrame=scene.frameLookup[frame];
  return {
    scene,index,local,sourceFrame,
    camera:[0,0,portrait?mix(19.3,10.9,zoom):mix(15.6,9.3,zoom)],
    target:[0,portrait?mix(0,.2,zoom):mix(0,focus==='middle'?.15:1.05,zoom),0],
    position:[portrait?0:mix(2.8,2.32,zoom),portrait?mix(-1,-2,zoom):0,0],
    rotation:[mix(-.07,0,approach),mix(-.38,hero?-.17:-.035,approach),mix(-.04,0,approach)],
    glassOpacity:hero?.055*(1-approach):0,
    opacity:ease(local/.3)*(1-ease((local-(scene.duration-.2))/.2)),
    endOpacity:1-ease((seconds-(film.duration-.6))/.6),
  };
}
export function visualKey(state) {
  return JSON.stringify([state.index,state.sourceFrame,state.camera,state.target,state.position,state.rotation,state.glassOpacity,state.opacity,state.endOpacity]);
}
