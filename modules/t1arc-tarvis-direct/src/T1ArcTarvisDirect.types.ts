export type TarvisDirectStatus = {
  enabled: boolean;
  enrolled: boolean;
  certificateExpiresAtMs: number | null;
  tokenExpiresAtMs: number | null;
};

export type TarvisDirectEnrollment = {
  enrolled: true;
  certificateExpiresAtMs: number;
  attestationSecurityLevel: 'strongbox' | 'trusted-environment';
};

export type TarvisDirectResponseRequest = {
  model: string;
  inputJson: string;
  toolsJson: string;
  textFormatJson: string;
  maxOutputTokens: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  toolChoice?: 'auto' | 'required' | 'none';
};
