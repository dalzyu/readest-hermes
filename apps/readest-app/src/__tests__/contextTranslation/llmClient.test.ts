import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGenerateText = vi.fn();
const mockStreamText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  streamText: (...args: unknown[]) => mockStreamText(...args),
}));

import { callLLM, streamLLM } from '@/services/contextTranslation/llmClient';

describe('llmClient reasoning provider options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('callLLM forwards reasoningEffort via providerOptions', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok' });

    await callLLM('system', 'user', 'model' as never, undefined, {
      reasoningEffort: 'high',
      temperature: 0.2,
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          openai: { reasoningEffort: 'high' },
          openrouter: { reasoningEffort: 'high' },
        },
      }),
    );
  });

  test('streamLLM forwards reasoningEffort via providerOptions', async () => {
    mockStreamText.mockReturnValue({
      textStream: (async function* () {
        yield 'A';
        yield 'B';
      })(),
    });

    const chunks: string[] = [];
    for await (const chunk of streamLLM('system', 'user', 'model' as never, undefined, {
      reasoningEffort: 'medium',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['A', 'B']);
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          openai: { reasoningEffort: 'medium' },
          openrouter: { reasoningEffort: 'medium' },
        },
      }),
    );
  });

  test('maps reasoning off to provider none without leaking custom params', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok' });

    await callLLM('system', 'user', 'model' as never, undefined, {
      reasoningEffort: 'off',
      temperature: 0.1,
    });

    const payload = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['reasoningEffort']).toBeUndefined();
    expect(payload['providerOptions']).toEqual({
      openai: { reasoningEffort: 'none' },
      openrouter: { reasoningEffort: 'none' },
    });
  });

  test('does not set providerOptions when reasoningEffort is absent', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok' });

    await callLLM('system', 'user', 'model' as never, undefined, {
      temperature: 0.1,
    });

    const payload = mockGenerateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['providerOptions']).toBeUndefined();
  });
});
