export const FPS = 60;
export const DURATION = 12;
export const FORMATS = {
  landscape: { width: 3840, height: 2160 },
  portrait: { width: 2160, height: 3840 },
};

export const clamp = x => Math.max(0, Math.min(1, x));
export const ease = x => { const t = clamp(x); return t * t * t * (t * (t * 6 - 15) + 10); };
const mix = (a, b, t) => a + (b - a) * t;

// Pure, frame-addressable camera choreography. Reading is deliberately still.
export function stateAt(seconds, portrait = false) {
  const t = Math.max(0, Math.min(DURATION, seconds));
  const reveal = ease(t / 3.2);
  const approach = ease((t - 3.2) / 3.0);
  return {
    t,
    camera: [0, 0, portrait ? mix(19.3, 10.9, approach) : mix(15.6, 9.3, approach)],
    target: [0, portrait ? mix(0, .2, approach) : mix(0, 1.05, approach), 0],
    position: [portrait ? 0 : mix(2.8, 2.32, approach), portrait ? mix(-1, -2, approach) : 0, 0],
    rotation: [mix(-.10, 0, approach), mix(mix(-.72, -.38, reveal), -.035, approach), mix(-.12, 0, approach)],
    introOpacity: ease(t / .7) * (1 - ease((t - 2.8) / .8)),
    readingOpacity: ease((t - 4.6) / 1.1),
    // Stop the actual recording at a stable reading frame, never interpolate UI.
    sourceSeconds: Math.min(1, t),
    glassOpacity: .11 * (1 - approach),
    endOpacity: 1 - ease((t - 11.45) / .55),
  };
}

export function validateManifest(manifest) {
  if (manifest.approvedRealCaptures !== true) throw new Error('Owner-approved real captures required');
  if (manifest.duration !== DURATION) throw new Error('This entrypoint renders only the approved sample duration');
  if (manifest.narration?.status !== 'pending-approval') throw new Error('Sample renderer does not make speech API calls');
  if (!manifest.source?.endsWith('.mp4')) throw new Error('Recorded MP4 source required');
  for (const value of Object.values(manifest.copy ?? {})) {
    if (typeof value !== 'string' || /\u2014|demo data/i.test(value)) throw new Error('Invalid editorial copy');
  }
  return manifest;
}
