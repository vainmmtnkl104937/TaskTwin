import {
  classifyPrivacy,
  type PrivacyClassificationInput,
} from '@tasktwin/privacy-engine';

function input(
  overrides: Partial<PrivacyClassificationInput> = {},
): PrivacyClassificationInput {
  return {
    schemaVersion: 1,
    tagName: 'input',
    inputType: 'text',
    autocomplete: null,
    name: 'projectNote',
    id: 'project-note',
    labelText: 'Project note',
    accessibleName: 'Project note',
    placeholder: null,
    role: 'textbox',
    ...overrides,
  };
}

export const generalPrivacyDecision = classifyPrivacy(input());

export const publicPrivacyDecision = classifyPrivacy(
  input({
    tagName: 'button',
    inputType: null,
    name: null,
    id: 'save-button',
    labelText: null,
    accessibleName: 'Save',
    role: 'button',
  }),
);

export const personalMaskDecision = classifyPrivacy(
  input({
    inputType: 'email',
    autocomplete: 'email',
    name: 'email',
    id: 'email-field',
    labelText: 'Email address',
    accessibleName: 'Email address',
  }),
);

export const authenticationBlockDecision = classifyPrivacy(
  input({
    inputType: 'password',
    autocomplete: 'current-password',
    name: 'password',
    id: 'password-field',
    labelText: 'Password',
    accessibleName: 'Password',
  }),
);
