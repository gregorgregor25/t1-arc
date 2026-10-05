import { NativeModule, requireOptionalNativeModule } from 'expo';
import type { ChatGptCredentials, ChatGptRequest, ChatGptSignInOptions, ChatGptSignInTransaction } from './T1ArcChatGpt.types';

export declare class T1ArcChatGptModule extends NativeModule<Record<string, never>> {
  isAvailable(): boolean;
  signIn(options: ChatGptSignInOptions): Promise<ChatGptSignInTransaction>;
  completeSignIn(transactionId: string): Promise<ChatGptCredentials>;
  cancelSignIn(): Promise<void>;
  refreshSession(credentials: ChatGptCredentials): Promise<ChatGptCredentials>;
  revokeSession(credentials: ChatGptCredentials): Promise<boolean>;
  listModels(accessToken: string): Promise<string>;
  request(request: ChatGptRequest): Promise<string>;
  cancelRequest(requestId: string): Promise<void>;
}

const module = requireOptionalNativeModule<T1ArcChatGptModule>('T1ArcChatGpt');
export const isAvailable = (): boolean => Boolean(module?.isAvailable());
export default module;
