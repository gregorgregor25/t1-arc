import { PhoneStage } from '../PhoneStage';
import { Editorial } from '../Editorial';
import { footage } from '../assets';
export function ClosingScene() {
  return <><PhoneStage clip={footage.today} mode="close" approachFrames={540} /><Editorial title={'Your data.\nYour questions.'} line="T1 Arc. With Tarv1s." /></>;
}
