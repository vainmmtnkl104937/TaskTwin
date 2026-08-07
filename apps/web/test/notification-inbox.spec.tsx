import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationLink, notificationHref } from '@/components/notification-link';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';

describe('typed notification navigation', () => {
  it('maps a run action without accepting a URL', () => {
    const target = { schemaVersion: 1 as const, kind: 'run' as const, workspaceId, workflowRunId: runId };
    expect(notificationHref(target)).toBe(`/workspaces/${workspaceId}/runs/${runId}`);
    const markup = renderToStaticMarkup(<NotificationLink target={target} label="View run" />);
    expect(markup).toContain(`href="/workspaces/${workspaceId}/runs/${runId}"`);
  });

  it('renders labels as text rather than arbitrary HTML', () => {
    const target = { schemaVersion: 1 as const, kind: 'audit' as const, workspaceId };
    const markup = renderToStaticMarkup(<NotificationLink target={target} label={'<img src=x onerror=alert(1)>'} />);
    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
