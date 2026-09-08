import { PhoneStage } from '../PhoneStage';
import { Editorial } from '../Editorial';
import { footage } from '../assets';
export function TimelineScene() {
  return <><PhoneStage clip={footage.timeline} /><Editorial title={'See the\nwhole day.'} line="Glucose, food and activity. Together." /></>;
}
