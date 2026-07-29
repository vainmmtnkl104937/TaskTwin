import type { PrivacyRuleId, Sensitivity } from './contracts.js';

export interface PrivacyRule {
  id: PrivacyRuleId;
  sensitivity: Exclude<Sensitivity, 'public' | 'general'>;
  confidence: 'high' | 'medium' | 'low';
  fields?: ReadonlyArray<
    | 'inputType'
    | 'autocomplete'
    | 'name'
    | 'id'
    | 'labelText'
    | 'accessibleName'
    | 'placeholder'
    | 'role'
  >;
  terms: readonly string[];
}

export const PRIVACY_RULES: readonly PrivacyRule[] = [
  {
    id: 'AUTH_PASSWORD_TYPE',
    sensitivity: 'authentication',
    confidence: 'high',
    fields: ['inputType'],
    terms: ['password'],
  },
  {
    id: 'AUTH_AUTOCOMPLETE',
    sensitivity: 'authentication',
    confidence: 'high',
    fields: ['autocomplete'],
    terms: ['current password', 'new password', 'one time code'],
  },
  {
    id: 'AUTH_METADATA',
    sensitivity: 'authentication',
    confidence: 'medium',
    terms: [
      'password',
      'passcode',
      'one time code',
      'verification code',
      'otp',
      'access token',
      'auth token',
      'mat khau',
      'ma xac thuc',
      'ma otp',
    ],
  },
  {
    id: 'FINANCIAL_AUTOCOMPLETE',
    sensitivity: 'financial',
    confidence: 'high',
    fields: ['autocomplete'],
    terms: ['cc number', 'cc csc'],
  },
  {
    id: 'FINANCIAL_METADATA',
    sensitivity: 'financial',
    confidence: 'medium',
    terms: [
      'card number',
      'credit card',
      'debit card',
      'card security code',
      'cvv',
      'cvc',
      'bank account',
      'account number',
      'routing number',
      'so the',
      'ma cvv',
      'tai khoan ngan hang',
    ],
  },
  {
    id: 'IDENTITY_METADATA',
    sensitivity: 'identity',
    confidence: 'medium',
    terms: [
      'passport',
      'national id',
      'citizen id',
      'citizen identification',
      'tax id',
      'tax number',
      'student id',
      'ho chieu',
      'can cuoc',
      'cccd',
      'cmnd',
      'ma so thue',
    ],
  },
  {
    id: 'HEALTH_METADATA',
    sensitivity: 'health',
    confidence: 'medium',
    terms: [
      'medical',
      'health',
      'diagnosis',
      'medication',
      'patient',
      'symptom',
      'insurance health',
      'benh an',
      'chan doan',
      'thuoc dieu tri',
      'suc khoe',
    ],
  },
  {
    id: 'PERSONAL_INPUT_TYPE',
    sensitivity: 'personal',
    confidence: 'high',
    fields: ['inputType'],
    terms: ['email', 'tel'],
  },
  {
    id: 'PERSONAL_AUTOCOMPLETE',
    sensitivity: 'personal',
    confidence: 'high',
    fields: ['autocomplete'],
    terms: [
      'email',
      'tel',
      'street address',
      'address line1',
      'address line2',
      'name',
      'given name',
      'family name',
      'bday',
    ],
  },
  {
    id: 'PERSONAL_METADATA',
    sensitivity: 'personal',
    confidence: 'medium',
    terms: [
      'email',
      'phone',
      'telephone',
      'street address',
      'postal address',
      'full name',
      'date of birth',
      'dob',
      'thu dien tu',
      'so dien thoai',
      'dia chi',
      'ho ten',
      'ngay sinh',
    ],
  },
  {
    id: 'UNKNOWN_SENSITIVE_METADATA',
    sensitivity: 'unknown-sensitive',
    confidence: 'low',
    terms: ['secret', 'credential', 'private key', 'token', 'bi mat'],
  },
] as const;

export const SENSITIVITY_PRIORITY: readonly Sensitivity[] = [
  'authentication',
  'financial',
  'identity',
  'health',
  'personal',
  'unknown-sensitive',
  'general',
  'public',
];
