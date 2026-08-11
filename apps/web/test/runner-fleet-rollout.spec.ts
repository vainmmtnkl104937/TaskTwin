import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Runner Fleet and rollout UI safety', () => {
  it('shows actual, desired, compliance, runtime and service state', () => {
    const fleet = source(
      'app/(authenticated)/workspaces/[workspaceId]/fleet/page.tsx',
    );
    expect(fleet).toContain('Actual version');
    expect(fleet).toContain('Desired version');
    expect(fleet).toContain('Compliance');
    expect(fleet).toContain('Runtime');
    expect(fleet).toContain('Service state');
  });

  it('shows manual stage progression, convergence and rollback state', () => {
    const detail = source(
      'app/(authenticated)/workspaces/[workspaceId]/runner-rollouts/[rolloutId]/page.tsx',
    );
    expect(detail).toContain('Activate Stage');
    expect(detail).toContain('Converged');
    expect(detail).toContain('Rolled');
    expect(detail).toContain("stage.status === 'pending'");
  });

  it('contains no remote software or shell control', () => {
    const pages = [
      source('app/(authenticated)/workspaces/[workspaceId]/fleet/page.tsx'),
      source(
        'app/(authenticated)/workspaces/[workspaceId]/runner-rollouts/page.tsx',
      ),
      source(
        'app/(authenticated)/workspaces/[workspaceId]/runner-rollouts/[rolloutId]/page.tsx',
      ),
    ].join('\n');
    expect(pages).not.toMatch(
      /Update Now|remote install|Run command|PowerShell|remote shell/i,
    );
  });
});
