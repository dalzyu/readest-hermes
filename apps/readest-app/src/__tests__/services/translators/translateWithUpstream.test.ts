import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockGetTranslators, mockIsTranslatorAvailable } = vi.hoisted(() => ({
  mockGetTranslators: vi.fn(),
  mockIsTranslatorAvailable: vi.fn(),
}));

vi.mock('@/services/translators/providers', () => ({
  getTranslators: () => mockGetTranslators(),
  isTranslatorAvailable: (translator: MockTranslator, hasToken: boolean) =>
    mockIsTranslatorAvailable(translator, hasToken),
}));

import { translateWithUpstream } from '@/services/translators/translateWithUpstream';

type MockTranslator = {
  name: string;
  label: string;
  disabled?: boolean;
  quotaExceeded?: boolean;
  authRequired?: boolean;
  translate: ReturnType<typeof vi.fn>;
};

function makeTranslator(name: string, output: string): MockTranslator {
  return {
    name,
    label: name,
    translate: vi.fn(async () => [output]),
  };
}

describe('translateWithUpstream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTranslatorAvailable.mockImplementation(
      (translator: MockTranslator, hasToken: boolean) =>
        !translator.disabled && !translator.quotaExceeded && (!translator.authRequired || hasToken),
    );
  });

  test('uses preferred provider when it is available', async () => {
    const deepl = makeTranslator('deepl', 'DeepL result');
    const azure = makeTranslator('azure', 'Azure result');
    mockGetTranslators.mockReturnValue([deepl, azure]);

    const result = await translateWithUpstream({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'ja',
      preferred: 'deepl',
      token: 'auth-token',
    });

    expect(result).toEqual({ text: 'DeepL result', providerUsed: 'deepl' });
    expect(deepl.translate).toHaveBeenCalledTimes(1);
    expect(azure.translate).not.toHaveBeenCalled();
  });

  test('falls back when preferred provider is unavailable', async () => {
    const deepl = makeTranslator('deepl', 'DeepL result');
    deepl.disabled = true;
    const azure = makeTranslator('azure', 'Azure result');
    const google = makeTranslator('google', 'Google result');
    mockGetTranslators.mockReturnValue([deepl, azure, google]);

    const result = await translateWithUpstream({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'ja',
      preferred: 'deepl',
      token: null,
    });

    expect(result).toEqual({ text: 'Azure result', providerUsed: 'azure' });
    expect(azure.translate).toHaveBeenCalledTimes(1);
    expect(google.translate).not.toHaveBeenCalled();
  });

  test('returns empty result when no providers are available', async () => {
    const deepl = makeTranslator('deepl', 'DeepL result');
    deepl.disabled = true;
    const azure = makeTranslator('azure', 'Azure result');
    azure.quotaExceeded = true;
    mockGetTranslators.mockReturnValue([deepl, azure]);

    const result = await translateWithUpstream({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'ja',
      preferred: 'deepl',
      token: null,
    });

    expect(result).toEqual({ text: '', providerUsed: null });
    expect(deepl.translate).not.toHaveBeenCalled();
    expect(azure.translate).not.toHaveBeenCalled();
  });

  test('honors token gating for auth-required providers', async () => {
    const deepl = makeTranslator('deepl', 'DeepL result');
    deepl.authRequired = true;
    const azure = makeTranslator('azure', 'Azure result');
    mockGetTranslators.mockReturnValue([deepl, azure]);

    const withoutToken = await translateWithUpstream({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'ja',
      preferred: 'deepl',
      token: null,
    });
    expect(withoutToken).toEqual({ text: 'Azure result', providerUsed: 'azure' });

    const withToken = await translateWithUpstream({
      text: 'hello',
      sourceLang: 'en',
      targetLang: 'ja',
      preferred: 'deepl',
      token: 'auth-token',
    });
    expect(withToken).toEqual({ text: 'DeepL result', providerUsed: 'deepl' });
  });
});
