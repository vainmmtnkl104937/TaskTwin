import {
  DEFAULT_PRIVACY_SETTINGS,
  PrivacySettingsSchema,
  type PrivacySettings,
} from '@tasktwin/privacy-engine';

export const PRIVACY_SETTINGS_STORAGE_KEY = 'tasktwin.privacy.settings.v1';

export interface PrivacySettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class ChromeLocalPrivacySettingsStore {
  constructor(
    private readonly storage: PrivacySettingsStorageArea = chrome.storage.local,
  ) {}

  async load(): Promise<PrivacySettings> {
    const stored = await this.storage.get(PRIVACY_SETTINGS_STORAGE_KEY);
    const parsed = PrivacySettingsSchema.safeParse(
      stored[PRIVACY_SETTINGS_STORAGE_KEY],
    );
    return parsed.success
      ? parsed.data
      : structuredClone(DEFAULT_PRIVACY_SETTINGS);
  }

  async save(settings: unknown): Promise<PrivacySettings> {
    const validated = PrivacySettingsSchema.parse(settings);
    await this.storage.set({
      [PRIVACY_SETTINGS_STORAGE_KEY]: validated,
    });
    return validated;
  }
}
