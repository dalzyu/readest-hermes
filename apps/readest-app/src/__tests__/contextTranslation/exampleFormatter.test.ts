import { describe, expect, test } from 'vitest';
import { formatTranslationResult } from '@/services/contextTranslation/exampleFormatter';
import type { TranslationOutputField } from '@/services/contextTranslation/types';

const fields: TranslationOutputField[] = [
  {
    id: 'translation',
    label: 'Translation',
    enabled: true,
    order: 0,
    promptInstruction: 'Provide a direct translation.',
  },
  {
    id: 'examples',
    label: 'Usage Examples',
    enabled: true,
    order: 1,
    promptInstruction: 'Give usage examples.',
  },
];

const chineseRequest = {
  selectedText: '\u6bbf\u4e0b',
  recentContext: 'context',
  sourceLanguage: 'zh' as const,
  targetLanguage: 'en',
  outputFields: fields,
};

const closeFriendRequest = {
  ...chineseRequest,
  selectedText: '\u77e5\u5df1',
};

describe('formatTranslationResult', () => {
  test('adds deterministic pinyin to chinese examples', () => {
    const result = formatTranslationResult(
      {
        translation: 'Your Highness',
        examples: '1. \u77e5\u5df1\u96be\u9022\nEnglish: True friends are hard to find.',
      },
      closeFriendRequest,
    );

    expect(result['examples']).toBe(
      '1. \u77e5\u5df1\u96be\u9022\nPinyin: zh\u012b j\u01d0 n\u00e1n f\u00e9ng\nEnglish: True friends are hard to find.',
    );
  });

  test('replaces model-generated pinyin with deterministic pinyin', () => {
    const result = formatTranslationResult(
      {
        examples:
          '1. \u77e5\u5df1\u96be\u9022\nPinyin: wrong pinyin\nEnglish: True friends are hard to find.',
      },
      closeFriendRequest,
    );

    expect(result['examples']).toBe(
      '1. \u77e5\u5df1\u96be\u9022\nPinyin: zh\u012b j\u01d0 n\u00e1n f\u00e9ng\nEnglish: True friends are hard to find.',
    );
  });

  test('splits inline numbered examples into separate list blocks', () => {
    const result = formatTranslationResult(
      {
        examples:
          '1. \u81e3\u6c11\u4eec\u9f50\u58f0\u9ad8\u547c\uff1a\u201c\u6bbf\u4e0b\uff0c\u8bf7\u4e0b\u4ee4\u5427\uff01\u201d Pinyin: stale English: The subjects shouted in unison, "Sire, please give the order!" 2. \u9762\u5bf9\u4f17\u4eba\u7684\u6307\u8d23\uff0c\u6bbf\u4e0b\u4f9d\u65e7\u795e\u8272\u81ea\u82e5\u3002 English: Despite the accusations from the crowd, Your Highness remained calm and composed.',
      },
      chineseRequest,
    );

    expect(result['examples']).toBe(
      '1. \u81e3\u6c11\u4eec\u9f50\u58f0\u9ad8\u547c\uff1a\u201c\u6bbf\u4e0b\uff0c\u8bf7\u4e0b\u4ee4\u5427\uff01\u201d\nPinyin: ch\u00e9n m\u00edn men q\u00ed sh\u0113ng g\u0101o h\u016b di\u00e0n xi\u00e0 q\u01d0ng xi\u00e0 l\u00ecng ba\nEnglish: The subjects shouted in unison, "Sire, please give the order!"\n\n2. \u9762\u5bf9\u4f17\u4eba\u7684\u6307\u8d23\uff0c\u6bbf\u4e0b\u4f9d\u65e7\u795e\u8272\u81ea\u82e5\u3002\nPinyin: mi\u00e0n du\u00ec zh\u00f2ng r\u00e9n de zh\u01d0 z\u00e9 di\u00e0n xi\u00e0 y\u012b ji\u00f9 sh\u00e9n s\u00e8 z\u00ec ru\u00f2\nEnglish: Despite the accusations from the crowd, Your Highness remained calm and composed.',
    );
  });

  test('drops example blocks that do not contain the selected term', () => {
    const result = formatTranslationResult(
      {
        examples:
          '1. \u81e3\u6c11\u4eec\u9f50\u58f0\u9ad8\u547c\uff1a\u201c\u6bbf\u4e0b\uff0c\u8bf7\u4e0b\u4ee4\u5427\uff01\u201d\nEnglish: The subjects shouted in unison.\n\n2. \u4f17\u4eba\u7eb7\u7eb7\u540e\u9000\uff0c\u4e0d\u6562\u62ac\u5934\u3002\nEnglish: The crowd backed away.',
      },
      chineseRequest,
    );

    expect(result['examples']).toBe(
      '1. \u81e3\u6c11\u4eec\u9f50\u58f0\u9ad8\u547c\uff1a\u201c\u6bbf\u4e0b\uff0c\u8bf7\u4e0b\u4ee4\u5427\uff01\u201d\nPinyin: ch\u00e9n m\u00edn men q\u00ed sh\u0113ng g\u0101o h\u016b di\u00e0n xi\u00e0 q\u01d0ng xi\u00e0 l\u00ecng ba\nEnglish: The subjects shouted in unison.',
    );
  });

  test('keeps spacing-variant matches while normalizing layout', () => {
    const result = formatTranslationResult(
      {
        examples:
          '1. \u4ed6\u59cb\u7ec8\u5b88\u5728\u8eab \u4fa7\u3002\nEnglish: He stayed by his side.',
      },
      {
        ...chineseRequest,
        selectedText: '\u8eab\u4fa7',
      },
    );

    expect(result['examples']).toBe(
      '1. \u4ed6\u59cb\u7ec8\u5b88\u5728\u8eab \u4fa7\u3002\nPinyin: t\u0101 sh\u01d0 zh\u014dng sh\u01d2u z\u00e0i sh\u0113n c\u00e8\nEnglish: He stayed by his side.',
    );
  });

  test('english-to-chinese format: only keeps examples containing the selected term', () => {
    const result = formatTranslationResult(
      {
        examples:
          '1. Mr. Dursley worked at Grunnings.\nChinese: 杜斯礼先生在格林尼斯公司工作。\n\n2. He was a big beefy man.\nChinese: 他是个大块头男人。',
      },
      {
        selectedText: 'Grunnings',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        outputFields: [
          {
            id: 'examples',
            label: 'Examples',
            enabled: true,
            order: 0,
            promptInstruction: 'Give examples.',
          },
        ],
      },
    );

    expect(result['examples']).toContain('Grunnings');
    expect(result['examples']).not.toContain('big beefy man');
  });

  test('normalizes english-to-chinese examples into source and chinese translation lines without model pinyin', () => {
    const result = formatTranslationResult(
      {
        examples:
          '1. Mr. Dursley worked at Grunnings.\nPinyin: ignored\nChinese: \u675c\u65af\u793c\u5148\u751f\u5728\u683c\u6797\u5c3c\u65af\u516c\u53f8\u5de5\u4f5c\u3002\n\n2. He looked away from the sign.\nChinese: \u4ed6\u628a\u76ee\u5149\u4ece\u62db\u724c\u4e0a\u79fb\u5f00\u3002',
      },
      {
        ...chineseRequest,
        selectedText: 'Grunnings',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
      },
    );

    expect(result['examples']).toBe(
      '1. Mr. Dursley worked at Grunnings.\nChinese: \u675c\u65af\u793c\u5148\u751f\u5728\u683c\u6797\u5c3c\u65af\u516c\u53f8\u5de5\u4f5c\u3002',
    );
  });

  test('does not add pinyin to japanese-source examples even with pure-kanji selected text', () => {
    const result = formatTranslationResult(
      {
        examples: '1. 彼は不安で眠れなかった。\nEnglish: He could not sleep due to anxiety.',
      },
      {
        selectedText: '不安',
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        outputFields: fields,
      },
    );

    // Should keep the example but must NOT inject Pinyin
    expect(result['examples']).not.toContain('Pinyin:');
  });
});
