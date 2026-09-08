import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';
export const fontFamily = 'Manrope';
loadFont({ family: fontFamily, url: staticFile('fonts/Manrope.ttf'), weight: '200 800' });
