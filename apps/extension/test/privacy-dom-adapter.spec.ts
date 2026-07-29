// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PRIVACY_SETTINGS } from '@tasktwin/privacy-engine';

import {
  createPrivacyClassificationInput,
  DomRedactionPlanFactory,
} from '../src/content/privacy-dom-adapter.js';

const timestamp = '2026-07-29T10:00:00.000Z';

function setRectangle(
  element: Element,
  rectangle: { x: number; y: number; width: number; height: number },
): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    ...rectangle,
    top: rectangle.y,
    right: rectangle.x + rectangle.width,
    bottom: rectangle.y + rectangle.height,
    left: rectangle.x,
    toJSON: () => rectangle,
  });
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('privacy DOM adapter', () => {
  it('creates bounded allowlisted metadata without reading the control value', () => {
    document.body.innerHTML = `
      <label for="email">Email address</label>
      <input
        id="email"
        name="contactEmail"
        type="email"
        autocomplete="email"
        placeholder="name@example.test"
        value="fixture.person@example.test"
        data-unrelated="must-not-be-collected"
      >
    `;
    const element = document.querySelector('input');
    if (element === null) throw new Error('Missing input');

    const input = createPrivacyClassificationInput(element);
    const serialized = JSON.stringify(input);

    expect(input).toMatchObject({
      schemaVersion: 1,
      tagName: 'input',
      inputType: 'email',
      autocomplete: 'email',
      name: 'contactEmail',
      id: 'email',
      labelText: 'Email address',
      accessibleName: 'Email address',
      placeholder: 'name@example.test',
      role: 'textbox',
    });
    expect(serialized).not.toContain('fixture.person@example.test');
    expect(serialized).not.toContain('data-unrelated');
  });

  it('creates regions only for visible relevant controls and never scans all elements', () => {
    document.body.innerHTML = `
      <input id="email" type="email" autocomplete="email">
      <input id="hidden" type="hidden" name="password">
      <input id="file" type="file" name="passport">
      <input id="zero" type="password">
      <button id="ordinary">Ordinary action</button>
    `;
    const email = document.querySelector('#email');
    const zero = document.querySelector('#zero');
    if (email === null || zero === null) throw new Error('Missing controls');
    setRectangle(email, { x: 10, y: 20, width: 200, height: 40 });
    setRectangle(zero, { x: 10, y: 80, width: 0, height: 40 });
    const query = vi.spyOn(document, 'querySelectorAll');

    const plan = new DomRedactionPlanFactory(document).create(
      DEFAULT_PRIVACY_SETTINGS,
      timestamp,
    );

    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]).toMatchObject({
      x: 10,
      y: 20,
      width: 200,
      height: 40,
      sensitivity: 'personal',
    });
    expect(query).not.toHaveBeenCalledWith('*');
    expect(JSON.stringify(plan)).not.toContain('value');
  });

  it('includes ordinary text controls only when redact-all is enabled', () => {
    document.body.innerHTML =
      '<input id="note" type="text" name="ordinaryNote">';
    const note = document.querySelector('input');
    if (note === null) throw new Error('Missing input');
    setRectangle(note, { x: 40, y: 50, width: 300, height: 44 });
    const factory = new DomRedactionPlanFactory(document);

    expect(
      factory.create(DEFAULT_PRIVACY_SETTINGS, timestamp).regions,
    ).toHaveLength(0);
    expect(
      factory.create(
        {
          ...DEFAULT_PRIVACY_SETTINGS,
          redactAllTextInputs: true,
        },
        timestamp,
      ).regions,
    ).toHaveLength(1);
  });

  it('honors personal allow while blocked categories remain redacted', () => {
    document.body.innerHTML = `
      <input id="email" type="email" autocomplete="email">
      <input id="password" type="password" autocomplete="current-password">
    `;
    const email = document.querySelector('#email');
    const password = document.querySelector('#password');
    if (email === null || password === null) {
      throw new Error('Missing controls');
    }
    setRectangle(email, { x: 10, y: 20, width: 200, height: 40 });
    setRectangle(password, { x: 10, y: 80, width: 200, height: 40 });

    const plan = new DomRedactionPlanFactory(document).create(
      {
        ...DEFAULT_PRIVACY_SETTINGS,
        personalDataPolicy: 'allow',
      },
      timestamp,
    );

    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0]?.sensitivity).toBe('authentication');
  });

  it('returns viewport-clamped CSS-pixel coordinates', () => {
    document.body.innerHTML =
      '<input id="password" type="password" autocomplete="current-password">';
    const password = document.querySelector('input');
    if (password === null) throw new Error('Missing input');
    setRectangle(password, { x: -10, y: -5, width: 60, height: 45 });

    const plan = new DomRedactionPlanFactory(document).create(
      DEFAULT_PRIVACY_SETTINGS,
      timestamp,
    );

    expect(plan.regions[0]).toMatchObject({
      x: 0,
      y: 0,
      width: 50,
      height: 40,
    });
    expect(plan.viewport.devicePixelRatio).toBeGreaterThan(0);
  });

  it('merges overlapping sensitive rectangles deterministically', () => {
    document.body.innerHTML = `
      <input id="email" type="email" autocomplete="email">
      <input id="password" type="password" autocomplete="current-password">
    `;
    const email = document.querySelector('#email');
    const password = document.querySelector('#password');
    if (email === null || password === null) {
      throw new Error('Missing controls');
    }
    setRectangle(email, { x: 10, y: 20, width: 200, height: 40 });
    setRectangle(password, { x: 20, y: 20, width: 200, height: 40 });

    const first = new DomRedactionPlanFactory(document).create(
      DEFAULT_PRIVACY_SETTINGS,
      timestamp,
    );
    const second = new DomRedactionPlanFactory(document).create(
      DEFAULT_PRIVACY_SETTINGS,
      timestamp,
    );

    expect(first).toEqual(second);
    expect(first.regions).toHaveLength(1);
    expect(first.regions[0]).toMatchObject({
      x: 10,
      y: 20,
      width: 210,
      height: 40,
      sensitivity: 'authentication',
    });
  });
});
