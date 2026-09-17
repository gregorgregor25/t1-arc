import { Sequence } from 'remotion';
import { PhoneStage } from '../PhoneStage';
import { Editorial } from '../Editorial';
import { footage } from '../assets';
export function HealthScene({ sample = false }: { sample?: boolean }) {
  return <>
    <Sequence durationInFrames={sample ? 180 : 360}><PhoneStage clip={footage.health} /></Sequence>
    {!sample ? <Sequence from={360}><PhoneStage clip={footage.sleep} mode="read" focusY={.75} /></Sequence> : null}
    <Editorial title={'More of\nthe picture.'} line="Sleep. Movement. Nutrition." fadeAfter={sample ? 10000 : 290} />
  </>;
}
