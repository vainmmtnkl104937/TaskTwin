import {
  canonicalizeLocator,
  LocatorBundleSchema,
  type LocatorBundle,
} from '@tasktwin/locator-engine';
import {
  RecordingArtifactSchema,
  RecordingSequenceSchema,
  UuidSchema,
  type RecordingEvent,
} from '@tasktwin/recording-schema';
import {
  WorkflowDefinitionSchema,
  type ElementLocator,
  type WorkflowStep,
  type WorkflowVariable,
} from '@tasktwin/workflow-schema';

import {
  CONVERSION_ISSUE_DETAILS,
  RecordingConversionOptionsSchema,
  RecordingConversionReportSchema,
  WorkflowDraftConversionResultSchema,
  type ConversionIssue,
  type ConversionIssueCode,
  type EventStepMapping,
  type RecordingConversionOptions,
  type UnresolvedRecordingEvent,
  type WorkflowDraftConversionResult,
} from './contracts.js';
import { RecordingConversionInputError } from './errors.js';
import {
  allocateIdentifier,
  createStepName,
  getSafeOptionLabel,
  getSafeTargetName,
} from './naming.js';

type WithoutId<Step> = Step extends unknown ? Omit<Step, 'id'> : never;
type ConvertibleStep = WithoutId<WorkflowStep>;

interface ConvertedEvent {
  step: ConvertibleStep;
  deduplicationKey: string | null;
}

interface UnresolvedEvent {
  issueCode: ConversionIssueCode;
}

interface PreviousDeduplication {
  key: string;
  retainedEventId: string;
  retainedStepId: string;
}

const SUPPORTED_EVENT_TYPES = new Set([
  'click',
  'text-input',
  'select',
  'checkbox',
  'radio',
]);

function issue(
  code: ConversionIssueCode,
  source?: {
    eventId: string;
    sequence: number;
    stepId?: string;
  },
): ConversionIssue {
  const details = CONVERSION_ISSUE_DETAILS[code];
  return {
    code,
    severity: details.severity,
    message: details.message,
    ...(source === undefined
      ? {}
      : {
          eventId: source.eventId,
          sequence: source.sequence,
          ...(source.stepId === undefined ? {} : { stepId: source.stepId }),
        }),
  };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputIssueSource(
  event: Record<string, unknown>,
): { eventId: string; sequence: number } | undefined {
  const eventId = UuidSchema.safeParse(event.eventId);
  const sequence = RecordingSequenceSchema.safeParse(event.sequence);
  return eventId.success && sequence.success
    ? { eventId: eventId.data, sequence: sequence.data }
    : undefined;
}

function createInvalidRecordingIssues(
  recordingInput: unknown,
): ConversionIssue[] {
  if (
    !isUnknownRecord(recordingInput) ||
    !Array.isArray(recordingInput.events)
  ) {
    return [issue('INVALID_EVENT_PAYLOAD')];
  }

  const issues: ConversionIssue[] = [];
  for (const eventInput of recordingInput.events) {
    if (!isUnknownRecord(eventInput)) {
      issues.push(issue('INVALID_EVENT_PAYLOAD'));
      continue;
    }

    const source = inputIssueSource(eventInput);
    if (
      typeof eventInput.eventType === 'string' &&
      !SUPPORTED_EVENT_TYPES.has(eventInput.eventType)
    ) {
      issues.push(issue('UNSUPPORTED_EVENT_TYPE', source));
      continue;
    }

    if (
      !('locatorBundle' in eventInput) ||
      !LocatorBundleSchema.safeParse(eventInput.locatorBundle).success
    ) {
      issues.push(issue('NO_USABLE_LOCATOR', source));
      continue;
    }

    issues.push(issue('INVALID_EVENT_PAYLOAD', source));
  }

  return issues.length === 0 ? [issue('INVALID_EVENT_PAYLOAD')] : issues;
}

function stepId(index: number): string {
  return `step-${String(index).padStart(3, '0')}`;
}

function sequenceFallback(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(3, '0')}`;
}

function literalDeduplicationKey(
  type: 'fill' | 'select',
  locator: ElementLocator,
  value: string,
): string {
  return JSON.stringify({
    type,
    locator: canonicalizeLocator(locator),
    value,
  });
}

function checkedDeduplicationKey(
  locator: ElementLocator,
  checked: boolean,
): string {
  return JSON.stringify({
    type: 'setChecked',
    locator: canonicalizeLocator(locator),
    checked,
  });
}

function isReplayablePassword(event: RecordingEvent): boolean {
  return (
    event.eventType === 'text-input' &&
    event.privacyDecision.sensitivity === 'authentication' &&
    (event.target.inputType === 'password' ||
      event.privacyDecision.matchedRules.includes('AUTH_PASSWORD_TYPE')) &&
    (event.target.tagName === 'input' || event.target.tagName === 'textarea')
  );
}

function convertEvent(
  event: RecordingEvent,
  locatorBundle: LocatorBundle,
  variables: WorkflowVariable[],
  usedValueNames: Set<string>,
): ConvertedEvent | UnresolvedEvent {
  const locator = locatorBundle.primary.locator;
  const targetName = getSafeTargetName(event.target);

  switch (event.eventType) {
    case 'click':
      return {
        step: {
          type: 'click',
          name: createStepName('click', targetName),
          locator,
        },
        deduplicationKey: null,
      };

    case 'text-input': {
      if (event.payload.capturePolicy === 'allow') {
        if (event.payload.truncated) {
          return { issueCode: 'TRUNCATED_VALUE_UNRESOLVED' };
        }
        return {
          step: {
            type: 'fill',
            name: createStepName('fill', targetName),
            locator,
            value: { kind: 'literal', value: event.payload.value },
          },
          deduplicationKey: literalDeduplicationKey(
            'fill',
            locator,
            event.payload.value,
          ),
        };
      }

      if (
        event.payload.capturePolicy === 'mask' &&
        event.privacyDecision.sensitivity === 'personal'
      ) {
        const preferred = targetName ?? '';
        const variableName = allocateIdentifier(
          preferred,
          sequenceFallback('inputValue', event.sequence),
          usedValueNames,
        );
        variables.push({
          name: variableName,
          valueType: 'string',
          required: true,
          description: `Value for ${targetName ?? 'recorded field'}.`,
        });
        return {
          step: {
            type: 'fill',
            name: createStepName('fill', targetName),
            locator,
            value: { kind: 'variable', variableName },
          },
          deduplicationKey: null,
        };
      }

      if (event.payload.capturePolicy === 'mask') {
        return { issueCode: 'MASKED_VALUE_UNRESOLVED' };
      }

      if (isReplayablePassword(event)) {
        const preferred = targetName ?? '';
        const secretName = allocateIdentifier(
          preferred,
          sequenceFallback('secretValue', event.sequence),
          usedValueNames,
        );
        return {
          step: {
            type: 'fill',
            name: createStepName('fill', targetName),
            locator,
            value: { kind: 'secret', secretName },
          },
          deduplicationKey: null,
        };
      }

      return { issueCode: 'BLOCKED_VALUE_UNRESOLVED' };
    }

    case 'select':
      if (event.payload.capturePolicy !== 'allow') {
        return {
          issueCode:
            event.payload.capturePolicy === 'mask'
              ? 'MASKED_VALUE_UNRESOLVED'
              : 'BLOCKED_VALUE_UNRESOLVED',
        };
      }
      if (event.payload.truncated) {
        return { issueCode: 'TRUNCATED_VALUE_UNRESOLVED' };
      }
      return {
        step: {
          type: 'select',
          name: createStepName(
            'select',
            targetName,
            getSafeOptionLabel(event.payload.label),
          ),
          locator,
          value: { kind: 'literal', value: event.payload.value },
        },
        deduplicationKey: literalDeduplicationKey(
          'select',
          locator,
          event.payload.value,
        ),
      };

    case 'checkbox':
      if (event.payload.capturePolicy !== 'allow') {
        return {
          issueCode:
            event.payload.capturePolicy === 'mask'
              ? 'MASKED_VALUE_UNRESOLVED'
              : 'BLOCKED_VALUE_UNRESOLVED',
        };
      }
      return {
        step: {
          type: 'setChecked',
          name: createStepName(
            event.payload.checked ? 'enable' : 'disable',
            targetName,
          ),
          locator,
          checked: event.payload.checked,
        },
        deduplicationKey: checkedDeduplicationKey(
          locator,
          event.payload.checked,
        ),
      };

    case 'radio':
      if (
        event.payload.capturePolicy !== 'allow' ||
        event.payload.checked !== true
      ) {
        return {
          issueCode:
            event.payload.capturePolicy === 'mask'
              ? 'MASKED_VALUE_UNRESOLVED'
              : 'BLOCKED_VALUE_UNRESOLVED',
        };
      }
      return {
        step: {
          type: 'setChecked',
          name: createStepName('enable', targetName),
          locator,
          checked: true,
        },
        deduplicationKey: checkedDeduplicationKey(locator, true),
      };
  }
}

function unresolvedMapping(
  event: RecordingEvent,
  code: ConversionIssueCode,
  locatorBundle?: LocatorBundle,
): {
  mapping: EventStepMapping;
  unresolved: UnresolvedRecordingEvent;
  issue: ConversionIssue;
} {
  const source = {
    eventId: event.eventId,
    sequence: event.sequence,
  };
  return {
    mapping: {
      eventId: event.eventId,
      sequence: event.sequence,
      eventType: event.eventType,
      outcome: 'unresolved',
      issueCodes: [code],
      ...(locatorBundle === undefined ? {} : { locatorBundle }),
    },
    unresolved: {
      ...source,
      eventType: event.eventType,
      issueCodes: [code],
    },
    issue: issue(code, source),
  };
}

function createReport(input: {
  clientSessionId: string;
  eventCount: number;
  steps: WorkflowStep[];
  variables: WorkflowVariable[];
  mappings: EventStepMapping[];
  issues: ConversionIssue[];
  unresolvedEvents: UnresolvedRecordingEvent[];
}): ReturnType<typeof RecordingConversionReportSchema.parse> {
  const hasBlockingIssue = input.issues.some(
    (item) => item.severity === 'blocking',
  );
  return RecordingConversionReportSchema.parse({
    schemaVersion: 1,
    sourceClientSessionId: input.clientSessionId,
    sourceEventCount: input.eventCount,
    generatedStepCount: input.steps.length,
    generatedVariableCount: input.variables.length,
    deduplicatedEventCount: input.mappings.filter(
      (mapping) => mapping.outcome === 'deduplicated',
    ).length,
    unresolvedEventCount: input.unresolvedEvents.length,
    mappings: input.mappings,
    issues: input.issues,
    unresolvedEvents: input.unresolvedEvents,
    publishable: !hasBlockingIssue,
  });
}

export function convertRecordingArtifact(
  recordingInput: unknown,
  optionsInput: unknown,
): WorkflowDraftConversionResult {
  const parsedRecording = RecordingArtifactSchema.safeParse(recordingInput);
  if (!parsedRecording.success) {
    throw new RecordingConversionInputError(
      createInvalidRecordingIssues(recordingInput),
    );
  }
  const recording = parsedRecording.data;
  const options: RecordingConversionOptions =
    RecordingConversionOptionsSchema.parse(optionsInput);
  const steps: WorkflowStep[] = [];
  const variables: WorkflowVariable[] = [];
  const mappings: EventStepMapping[] = [];
  const issues: ConversionIssue[] = [];
  const unresolvedEvents: UnresolvedRecordingEvent[] = [];
  const usedValueNames = new Set<string>();
  const deduplicationState: {
    previous: PreviousDeduplication | null;
  } = { previous: null };

  for (const event of recording.events) {
    const parsedLocator = LocatorBundleSchema.safeParse(event.locatorBundle);
    if (!parsedLocator.success) {
      const unresolved = unresolvedMapping(event, 'NO_USABLE_LOCATOR');
      mappings.push(unresolved.mapping);
      unresolvedEvents.push(unresolved.unresolved);
      issues.push(unresolved.issue);
      deduplicationState.previous = null;
      continue;
    }

    const converted = convertEvent(
      event,
      parsedLocator.data,
      variables,
      usedValueNames,
    );
    if ('issueCode' in converted) {
      const unresolved = unresolvedMapping(
        event,
        converted.issueCode,
        parsedLocator.data,
      );
      mappings.push(unresolved.mapping);
      unresolvedEvents.push(unresolved.unresolved);
      issues.push(unresolved.issue);
      deduplicationState.previous = null;
      continue;
    }

    if (
      converted.deduplicationKey !== null &&
      deduplicationState.previous?.key === converted.deduplicationKey
    ) {
      const retained = deduplicationState.previous;
      mappings.push({
        eventId: event.eventId,
        sequence: event.sequence,
        eventType: event.eventType,
        outcome: 'deduplicated',
        retainedEventId: retained.retainedEventId,
        retainedStepId: retained.retainedStepId,
        locatorBundle: parsedLocator.data,
      });
      issues.push(
        issue('DUPLICATE_EVENT_REMOVED', {
          eventId: event.eventId,
          sequence: event.sequence,
          stepId: retained.retainedStepId,
        }),
      );
      continue;
    }

    const generatedStepId = stepId(steps.length + 1);
    const workflowStep = {
      id: generatedStepId,
      ...converted.step,
    } as WorkflowStep;
    steps.push(workflowStep);
    mappings.push({
      eventId: event.eventId,
      sequence: event.sequence,
      eventType: event.eventType,
      outcome: 'converted',
      stepId: generatedStepId,
      locatorBundle: parsedLocator.data,
    });

    if (parsedLocator.data.confidence === 'low') {
      issues.push(
        issue('LOW_LOCATOR_CONFIDENCE', {
          eventId: event.eventId,
          sequence: event.sequence,
          stepId: generatedStepId,
        }),
      );
    }

    deduplicationState.previous =
      converted.deduplicationKey === null
        ? null
        : {
            key: converted.deduplicationKey,
            retainedEventId: event.eventId,
            retainedStepId: generatedStepId,
          };
  }

  if (steps.length === 0) {
    issues.push(issue('NO_EXECUTABLE_STEPS'));
    const report = createReport({
      clientSessionId: recording.clientSessionId,
      eventCount: recording.eventCount,
      steps,
      variables,
      mappings,
      issues,
      unresolvedEvents,
    });
    return WorkflowDraftConversionResultSchema.parse({
      schemaVersion: 1,
      outcome: 'no-executable-steps',
      workflowDefinition: null,
      report,
    });
  }

  const workflowDefinition = WorkflowDefinitionSchema.parse({
    schemaVersion: 1,
    workflowId: options.workflowId,
    version: 1,
    name: options.workflowName,
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    status: 'draft',
    variables,
    steps,
  });
  const report = createReport({
    clientSessionId: recording.clientSessionId,
    eventCount: recording.eventCount,
    steps,
    variables,
    mappings,
    issues,
    unresolvedEvents,
  });

  return WorkflowDraftConversionResultSchema.parse({
    schemaVersion: 1,
    outcome: 'draft',
    workflowDefinition,
    report,
  });
}
