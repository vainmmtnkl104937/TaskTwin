import { describe, expect, it } from 'vitest';

import { safeError } from '../src/index.js';
import { TerminationArbiter } from '../src/termination-arbiter.js';

describe('deterministic termination arbitration', () => {
  it('selects failure when it was recorded before cancellation', () => {
    const arbiter = new TerminationArbiter();
    arbiter.record({
      cause: 'step_failed',
      atMs: 100,
      error: safeError('ACTION_FAILED'),
      stepId: 'failed',
    });
    arbiter.record({
      cause: 'run_cancelled',
      atMs: 101,
      error: safeError('EXECUTION_CANCELLED'),
    });
    expect(arbiter.lockWinner()?.cause).toBe('step_failed');
  });

  it('selects cancellation when it was recorded before failure', () => {
    const arbiter = new TerminationArbiter();
    arbiter.record({
      cause: 'run_cancelled',
      atMs: 100,
      error: safeError('EXECUTION_CANCELLED'),
    });
    arbiter.record({
      cause: 'step_failed',
      atMs: 101,
      error: safeError('ACTION_FAILED'),
      stepId: 'failed',
    });
    expect(arbiter.lockWinner()?.cause).toBe('run_cancelled');
  });

  it('gives the exact total deadline deterministic tie priority', () => {
    const arbiter = new TerminationArbiter();
    arbiter.record({
      cause: 'step_failed',
      atMs: 100,
      error: safeError('ACTION_FAILED'),
      stepId: 'failed',
    });
    arbiter.record({
      cause: 'run_cancelled',
      atMs: 100,
      error: safeError('EXECUTION_CANCELLED'),
    });
    arbiter.record({
      cause: 'total_timeout',
      atMs: 100,
      error: safeError('TOTAL_EXECUTION_TIMEOUT'),
    });
    expect(arbiter.lockWinner()?.cause).toBe('total_timeout');
  });

  it('locks exactly one winner', () => {
    const arbiter = new TerminationArbiter();
    arbiter.record({
      cause: 'step_failed',
      atMs: 100,
      error: safeError('ACTION_FAILED'),
      stepId: 'failed',
    });
    expect(arbiter.lockWinner()?.cause).toBe('step_failed');
    arbiter.record({
      cause: 'total_timeout',
      atMs: 50,
      error: safeError('TOTAL_EXECUTION_TIMEOUT'),
    });
    expect(arbiter.lockWinner()?.cause).toBe('step_failed');
  });
});
