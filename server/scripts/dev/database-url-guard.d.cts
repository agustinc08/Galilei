export type DevelopmentDatabaseUrlTarget = 'dev' | 'deep-qa';

export interface DevelopmentDatabaseUrlValidationOptions {
  allowIsolatedQa?: boolean;
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
