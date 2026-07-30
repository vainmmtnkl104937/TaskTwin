import { describe, expect, it } from 'vitest';

import { validateControlPlaneOrigin } from './origin.js';

describe('validateControlPlaneOrigin', () => {
  it.each([
    ['http://127.0.0.1:3001', 'http://127.0.0.1:3001'],
    ['http://localhost:3001/', 'http://localhost:3001'],
    ['https://api.tasktwin.example/', 'https://api.tasktwin.example'],
  ])('accepts supported origin %s', (input, expected) => {
    expect(validateControlPlaneOrigin(input)).toBe(expected);
  });

  it.each([
    'http://api.tasktwin.example',
    'https://api.tasktwin.example/path',
    'ftp://api.tasktwin.example',
    'not-a-url',
  ])('rejects unsafe origin %s', (input) => {
    expect(() => validateControlPlaneOrigin(input)).toThrow();
  });
});
