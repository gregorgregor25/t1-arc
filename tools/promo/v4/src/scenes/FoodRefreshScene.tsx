import { AbsoluteFill } from 'remotion';
import { PhoneStage } from '../PhoneStage';
import { Editorial } from '../Editorial';
import { fontFamily } from '../fonts';

// Separate composition: original captures and approved films remain untouched.
// Genuine current-UI footage, synthetic emulator profile; draft never saved.
export function FoodRefreshScene() {
  return <AbsoluteFill style={{ background: '#080a10', fontFamily }}>
    <PhoneStage clip={{ file: 'captures/food-refresh.mp4', lastFrame: 839 }} />
    <Editorial title={'Food,\nwithout fuss.'} line="Search. Check the details." />
  </AbsoluteFill>;
}
