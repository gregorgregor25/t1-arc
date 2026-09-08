import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

import FoodLabelModule from '../../../modules/t1arc-food-label';
import { parseFoodNutritionLabel, type FoodLabelDraft } from './foodLabelCapture';

export function foodLabelCaptureAvailable() {
  return Platform.OS === 'android' && FoodLabelModule !== null;
}

async function removeTemporaryFile(file: File) {
  try { if (file.exists) await file.delete(); } catch { /* OS cache cleanup is the final fallback. */ }
}

function isCameraTemporaryJpeg(uri: string) {
  const prefix = `${Paths.cache.uri.replace(/\/$/, '')}/Camera/`;
  return uri.startsWith(prefix) && /^[a-fA-F0-9-]+\.jpg$/.test(uri.slice(prefix.length));
}

/** Consumes only the temporary image returned by CameraView.takePictureAsync. */
export async function recognizeFoodLabelPhoto(cameraUri: string): Promise<FoodLabelDraft> {
  if (!isCameraTemporaryJpeg(cameraUri)) {
    throw new Error('Use a new label photo from the camera.');
  }
  const cameraFile = new File(cameraUri);
  let ownedImage: File | undefined;
  try {
    if (!foodLabelCaptureAvailable() || !FoodLabelModule) {
      throw new Error('Label capture is unavailable in this build. Enter the label values instead.');
    }
    const directory = new Directory(Paths.cache, 'food-label-capture');
    await directory.create({ idempotent: true, intermediates: true });
    ownedImage = new File(directory, `label-${randomUUID()}.jpg`);
    await cameraFile.copy(ownedImage);
    await removeTemporaryFile(cameraFile);
    const result = await FoodLabelModule.recognizeAsync(ownedImage.uri);
    return parseFoodNutritionLabel(result);
  } finally {
    await removeTemporaryFile(cameraFile);
    if (ownedImage) await removeTemporaryFile(ownedImage);
  }
}

export async function discardFoodLabelPhoto(cameraUri: string) {
  if (isCameraTemporaryJpeg(cameraUri)) {
    await removeTemporaryFile(new File(cameraUri));
  }
}
