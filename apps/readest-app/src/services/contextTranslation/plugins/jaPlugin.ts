import { toRomaji } from 'wanakana';
import type { LookupAnnotations, LookupExample } from '../types';
import type { LookupPlugin } from './types';

function getRomaji(text: string): string {
  const romaji = toRomaji(text).trim();
  return romaji;
}

function buildExampleAnnotations(
  examples: LookupExample[],
  slot: 'source' | 'target',
): LookupAnnotations['examples'] | undefined {
  const key = slot === 'source' ? 'sourceText' : 'targetText';
  const annotations = Object.fromEntries(
    examples
      .map((example) => {
        const romaji = getRomaji(example[key]);
        return romaji && romaji !== example[key] ? [example.exampleId, { phonetic: romaji }] : null;
      })
      .filter((entry): entry is [string, { phonetic: string }] => entry !== null),
  );

  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export const jaPlugin: LookupPlugin = {
  language: 'ja',
  enrichSourceAnnotations(
    _fields: Record<string, string>,
    selectedText: string,
  ): LookupAnnotations | undefined {
    const romaji = getRomaji(selectedText);
    if (!romaji || romaji === selectedText) return undefined;
    return { phonetic: romaji };
  },
  enrichExampleAnnotations(examples, slot) {
    return buildExampleAnnotations(examples, slot);
  },
};
