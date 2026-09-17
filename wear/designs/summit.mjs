import { accent, analog, box, clock, document, draw, glucose, group, label, markers, ring, template, text } from './primitives.mjs';

export const summitLayout = {
  centerX: 225, centerY: 225, radius: 209, hour: 178, minute: 199, second: 203,
  aperture: { x: 112, y: 270, width: 226, height: 78 },
};

export function summit() {
  const { centerX: cx, centerY: cy, hour, minute, second, aperture } = summitLayout;
  const dial = group('summit_full_field_dial',
    draw(ring(cx, cy, 216, '#FF48514F') + ring(cx, cy, 209, '#FF252D2C')) +
    markers(cx, cy, 204, { major: accent, minor: '#FF74827B', length: 14 }) +
    label(178, 45, 94, 46, 37, '12', '#FFE8EDD9', 'BOLD') +
    label(359, 201, 40, 46, 37, '3', '#FFE8EDD9', 'BOLD') +
    label(51, 201, 40, 46, 37, '9', '#FFE8EDD9', 'BOLD') +
    label(178, 357, 94, 46, 37, '6', '#FFE8EDD9', 'BOLD') +
    label(125, 117, 200, 25, 17, 'T 1  A R C', accent, 'MEDIUM') +
    label(125, 147, 200, 20, 12, 'S U M M I T', '#FFAFBDB5') +
    text(110, 178, 230, 25, 18, template('%s  %s', '[DAY_OF_WEEK_S]', '[DAY_Z]'), '#FFBBC8BF'));
  return document('summit', dial +
    group('summit_hands', analog('summit', cx, cy, hour, minute, second)) +
    group('summit_data_aperture', draw(box(aperture.x, aperture.y, aperture.width, aperture.height, '#FF0A100E', 8))) +
    group('summit_aod_time', clock(65, 128, 320, 72, 58, 'MEDIUM'), 'ambient') +
    glucose({ ...aperture, slotId: 600, size: 49, weight: 'MEDIUM' }),
  'amber');
}
