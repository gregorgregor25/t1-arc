import { accent, analog, box, clock, document, draw, glucose, gradientBox, group, label, markers, ring, tag, template, text } from './primitives.mjs';

// Full-size dial with an inset data aperture. Every hand tip remains visible.
export const atelierLayout = {
  centerX: 225, centerY: 225, radius: 209, hour: 178, minute: 199, second: 203,
  aperture: { x: 112, y: 270, width: 226, height: 78 },
};

export function atelier() {
  const { centerX: cx, centerY: cy, hour, minute, second, aperture } = atelierLayout;
  const dial = group('atelier_full_dial', draw(
    ring(cx, cy, 216, '#FF3A4044') + ring(cx, cy, 208, '#FF171C20')) +
    markers(cx, cy, 204, { major: accent, minor: '#FF737B80', length: 18 }) +
    Array.from({ length: 12 }, (_, index) => tag('Group',
      { name: 'applied_' + index, x: 0, y: 0, width: 450, height: 450,
        angle: index * 30, pivotX: 0.5, pivotY: 0.5 },
      draw(gradientBox(222, 32, 6, 19, '#FF5A6267 #FFF1E6D0 #FF7A807F', 1)))).join('') +
    label(100, 98, 250, 28, 19, 'T 1  A R C', '#FFE8ECEE', 'MEDIUM') +
    label(125, 132, 200, 21, 12, 'A T E L I E R', accent) +
    text(118, 167, 214, 28, 18, template('%s  %s', '[DAY_OF_WEEK_S]', '[DAY_Z]'), '#FFAFBCC3'));
  const hands = group('atelier_hands', analog('atelier', cx, cy, hour, minute, second));
  const apertureBacking = group('atelier_data_aperture', draw(
    box(aperture.x, aperture.y, aperture.width, aperture.height, '#FF080B0D', 10)));
  return document('atelier', dial + hands + apertureBacking +
    group('atelier_aod_time', clock(65, 128, 320, 72, 58, 'LIGHT'), 'ambient') +
    glucose({ ...aperture, slotId: 400, size: 49, weight: 'LIGHT' }),
  'champagne');
}
