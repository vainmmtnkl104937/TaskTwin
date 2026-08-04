import {
  classifyPrivacy,
  containsSensitiveLiteral,
  DEFAULT_PRIVACY_SETTINGS,
  type PrivacyClassificationInput,
  type PrivacyDecision,
} from '@tasktwin/privacy-engine';
import type { ElementLocator } from '@tasktwin/workflow-schema';

function locatorStrings(locator: ElementLocator): string[] {
  switch (locator.kind) {
    case 'role':
      return [
        locator.role,
        ...(locator.name === undefined ? [] : [locator.name]),
      ];
    case 'css':
      return [locator.selector];
    default:
      return [locator.value];
  }
}

export function isLocatorCandidatePrivacyEligible(input: {
  locator: ElementLocator;
  privacyInput: PrivacyClassificationInput;
  privacyDecision: PrivacyDecision;
}): boolean {
  const expected = classifyPrivacy(
    input.privacyInput,
    DEFAULT_PRIVACY_SETTINGS,
  );
  return (
    expected.policy === 'allow' &&
    input.privacyDecision.policy === 'allow' &&
    expected.sensitivity === input.privacyDecision.sensitivity &&
    expected.matchedRules.join('\0') ===
      input.privacyDecision.matchedRules.join('\0') &&
    locatorStrings(input.locator).every(
      (value) => !containsSensitiveLiteral(value),
    )
  );
}
