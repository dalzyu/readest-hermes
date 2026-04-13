import { describe, expect, test } from 'vitest';
import { buildRepairPrompt } from '@/services/contextTranslation/repairPromptBuilder';

describe('buildRepairPrompt', () => {
  test('generates a repair prompt referencing the original issue', () => {
    const { userPrompt } = buildRepairPrompt({
      originalSystemPrompt: 'Always respond in simplified Chinese.',
      originalUserPrompt: 'Translate 知己',
      issue: 'empty translation field',
      orderedFieldIds: 'translation,contextualMeaning,examples',
    });
    expect(userPrompt).toContain('Translate 知己');
    expect(userPrompt).toContain('empty translation field');
  });

  test('preserves the original system prompt constraints and lookup_json sentinel', () => {
    const { systemPrompt } = buildRepairPrompt({
      originalSystemPrompt: 'Always respond in French.',
      originalUserPrompt: 'Translate x',
      issue: 'missing field',
      orderedFieldIds: 'translation',
    });
    expect(systemPrompt).toContain('Always respond in French.');
    expect(systemPrompt).toContain('<lookup_json>');
  });
});
