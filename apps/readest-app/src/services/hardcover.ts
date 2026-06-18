export class HardcoverClient {
  async isAvailable(): Promise<boolean> {
    return false;
  }
}

export class HardcoverSyncMapStore {
  async get(_bookHash: string): Promise<Record<string, unknown>> {
    return {};
  }
  async set(_bookHash: string, _data: Record<string, unknown>): Promise<void> {}
}
