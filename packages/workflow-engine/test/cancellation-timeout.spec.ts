import { describe, expect, it } from 'vitest';

import { WorkflowEngine } from '../src/index.js';
import {
  EXECUTION_ID,
  FakeAdapter,
  ManualClock,
  executionRequest,
  waitFor,
} from './helpers.js';

function engine(adapter: FakeAdapter, clock = new ManualClock()) {
  return {
    clock,
    engine: new WorkflowEngine(adapter, {
      createExecutionId: () => EXECUTION_ID,
      clock,
    }),
  };
}

describe('workflow cancellation and timeouts', () => {
  it('cancels before validation without starting the adapter', async () => {
    const adapter = new FakeAdapter();
    const controller = new AbortController();
    controller.abort();
    const result = await engine(adapter).engine.execute(
      executionRequest(),
      controller.signal,
    );
    expect(result.status).toBe('cancelled');
    expect(adapter.startCount).toBe(0);
    expect(result.steps.every((step) => step.status === 'skipped')).toBe(true);
    expect(
      result.steps.every((step) => step.skippedReason === 'run_cancelled'),
    ).toBe(true);
  });

  it('cancels an active step, skips later steps and cleans up once', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('first', 'wait-for-abort');
    const controller = new AbortController();
    const execution = engine(adapter).engine.execute(
      executionRequest(),
      controller.signal,
    );
    await waitFor(() => adapter.executed.length === 1);
    controller.abort();
    controller.abort();
    const result = await execution;
    expect(result.status).toBe('cancelled');
    expect(result.steps.map((step) => step.status)).toEqual([
      'cancelled',
      'skipped',
      'skipped',
    ]);
    expect(adapter.executed).toEqual(['first']);
    expect(adapter.stopCount).toBe(1);
  });

  it('cancels during adapter startup and still attempts cleanup', async () => {
    const adapter = new FakeAdapter();
    adapter.startBehavior = 'wait-for-abort';
    const controller = new AbortController();
    const execution = engine(adapter).engine.execute(
      executionRequest(),
      controller.signal,
    );
    await waitFor(() => adapter.startCount === 1);
    controller.abort();
    const result = await execution;
    expect(result.status).toBe('cancelled');
    expect(adapter.executed).toEqual([]);
    expect(adapter.stopCount).toBe(1);
    expect(
      result.steps.every(
        (step) =>
          step.status === 'skipped' && step.skippedReason === 'run_cancelled',
      ),
    ).toBe(true);
  });

  it('reports total timeout during a step and bounds its effective timeout', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('first', 'wait-for-abort');
    const context = engine(adapter);
    const request = executionRequest();
    request.options.totalTimeoutMs = 100;
    request.options.stepTimeoutMs = 1_000;
    const execution = context.engine.execute(request);
    await waitFor(() => adapter.executed.length === 1);
    context.clock.advance(100);
    const result = await execution;
    expect(result.status).toBe('timed_out');
    expect(result.terminationCause).toBe('total_timeout');
    expect(result.steps.map((step) => step.status)).toEqual([
      'timed_out',
      'skipped',
      'skipped',
    ]);
    expect(adapter.effectiveTimeouts).toEqual([100]);
    expect(adapter.stopCount).toBe(1);
  });

  it('reports total timeout during adapter startup and still cleans up', async () => {
    const adapter = new FakeAdapter();
    adapter.startBehavior = 'wait-for-abort';
    const context = engine(adapter);
    const request = executionRequest();
    request.options.totalTimeoutMs = 100;
    const execution = context.engine.execute(request);
    await waitFor(() => adapter.startCount === 1);
    context.clock.advance(100);
    const result = await execution;
    expect(result.status).toBe('timed_out');
    expect(result.terminationCause).toBe('total_timeout');
    expect(adapter.executed).toEqual([]);
    expect(adapter.stopCount).toBe(1);
    expect(
      result.steps.every(
        (step) =>
          step.status === 'skipped' && step.skippedReason === 'run_timed_out',
      ),
    ).toBe(true);
  });

  it('distinguishes a step-level timeout from total timeout', async () => {
    const adapter = new FakeAdapter();
    adapter.behavior.set('first', 'timeout');
    const result = await engine(adapter).engine.execute(executionRequest());
    expect(result.status).toBe('failed');
    expect(result.terminationCause).toBe('step_timeout');
    expect(result.steps[0]).toMatchObject({
      status: 'timed_out',
      error: { code: 'ACTION_TIMEOUT' },
    });
  });

  it('reduces remaining budget between steps', async () => {
    class AdvancingAdapter extends FakeAdapter {
      override async executeStep(
        context: Parameters<FakeAdapter['executeStep']>[0],
      ): Promise<void> {
        await super.executeStep(context);
        clock.advance(250);
      }
    }
    const clock = new ManualClock();
    const adapter = new AdvancingAdapter();
    const request = executionRequest(['first', 'second']);
    request.options.totalTimeoutMs = 1_000;
    request.options.stepTimeoutMs = 1_000;
    await engine(adapter, clock).engine.execute(request);
    expect(adapter.effectiveTimeouts).toEqual([1_000, 750]);
  });
});
