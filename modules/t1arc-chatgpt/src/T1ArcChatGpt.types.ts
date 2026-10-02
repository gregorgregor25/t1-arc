export type ChatGptSignInOptions = {
  hostId: string;
  clientId?: string;
  idTokenHint?: string;
  expectedSubject?: string;
  requestConsent?: boolean;
};

export type ChatGptSignInTransaction = {
  transactionId: string;
  clientId: string;
};

export type ChatGptCredentials = {
  clientId: string;
  subject: string;
  email?: string;
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number;
  scopes: string[];
};

export type ChatGptRequest = {
  requestId: string;
  accessToken: string;
  body: string;
};
