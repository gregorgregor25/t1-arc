/**
 * Original T1 Arc WFF geometry. All coordinates use a 450-unit round canvas.
 * These builders only generate resources; no code runs inside a watch face.
 */
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export const tag = (name, attributes = {}, children = '') => '<' + name +
  Object.entries(attributes).map(([key, value]) => ' ' + key + '="' + escape(value) + '"').join('') +
  (children ? '>' + children + '</' + name + '>' : '/>');
export const ambient = (value = 0) => tag('Variant', { mode: 'AMBIENT', target: 'alpha', value });
export const group = (name, children, mode = 'active', bounds = {}) =>
  tag('Group', { name, x: 0, y: 0, width: 450, height: 450, alpha: mode === 'ambient' ? 0 : 255, ...bounds },
    (mode === 'both' ? '' : ambient(mode === 'ambient' ? 255 : 0)) + children);
export const template = (format, ...expressions) => tag('Template', {}, escape(format) +
  expressions.map((expression) => tag('Parameter', { expression })).join(''));
export const text = (x, y, width, height, size, content, color = '#FFEAECEF', weight = 'NORMAL', align = 'CENTER') =>
  tag('PartText', { x, y, width, height, tintColor: color },
    tag('Text', { align }, tag('Font', { family: 'SYNC_TO_DEVICE', size, weight }, content)));
export const label = (x, y, width, height, size, content, color, weight, align) =>
  text(x, y, width, height, size, escape(content), color, weight, align);
export const draw = (children) => tag('PartDraw', { x: 0, y: 0, width: 450, height: 450 }, children);
export const line = (x1, y1, x2, y2, color, thickness = 1) => tag('Line',
  { startX: x1, startY: y1, endX: x2, endY: y2 }, tag('Stroke', { color, thickness }));
export const ring = (cx, cy, radius, color, thickness = 1) =>
  tag('Ellipse', { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
    tag('Stroke', { color, thickness }));
export const box = (x, y, width, height, color, radius = 0) =>
  tag('RoundRectangle', { x, y, width, height, cornerRadiusX: radius, cornerRadiusY: radius },
    tag('Fill', { color }));
export const gradientBox = (x, y, width, height, colors, radius = 0) =>
  tag('RoundRectangle', { x, y, width, height, cornerRadiusX: radius, cornerRadiusY: radius },
    tag('Fill', { color: '#FFFFFFFF' }, tag('LinearGradient',
      { startX: x, startY: y, endX: x + width, endY: y + height, colors, positions: '0 0.5 1' })));
export const accent = '[CONFIGURATION.accent]';

export function markers(cx, cy, radius, { major = '#FFD9DEE0', minor = '#FF515A61', length = 15, skip = [] } = {}) {
  return draw(Array.from({ length: 60 }, (_, index) => {
    if (skip.includes(index)) return '';
    const angle = index * Math.PI / 30;
    const isMajor = index % 5 === 0;
    const inner = radius - (isMajor ? length : 5);
    const n = (value) => Math.round(value * 100) / 100;
    return line(n(cx + Math.sin(angle) * inner), n(cy - Math.cos(angle) * inner),
      n(cx + Math.sin(angle) * radius), n(cy - Math.cos(angle) * radius),
      isMajor ? major : minor, isMajor ? 3 : 1);
  }).join(''));
}

export function clock(x, y, width, height, size, weight = 'NORMAL', color = '#FFFFFFFF') {
  return tag('DigitalClock', { x, y, width, height }, tag('TimeText',
    { x: 0, y: 0, width, height, format: 'hh:mm', hourFormat: 'SYNC_TO_DEVICE', align: 'CENTER' },
    tag('Font', { family: 'SYNC_TO_DEVICE', size, weight, color })));
}

const provider = (name, type) => tag('DefaultProviderPolicy', {
  primaryProvider: 'io.github.gregorgregor25.t1arc/io.github.gregorgregor25.t1arc.wear.complication.' + name,
  primaryProviderType: type, defaultSystemProvider: 'EMPTY', defaultSystemProviderType: 'EMPTY',
});
const colorTokens = [
  ['rose', '#FFFF9BAE'], ['amber', '#FFF1B66F'], ['orange', '#FFFFB066'],
  ['cyan', '#FF65D2E7'], ['green', '#FF69D5AC'], ['blue', '#FF82B7FF'], ['purple', '#FFC2A9FF'],
];

/** RANGED_VALUE is the existing categorical colour token, never glucose math. */
export function glucose({ x, y, width, height, slotId, size, weight = 'MEDIUM' }) {
  const value = (color) => text(0, 0, width, height - 24, size,
    template('%s', '[COMPLICATION.TEXT]'), color, weight);
  const status = text(0, height - 24, width, 24, 18,
    template('%s', '[COMPLICATION.TITLE]'), '#FFBBC6CC');
  const expressions = tag('Expressions', {}, colorTokens.map(([name], index) =>
    tag('Expression', { name }, escape((index ? '[COMPLICATION.RANGED_VALUE_VALUE] >= ' + (index - 0.5) + ' && ' : '') +
      '[COMPLICATION.RANGED_VALUE_VALUE] < ' + (index + 0.5)))).join(''));
  const colors = tag('Condition', {}, expressions +
    colorTokens.map(([name, color]) => tag('Compare', { expression: name }, value(color))).join('') +
    tag('Default', {}, value('#FFA9BDC2')));
  return tag('ComplicationSlot', {
    x, y, width, height, slotId, displayName: 'glucose_slot_label', isCustomizable: 'FALSE',
    supportedTypes: 'RANGED_VALUE SHORT_TEXT EMPTY',
  }, provider('T1ArcWatchFaceGlucoseComplicationService', 'RANGED_VALUE') +
    tag('BoundingRoundBox', { x: 0, y: 0, width, height, cornerRadius: 8, outlinePadding: 2 }) +
    tag('Complication', { type: 'RANGED_VALUE' },
      group('glucose_active', colors, 'active', { width, height }) +
      group('glucose_ambient', value('#FFE0E5E8'), 'ambient', { width, height }) + status) +
    tag('Complication', { type: 'SHORT_TEXT' }, value('#FFA9BDC2') + status) +
    tag('Complication', { type: 'EMPTY' },
      label(0, 0, width, height - 24, size, '--', '#FFA9BDC2') +
      label(0, height - 24, width, 24, 14, 'WAITING FOR GLUCOSE', '#FFBBC6CC')));
}

export function graph(x, y, width, height, slotId) {
  return tag('ComplicationSlot', {
    x, y, width, height, slotId, displayName: 'graph_slot_label', isCustomizable: 'FALSE',
    supportedTypes: 'PHOTO_IMAGE EMPTY',
  }, ambient() + provider('T1ArcGraphComplicationService', 'PHOTO_IMAGE') +
    tag('BoundingRoundBox', { x: 0, y: 0, width, height, cornerRadius: 2 }) +
    tag('Complication', { type: 'PHOTO_IMAGE' }, tag('PartImage', { x: 0, y: 0, width, height },
      tag('Image', { resource: '[COMPLICATION.PHOTO_IMAGE]' }))) +
    tag('Complication', { type: 'EMPTY' }, label(0, 20, width, 30, 14, 'HISTORY IS SYNCING', '#FF9EAFB6')));
}

/** Secondary, user-editable slots never displace or recolour glucose. */
export function secondary(x, y, width, height, slotId, defaultSystemProvider) {
  const body = text(0, 2, width, 30, 24, template('%s', '[COMPLICATION.TEXT]'), '#FFEAECEF', 'MEDIUM') +
    tag('Condition', {}, tag('Expressions', {}, tag('Expression', { name: 'has_title' },
      escape('[COMPLICATION.TITLE] != ""'))) +
      tag('Compare', { expression: 'has_title' },
        text(0, 33, width, 22, 16, template('%s', '[COMPLICATION.TITLE]'), '#FFAFBDC5')) +
      tag('Default', {}, tag('PartImage', { x: width / 2 - 11, y: 33, width: 22, height: 22, tintColor: '#FFAFBDC5' },
        tag('Image', { resource: '[COMPLICATION.MONOCHROMATIC_IMAGE]' }))));
  return tag('ComplicationSlot', {
    x, y, width, height, slotId, displayName: 'secondary_slot_label', isCustomizable: 'TRUE',
    supportedTypes: 'SHORT_TEXT EMPTY',
  }, ambient() + tag('DefaultProviderPolicy', { defaultSystemProvider, defaultSystemProviderType: 'SHORT_TEXT' }) +
    tag('BoundingRoundBox', { x: 0, y: 0, width, height, cornerRadius: 6 }) +
    tag('Complication', { type: 'SHORT_TEXT' }, body) +
    tag('Complication', { type: 'EMPTY' }, label(0, 15, width, 22, 14, 'ADD DATA', '#FFAFBDC5')));
}

export function analog(face, cx, cy, hourLength, minuteLength, secondLength = 0) {
  const hand = (name, width, length) => tag(name[0].toUpperCase() + name.slice(1) + 'Hand', {
    resource: face + '_' + name + '_hand', x: cx - width / 2, y: cy - length,
    width, height: length + 24, pivotX: 0.5, pivotY: length / (length + 24),
  }, name === 'second' ? ambient() : '');
  return tag('AnalogClock', { x: 0, y: 0, width: 450, height: 450 },
    hand('hour', 16, hourLength) + hand('minute', 12, minuteLength) +
    (secondLength ? hand('second', 4, secondLength) : '')) +
    draw(tag('Ellipse', { x: cx - 5, y: cy - 5, width: 10, height: 10 },
      tag('Fill', { color: '#FFE4E8EA' })));
}

export function document(name, scene, defaultAccent) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!-- Generated from wear/designs. Edit the design source and regenerate. -->\n' +
    tag('WatchFace', { width: 450, height: 450 },
      tag('Metadata', { key: 'CLOCK_TYPE', value: name === 'pace' ? 'DIGITAL' : 'ANALOG' }) +
      tag('Metadata', { key: 'PREVIEW_TIME', value: '10:08:30' }) +
      tag('UserConfigurations', {}, tag('ColorConfiguration',
        { id: 'accent', displayName: 'accent_label', defaultValue: defaultAccent },
        [['silver', '#FFD9DEE0'], ['champagne', '#FFE3C999'], ['lime', '#FFD3F47A'], ['amber', '#FFF3B568']]
          .map(([id, colors]) => tag('ColorOption', { id, colors, displayName: 'accent_' + id })).join(''))) +
      tag('Scene', { backgroundColor: '#FF000000' }, scene)) + '\n';
}
