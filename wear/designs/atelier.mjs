import { accent, analog, clock, document, draw, glucose, gradientBox, group, label, line, markers, ring, secondary, tag, template, text } from './primitives.mjs';

export const atelierLayout = { centerX: 225, centerY: 170, hour: 86, minute: 121, second: 135, glucoseY: 311 };

export function atelier() {
  const { centerX: cx, centerY: cy, hour, minute, second, glucoseY } = atelierLayout;
  const dial = group('atelier_dial', draw(
    ring(225, 225, 211, '#FF3A4044') + ring(225, 225, 202, '#FF191E22') +
    ring(cx, cy, 151, '#FF343B3F') + ring(cx, cy, 143, '#FF171C20')) +
    markers(cx, cy, 138, { major: accent, minor: '#FF737B80', length: 13 }) +
    Array.from({ length: 12 }, (_, index) => tag('Group',
      { name: 'applied_' + index, x: 0, y: 0, width: 450, height: 450,
        angle: index * 30, pivotX: cx / 450, pivotY: cy / 450 },
      draw(gradientBox(222, 44, 6, 16, '#FF5A6267 #FFF1E6D0 #FF7A807F', 1)))).join('') +
    label(135, 97, 180, 24, 16, 'T 1  A R C', '#FFE8ECEE', 'MEDIUM') +
    label(135, 120, 180, 18, 10, 'A T E L I E R', accent) +
    text(282, 155, 76, 28, 22, template('%s', '[DAY_Z]'), '#FFEEF0ED', 'MEDIUM') +
    text(282, 183, 76, 20, 12, template('%s', '[DAY_OF_WEEK_S]'), '#FFAFBCC3') +
    draw(line(286, 149, 354, 149, '#FF444B50') + line(286, 209, 354, 209, '#FF444B50')) +
    label(140, 403, 170, 18, 10, 'G L U C O S E', '#FFAFBCC3'));
  // The entire hand sweep stays above glucose, including at 6:30.
  const hands = group('atelier_hands', analog('atelier', cx, cy, hour, minute, second));
  return document('atelier', dial + secondary(92, 158, 80, 54, 402, 'WATCH_BATTERY') + hands +
    group('atelier_aod_time', clock(75, 75, 300, 64, 52, 'LIGHT'), 'ambient') +
    glucose({ x: 93, y: glucoseY, width: 264, height: 88, slotId: 400, size: 54, weight: 'LIGHT' }),
  'champagne');
}
