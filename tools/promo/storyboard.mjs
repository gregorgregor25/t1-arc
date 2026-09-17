export const DURATION = 46;
export const FPS = 30;
export const FACE_IDS = ['meridian', 'chronograph', 'atelier', 'pace', 'summit'];
export const FACE_NAMES = ['Meridian', 'Chronograph', 'Atelier', 'Pace', 'Summit'];

export const CHAPTERS = [
  { start: 0, end: 8, id: 'tarv1s', eyebrow: 'MEET TARV1S',
    title: ['Your type 1 data.', 'With context.'],
    detail: ['Ask questions about your records.', 'Explore the evidence behind the answer.'],
    note: 'AI questions use your own OpenAI key.', screen: 'tarv1s', side: 'left' },
  { start: 8, end: 16, id: 'today', eyebrow: 'ONE PLACE FOR YOUR DAY',
    title: ['Less switching.', 'More perspective.'],
    detail: ['Glucose, insulin, food and health context.', 'Together in T1 Arc.'],
    note: 'Connect the supported sources you already use.', screen: 'today', side: 'left' },
  { start: 16, end: 23, id: 'history', eyebrow: 'SEE WHAT HAPPENED WHEN',
    title: ['Look beyond', 'a single reading.'],
    detail: ['Review the timeline.', 'See meals, activity and sleep in context.'],
    note: 'Patterns to explore, not treatment instructions.', screen: 'history', side: 'right' },
  { start: 23, end: 30, id: 'food', eyebrow: 'FOOD THAT FITS YOUR DAY',
    title: ['Log it.', 'Get on with it.'],
    detail: ['Search, scan or use a saved meal.', 'Copy food from another day.'],
    note: 'Availability varies by food source and region.', screen: 'food', side: 'left' },
  { start: 30, end: 33, id: 'watch', eyebrow: 'A GLANCE IS ENOUGH',
    title: ['Glucose.', 'On your wrist.'],
    detail: ['Value, direction and freshness.', 'Without reaching for your phone.'],
    note: 'Wear OS companion and matching watch face.', side: 'left' },
  { start: 33, end: 40, id: 'collection', eyebrow: 'THE T1 ARC WATCH COLLECTION',
    title: ['Five faces. One clear glance.'],
    detail: ['Find the one that feels like your watch.'], note: '', side: 'center' },
  { start: 40, end: 46, id: 'closing', eyebrow: 'T1 ARC',
    title: ['Your day,', 'in context.'],
    detail: ['Android + Wear OS'],
    note: 'github.com/gregorgregor25/t1-arc', screen: 'tarv1s', side: 'left' },
];

export const boundedTime = time => Number.isFinite(time) ? Math.max(0, Math.min(DURATION, time)) : 0;
export const chapterAt = time => CHAPTERS.find(c => boundedTime(time) >= c.start && boundedTime(time) < c.end) ?? CHAPTERS.at(-1);
export const clamp01 = value => Math.min(1, Math.max(0, value));
export const smooth = value => { const x = clamp01(value); return x * x * (3 - 2 * x); };
