import { describe, expect, test } from 'vitest';
import { buildRepairPrompt } from '@/services/contextTranslation/repairPromptBuilder';

describe('buildRepairPrompt', () => {
  test('generates a repair prompt referencing the original issue', () => {
    const { userPrompt } = buildRepairPrompt({
      originalUserPrompt: 'Translate 知己',
      issue: 'empty translation field',
    });
    expect(userPrompt).toContain('Translate 知己');
    expect(userPrompt).toContain('empty translation field');
  });

  test('includes instruction to emit lookup_json sentinel', () => {
    const { systemPrompt } = buildRepairPrompt({
      originalUserPrompt: 'Translate x',
      issue: 'missing field',
    });
    expect(systemPrompt).toContain('<lookup_json>');
  });
});
