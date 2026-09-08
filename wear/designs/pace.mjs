import { accent, box, clock, document, draw, glucose, graph, group, label, line, secondary, template, text } from './primitives.mjs';

export function pace() {
  const active = group('pace_sports_frame',
    draw(box(34, 131, 382, 123, '#FF0B1216', 26) +
      box(53, 145, 4, 86, accent, 2) + box(393, 145, 4, 86, accent, 2) +
      line(75, 343, 375, 343, '#FF36434A') + line(225, 353, 225, 399, '#FF36434A')) +
    label(60, 25, 330, 23, 14, 'T 1  A R C   /   P A C E', accent, 'MEDIUM') +
    text(55, 111, 340, 20, 15, template('%s  %s', '[DAY_OF_WEEK_S]', '[DAY_Z]'), '#FFBBC7CB'));
  return document('pace', active +
    clock(44, 44, 362, 72, 70, 'BOLD') +
    glucose({ x: 67, y: 140, width: 316, height: 105, slotId: 500, size: 75, weight: 'BOLD' }) +
    graph(38, 257, 374, 83, 510) +
    secondary(63, 350, 144, 58, 502, 'STEP_COUNT') +
    secondary(243, 350, 144, 58, 503, 'WATCH_BATTERY'),
  'lime');
}
