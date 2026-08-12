import type { LocalRecordingStorageArea } from '../../../../apps/extension/src/recording-artifacts/archive-store.js';

export class MemoryRecordingStorage implements LocalRecordingStorageArea {
  private readonly values: Record<string, unknown> = {};

  get(key: string): Promise<Record<string, unknown>> {
    return Promise.resolve(
      key in this.values ? { [key]: structuredClone(this.values[key]) } : {},
    );
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}
