export type DevelopmentDatabaseUrlTarget = 'dev' | 'deep-qa' | 'suite7-qa';

export interface DevelopmentDatabaseUrlValidationOptions {
  allowIsolatedQa?: boolean;
  allowSuite7Qa?: boolean;
  deploymentEnvironment?: string;
}

export interface DevelopmentDatabaseUrlValidation {
  valid: boolean;
  target: DevelopmentDatabaseUrlTarget;
}

export function validateDevelopmentDatabaseUrl(
  rawUrl: string | undefined,
  options?: DevelopmentDatabaseUrlValidationOptions,
): DevelopmentDatabaseUrlValidation;
