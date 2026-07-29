import type { ElementLocator } from '@tasktwin/workflow-schema';

export function canonicalizeLocator(locator: ElementLocator): string {
  switch (locator.kind) {
    case 'testId':
      return JSON.stringify({
        kind: locator.kind,
        attribute: locator.attribute ?? 'data-testid',
        value: locator.value,
      });
    case 'role':
      return JSON.stringify({
        kind: locator.kind,
        role: locator.role,
        name: locator.name ?? null,
        exact: locator.exact ?? false,
      });
    case 'label':
    case 'text':
    case 'placeholder':
      return JSON.stringify({
        kind: locator.kind,
        value: locator.value,
        exact: locator.exact ?? false,
      });
    case 'css':
      return JSON.stringify({
        kind: locator.kind,
        selector: locator.selector,
      });
  }
}
