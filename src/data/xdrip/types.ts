export const XDRIP_SOURCE_ID = 'xdrip-local';

export interface XdripConnection {
  endpointUrl: string;
}

export type XdripErrorCode =
  | 'invalid-connection'
  | 'network'
  | 'invalid-response';

export class XdripError extends Error {
  constructor(
    readonly code: XdripErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'XdripError';
  }
}
