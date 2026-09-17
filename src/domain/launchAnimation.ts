/** The approved cold-launch sequence: one tilted orbit, then a stationary arc. */
export const LAUNCH_ANIMATION_MS = 1750;
export const LAUNCH_BACKGROUND = '#0b0d16';
export const clampLaunchProgress = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => 1 - Math.pow(1 - clampLaunchProgress(value), 3);

const particles = [46, 38, 28].flatMap((count, row) =>
  Array.from({ length: count }, (_, index) => ({ row, u: index / (count - 1) })),
);

export function launchFrame(progress: number) {
  const p = clampLaunchProgress(progress);
  const arrive = ease(p / .09);
  const morph = ease((p - .54) / .25);
  const turn = clampLaunchProgress(p / .54) * Math.PI * 2;
  return {
    opacity: 1 - ease((p - .91) / .09),
    nameOpacity: ease((p - .06) / .22),
    captionOpacity: ease((p - .17) / .24),
    particles: particles.map(({ row, u }, index) => {
      const angle = -Math.PI / 2 + (u - .5) * 1.5 + turn;
      const radius = 107 + row * 5 + 4 * (1 - arrive);
      const z = Math.sin(angle);
      const perspective = 1 + z * .08;
      const planeX = Math.cos(angle) * radius * perspective;
      const planeY = Math.sin(angle) * radius * .34 * perspective;
      const tilt = -.4;
      const orbitX = planeX * Math.cos(tilt) - planeY * Math.sin(tilt);
      const orbitY = planeX * Math.sin(tilt) + planeY * Math.cos(tilt);
      const arcAngle = (-205 + 230 * u) * Math.PI / 180;
      const arcRadius = 100 + row * 7;
      const depth = (z + 1) / 2;
      const beacon = index % 23 === 0;
      const opacity = (row === 0 ? .8 : row === 1 ? .4 : .2)
        * ((.45 + .55 * depth) * (1 - morph) + .85 * morph)
        * clampLaunchProgress(Math.sin(u * Math.PI) * 1.4) * arrive;
      return {
        x: 140 + orbitX * (1 - morph) + Math.cos(arcAngle) * arcRadius * morph,
        y: 140 + orbitY * (1 - morph) + Math.sin(arcAngle) * arcRadius * morph,
        radius: (row === 0 ? 1.3 : .8) * (.8 + depth * .4) * (beacon ? 1.4 : 1),
        opacity: beacon ? Math.min(1, opacity * 1.4) : opacity,
        color: beacon ? '#e1e8ff' : '#9fb3ff',
        front: z * (1 - morph) - morph >= 0,
      };
    }),
  };
}
