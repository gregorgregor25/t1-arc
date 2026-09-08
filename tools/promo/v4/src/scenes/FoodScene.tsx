import { PhoneStage } from '../PhoneStage';
import { Editorial } from '../Editorial';
import { footage } from '../assets';
export function FoodScene() {
  return <><PhoneStage clip={footage.food} /><Editorial title={'Food,\nwithout fuss.'} line="Search. Check the details." /></>;
}
