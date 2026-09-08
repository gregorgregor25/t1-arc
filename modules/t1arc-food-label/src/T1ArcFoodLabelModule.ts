import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { FoodLabelOcrResult } from '../../../src/data/food/foodLabelCapture';

declare class T1ArcFoodLabelModule extends NativeModule<Record<string, never>> {
  recognizeAsync(uri: string): Promise<FoodLabelOcrResult>;
}

// Existing installed builds can still use manual label entry.
export default requireOptionalNativeModule<T1ArcFoodLabelModule>('T1ArcFoodLabel');
