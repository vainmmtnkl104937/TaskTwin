import { describe, expect, it } from 'vitest';

import {
  RunStateMachine,
  SafeExecutionException,
  StepStateMachine,
  validRunTransitions,
  validStepTransitions,
} from '../src/index.js';

describe('RunStateMachine', () => {
  it('accepts every declared transition', () => {
    for (const [from, targets] of Object.entries(validRunTransitions())) {
      for (const target of targets) {
        const machine = new RunStateMachine();
        const paths: Record<string, string[]> = {
          pending: [],
          validating: ['validating'],
          starting: ['validating', 'starting'],
          running: ['validating', 'starting', 'running'],
          waiting_for_approval: [
            'validating',
            'starting',
            'running',
            'waiting_for_approval',
          ],
          cancelling: ['cancelling'],
        };
        const path = paths[from] ?? [];
        for (const state of path) {
          machine.transition(state as never);
        }
        machine.transition(target);
        expect(machine.state).toBe(target);
      }
    }
  });

  it('rejects invalid and duplicate terminal transitions', () => {
    const machine = new RunStateMachine();
    expect(() => machine.transition('running')).toThrow(SafeExecutionException);
    machine.transition('validating');
    machine.transition('failed');
    expect(() => machine.transition('failed')).toThrow(
      expect.objectContaining({
        safe: expect.objectContaining({ code: 'INVALID_RUN_TRANSITION' }),
      }),
    );
    expect(machine.state).toBe('failed');
  });
});

describe('StepStateMachine', () => {
  const descriptors = [
    { stepId: 'first', stepType: 'click' as const },
    { stepId: 'second', stepType: 'wait' as const },
  ];

  it('supports successful and skipped lifecycles', () => {
    const machine = new StepStateMachine(descriptors);
    machine.transition('first', 'running');
    machine.transition('first', 'succeeded');
    machine.transition('second', 'skipped');
    expect(machine.stateOf('first')).toBe('succeeded');
    expect(machine.stateOf('second')).toBe('skipped');
  });

  it('prevents concurrent running steps and terminal restart', () => {
    const machine = new StepStateMachine(descriptors);
    machine.transition('first', 'running');
    expect(() => machine.transition('second', 'running')).toThrow(
      SafeExecutionException,
    );
    machine.transition('first', 'failed');
    expect(() => machine.transition('first', 'running')).toThrow(
      SafeExecutionException,
    );
  });

  it('declares no transitions from terminal states', () => {
    const transitions = validStepTransitions();
    for (const terminal of [
      'succeeded',
      'failed',
      'cancelled',
      'timed_out',
      'skipped',
      'interrupted',
    ] as const) {
      expect(transitions[terminal]).toEqual([]);
    }
  });
});
