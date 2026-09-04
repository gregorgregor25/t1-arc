import { NativeModule, requireOptionalNativeModule } from 'expo';

import {
  TarvisDirectEnrollment,
  TarvisDirectResponseRequest,
  TarvisDirectStatus,
} from './T1ArcTarvisDirect.types';

declare class T1ArcTarvisDirectModule extends NativeModule<Record<string, never>> {
  getStatusAsync(): Promise<TarvisDirectStatus>;
  enrollAsync(
    enrollmentBaseUrl: string,
    enrollmentBearerToken: string,
  ): Promise<TarvisDirectEnrollment>;
  exchangeOpenAiTokenAsync(
    identityProviderId: string,
    serviceAccountId: string,
  ): Promise<{ tokenExpiresAtMs: number }>;
  createResponseAsync(request: TarvisDirectResponseRequest): Promise<string>;
  clearAsync(): Promise<boolean>;
}

export default requireOptionalNativeModule<T1ArcTarvisDirectModule>(
  'T1ArcTarvisDirect',
);
