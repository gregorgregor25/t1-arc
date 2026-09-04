import { NightscoutConnection } from './types';

export type NightscoutSecretDigest = (secret: string) => Promise<string>;

async function defaultSecretDigest(secret: string) {
  const Crypto = await import('expo-crypto');
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA1, secret);
}

export async function nightscoutRequestHeaders(
  connection: NightscoutConnection,
  digestSecret: NightscoutSecretDigest = defaultSecretDigest,
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (connection.apiSecret) {
    headers['api-secret'] = await digestSecret(connection.apiSecret);
  }
  return headers;
}
