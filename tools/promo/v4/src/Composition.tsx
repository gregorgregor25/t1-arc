import { AbsoluteFill, Sequence } from 'remotion';
import { TransitionSeries } from '@remotion/transitions';
import { TodayScene } from './scenes/TodayScene';
import { HealthScene } from './scenes/HealthScene';
import { TarvisScene } from './scenes/TarvisScene';
import { QuestionScene } from './scenes/QuestionScene';
import { AnswerScene } from './scenes/AnswerScene';
import { TimelineScene } from './scenes/TimelineScene';
import { FoodScene } from './scenes/FoodScene';
import { ClosingScene } from './scenes/ClosingScene';
import { fontFamily } from './fonts';

// Match cuts keep one readable display on screen instead of ghosted app text.
export const ProductFilm = () => (
  <AbsoluteFill style={{ background: '#080a10', fontFamily }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={600}><TodayScene /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={720}><HealthScene /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={360}><TarvisScene /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={600}><QuestionScene /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={960}><AnswerScene /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={720}><TimelineScene /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={840}><FoodScene /></TransitionSeries.Sequence>
      <TransitionSeries.Sequence durationInFrames={600}><ClosingScene /></TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

// Three distinct states for treatment approval, not a sped-up interaction.
export const Treatment = () => (
  <AbsoluteFill style={{ background: '#080a10', fontFamily }}>
    <Sequence name="Current glucose reveal" durationInFrames={240}><TodayScene sample /></Sequence>
    <Sequence name="Health context" from={240} durationInFrames={180}><HealthScene sample /></Sequence>
    <Sequence name="Tarv1s answer close-up" from={420} durationInFrames={300}><AnswerScene sample /></Sequence>
  </AbsoluteFill>
);
