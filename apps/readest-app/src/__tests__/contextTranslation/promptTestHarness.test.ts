import { describe, expect, test } from 'vitest';

import { runPromptEval } from '@/services/contextTranslation/promptTestHarness';

describe('runPromptEval', () => {
  test('does not request an LLM phonetic field in the eval harness prompt', async () => {
    const prompts: Array<{ systemPrompt: string; userPrompt: string; label?: string }> = [];

    await runPromptEval(
      [
        {
          id: 'en-ru-000',
          sourceText: 'estranged',
          sourceLanguage: 'en',
          targetLanguage: 'ru',
          bookContext: 'She returned home and found every familiar room subtly hostile.',
        },
      ],
      async (systemPrompt, userPrompt, label) => {
        prompts.push({ systemPrompt, userPrompt, label });
        return {
          text: '<translation>�����اէ֧ߧߧѧ�</translation>\n<contextualMeaning>����ӧ��ӧ���ѧ� �ԧݧ�ҧ�ܧ�� �ӧߧ���֧ߧߧ�� ���էѧݧ֧ߧߧ����.</contextualMeaning>\n<examples>���ߧ� �ӧ��ݧ� �� �է�� �����اէ֧ߧߧ��. ���ԧ� �ԧ�ݧ�� �٧ӧ��ѧ� �����اէ֧ߧߧ� �� �����.</examples>',
        };
      },
      { model: 'test-model', provider: 'test-provider' },
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.systemPrompt).not.toContain('<phonetic>');
    expect(prompts[0]?.systemPrompt).not.toMatch(/phonetic reading|pinyin|romaji|IPA/i);
    expect(prompts[0]?.systemPrompt).toContain('1-3 words maximum');
    expect(prompts[0]?.systemPrompt).toContain('TARGET LANGUAGE');
  });

  test('per-field rescue never requests a phonetic field', async () => {
    const labels: string[] = [];

    await runPromptEval(
      [
        {
          id: 'en-de-000',
          sourceText: 'unmoored',
          sourceLanguage: 'en',
          targetLanguage: 'de',
          bookContext: 'The ice and silence left him feeling psychically adrift.',
        },
      ],
      async (_systemPrompt, _userPrompt, label) => {
        labels.push(label ?? 'unknown');

        if (label === 'initial') {
          return { text: '<contextualMeaning>Fehlt.</contextualMeaning>' };
        }

        if (label === 'repair') {
          return { text: '<contextualMeaning>Immer noch unvollst?ndig.</contextualMeaning>' };
        }

        return { text: `value-for-${label}` };
      },
      { model: 'test-model', provider: 'test-provider' },
    );

    expect(labels).toEqual([
      'initial',
      'repair',
      'field:translation',
      'field:contextualMeaning',
      'field:examples',
    ]);
    expect(labels).not.toContain('field:phonetic');
  });
});
