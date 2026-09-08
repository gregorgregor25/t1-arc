import { PhoneStage } from '../PhoneStage';
import { Editorial } from '../Editorial';
import { footage } from '../assets';
export function TodayScene({ sample = false }: { sample?: boolean }) {
  return <><PhoneStage clip={footage.today} mode="reveal" approachFrames={sample ? 180 : 240} /><Editorial title={'Your day.\nAt a glance.'} line="Current glucose. The direction it’s heading." /></>;
}
