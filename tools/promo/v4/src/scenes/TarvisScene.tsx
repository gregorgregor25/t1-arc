import { PhoneStage } from '../PhoneStage';
import { Editorial } from '../Editorial';
import { footage } from '../assets';
export function TarvisScene() {
  return <><PhoneStage clip={footage.question} stillFrame={0} /><Editorial title={'Meet\nTarv1s.'} line="Ask about your health. In your own words." /></>;
}
