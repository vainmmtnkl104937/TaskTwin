import {
  type RunnerLocatorRepairCandidateTestCommand,
  type RunnerLocatorRepairCandidateTestResult,
} from '@tasktwin/workflow-locator-repair';
import type { Locator } from 'playwright';

import type { BrowserSession } from '../execution/browser-session.js';
import { PlaywrightLocatorAdapter } from '../execution/locator-adapter.js';

async function readState(locator: Locator, elementKind: string): Promise<void> {
  if (elementKind === 'checkbox' || elementKind === 'radio') {
    await locator.isChecked();
  } else if (elementKind === 'text_input' || elementKind === 'select') {
    await locator.inputValue();
  } else {
    await locator.textContent();
  }
}

export async function testLocatorRepairCandidate(input: {
  session: BrowserSession;
  command: RunnerLocatorRepairCandidateTestCommand;
  clientTestResultId: string;
}): Promise<RunnerLocatorRepairCandidateTestResult> {
  const base = {
    schemaVersion: 1 as const,
    clientTestResultId: input.clientTestResultId,
    pageContextDigest: input.session.currentPageContextDigest(),
  };
  if (base.pageContextDigest !== input.command.pageContextDigest) {
    return { ...base, status: 'STALE_PAGE_CONTEXT', observations: [] };
  }
  try {
    const locator = new PlaywrightLocatorAdapter(
      input.session.page,
      1_000,
    ).create(input.command.locator);
    const count = await locator.count();
    if (count === 0) return { ...base, status: 'NOT_FOUND', observations: [] };
    if (count !== 1) return { ...base, status: 'NOT_UNIQUE', observations: [] };
    const observations: RunnerLocatorRepairCandidateTestResult['observations'] =
      ['UNIQUE_MATCH', 'CONTROL_COMPATIBLE'];
    const visible = await locator.isVisible();
    observations.push(visible ? 'VISIBLE' : 'HIDDEN');
    if (
      input.command.requirement === 'click_actionable' ||
      input.command.requirement === 'select_actionable' ||
      input.command.requirement === 'checked_actionable'
    ) {
      if (!visible || !(await locator.isEnabled())) {
        return { ...base, status: 'NOT_ACTIONABLE', observations };
      }
      observations.push('ENABLED');
    } else if (input.command.requirement === 'fill_editable') {
      if (!visible || !(await locator.isEditable())) {
        return { ...base, status: 'NOT_ACTIONABLE', observations };
      }
      observations.push('EDITABLE');
    } else {
      await readState(locator, input.command.elementKind);
      observations.push('STATE_READABLE');
    }
    return { ...base, status: 'PASSED', observations };
  } catch {
    return { ...base, status: 'ERROR', observations: [] };
  }
}
