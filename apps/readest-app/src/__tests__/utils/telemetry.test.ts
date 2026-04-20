import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { hasOptedOutTelemetry, TELEMETRY_OPT_OUT_KEY } from '@/utils/telemetry';

describe('hasOptedOutTelemetry', () => {
  let originalLocalStorage: typeof globalThis.localStorage;

  beforeEach(() => {
    originalLocalStorage = globalThis.localStorage;
    localStorage.removeItem(TELEMETRY_OPT_OUT_KEY);
  });

  afterEach(() => {
    vi.stubGlobal('localStorage', originalLocalStorage);
  });

  test('returns true when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(() => hasOptedOutTelemetry()).not.toThrow();
    expect(hasOptedOutTelemetry()).toBe(true);
  });

  test('returns false when opt-out is not set', () => {
    expect(hasOptedOutTelemetry()).toBe(false);
  });
});
