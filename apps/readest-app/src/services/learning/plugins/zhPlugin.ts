import { pinyin } from 'pinyin-pro';
import type { LookupAnnotations, LookupExample } from '../types';
import type { LookupPlugin } from './types';

function getPhonetic(text: string): string {
  return pinyin(text, {
    toneType: 'symbol',
    nonZh: 'removed',
    type: 'string',
  }).trim();
}

function buildExampleAnnotations(
  examples: LookupExample[],
  slot: 'source' | 'target',
): LookupAnnotations['examples'] | undefined {
  const key = slot === 'source' ? 'sourceText' : 'targetText';
  const annotations = Object.fromEntries(
    examples
      .map((example) => {
        const phonetic = getPhonetic(example[key]);
        return phonetic ? [example.exampleId, { phonetic }] : null;
      })
      .filter((entry): entry is [string, { phonetic: string }] => entry !== null),
  );

  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export const zhPlugin: LookupPlugin = {
  language: 'zh',
  enrichSourceAnnotations(
    _fields: Record<string, string>,
    selectedText: string,
  ): LookupAnnotations | undefined {
    const phonetic = getPhonetic(selectedText);

    if (!phonetic) {
      return undefined;
    }

    return { phonetic };
  },
  enrichExampleAnnotations(examples, slot) {
    return buildExampleAnnotations(examples, slot);
  },
};
