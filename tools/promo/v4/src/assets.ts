// Raw phone captures stay local and ignored. See PRODUCTION.md for provenance.
export const footage = {
  today: { file: 'captures/today-hold.mp4', lastFrame: 898 },
  health: { file: 'captures/health-hold.mp4', lastFrame: 898 },
  sleep: { file: 'captures/sleep-hold.mp4', lastFrame: 898 },
  question: { file: 'captures/question.mp4', lastFrame: 705 },
  answer: { file: 'captures/answer.mp4', lastFrame: 377 },
  timeline: { file: 'captures/timeline-hold.mp4', lastFrame: 898 },
  food: { file: 'captures/food.mp4', lastFrame: 602 },
};
export type Footage = (typeof footage)[keyof typeof footage];
