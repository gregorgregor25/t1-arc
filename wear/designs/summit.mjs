import { accent, analog, box, clock, document, draw, glucose, group, label, line, markers, ring, template, text } from './primitives.mjs';

export function summit() {
  const dial = group('summit_field_dial',
    draw(ring(225, 166, 132, '#FF48514F') + ring(225, 166, 126, '#FF252D2C') +
      box(73, 282, 304, 103, '#FF111817', 9) +
      line(96, 277, 354, 277, accent) + line(124, 410, 326, 410, '#FF36423E')) +
    markers(225, 166, 118, { major: accent, minor: '#FF74827B', length: 11 }) +
    label(180, 56, 90, 34, 27, '12', '#FFE8EDD9', 'BOLD') +
    label(304, 148, 35, 34, 27, '3', '#FFE8EDD9', 'BOLD') +
    label(110, 148, 35, 34, 27, '9', '#FFE8EDD9', 'BOLD') +
    label(180, 241, 90, 29, 24, '6', '#FFE8EDD9', 'BOLD') +
    label(150, 118, 150, 21, 14, 'T 1  A R C', accent, 'MEDIUM') +
    label(150, 205, 150, 18, 10, 'S U M M I T', '#FFAFBDB5') +
    text(144, 224, 162, 18, 12, template('%s  %s', '[DAY_OF_WEEK_S]', '[DAY_Z]'), '#FFBBC8BF') +
    text(80, 387, 290, 23, 15, template('BAT %d%%   ·   %d STEPS', '[BATTERY_PERCENT]', '[STEP_COUNT]'), '#FFCFD7CD'));
  return document('summit', dial +
    group('summit_hands', analog('summit', 225, 166, 70, 103, 112)) +
    group('summit_aod_time', clock(70, 98, 310, 70, 56, 'MEDIUM'), 'ambient') +
    glucose({ x: 83, y: 288, width: 284, height: 90, slotId: 600, size: 58, weight: 'MEDIUM' }),
  'amber');
}
