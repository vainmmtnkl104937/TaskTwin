import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRIVACY_SETTINGS,
  type PrivacySettings,
} from '@tasktwin/privacy-engine';

import {
  ChromeLocalPrivacySettingsStore,
  PRIVACY_SETTINGS_STORAGE_KEY,
  type PrivacySettingsStorageArea,
} from '../src/content/privacy-settings-storage.js';

class FakeLocalStorage implements PrivacySettingsStorageArea {
  readonly values: Record<string, unknown> = {};

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve({ [key]: this.values[key] });
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}

describe('ChromeLocalPrivacySettingsStore', () => {
  it('returns safe defaults when settings are missing or invalid', async () => {
    const storage = new FakeLocalStorage();
    const store = new ChromeLocalPrivacySettingsStore(storage);

    await expect(store.load()).resolves.toEqual(DEFAULT_PRIVACY_SETTINGS);

    storage.values[PRIVACY_SETTINGS_STORAGE_KEY] = {
      schemaVersion: 1,
      personalDataPolicy: 'allow',
      redactAllTextInputs: false,
      showRedactionPreview: false,
      weakenBlockedPolicies: true,
    };
    await expect(store.load()).resolves.toEqual(DEFAULT_PRIVACY_SETTINGS);
  });

  it('validates and saves settings under the versioned local key', async () => {
    const storage = new FakeLocalStorage();
    const store = new ChromeLocalPrivacySettingsStore(storage);
    const settings: PrivacySettings = {
      schemaVersion: 1,
      personalDataPolicy: 'allow',
      redactAllTextInputs: true,
      showRedactionPreview: true,
    };

    await expect(store.save(settings)).resolves.toEqual(settings);
    await expect(store.load()).resolves.toEqual(settings);
  });

  it('rejects invalid settings without mutating storage', async () => {
    const storage = new FakeLocalStorage();
    const store = new ChromeLocalPrivacySettingsStore(storage);

    await expect(
      store.save({
        schemaVersion: 1,
        personalDataPolicy: 'block',
        redactAllTextInputs: false,
        showRedactionPreview: false,
      }),
    ).rejects.toBeDefined();
    expect(storage.values).toEqual({});
  });
});
