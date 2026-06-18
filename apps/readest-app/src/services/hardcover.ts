import type { HardcoverSettings } from '@/types/settings';

export class HardcoverClient {
  constructor(_settings: Partial<HardcoverSettings>, _mapStore?: HardcoverSyncMapStore) {}
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async validateToken(): Promise<{ valid: boolean; isNetworkError: boolean }> {
    return { valid: false, isNetworkError: false };
  }
  async syncBookNotes(
    _book: unknown,
    _config: unknown,
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    return { inserted: 0, updated: 0, skipped: 0 };
  }
  async pushProgress(_book: unknown, _config: unknown): Promise<void> {}
}
export class HardcoverSyncMapStore {
  constructor(_appService?: unknown) {}
  async get(_bookHash: string): Promise<Record<string, unknown>> {
    return {};
  }
  async set(_bookHash: string, _data: Record<string, unknown>): Promise<void> {}
}
