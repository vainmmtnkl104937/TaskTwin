import {
  PrivacySettingsSchema,
  type PrivacyPolicy,
  type PrivacySettings,
  type Sensitivity,
} from './contracts.js';

export function resolvePrivacyPolicy(
  sensitivity: Sensitivity,
  settings: PrivacySettings,
): PrivacyPolicy {
  const validatedSettings = PrivacySettingsSchema.parse(settings);

  switch (sensitivity) {
    case 'authentication':
    case 'financial':
    case 'identity':
    case 'health':
      return 'block';
    case 'personal':
      return validatedSettings.personalDataPolicy;
    case 'unknown-sensitive':
      return 'mask';
    case 'public':
    case 'general':
      return 'allow';
  }
}
