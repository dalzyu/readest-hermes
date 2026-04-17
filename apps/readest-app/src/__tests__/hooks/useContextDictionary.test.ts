import { beforeEach, describe, expect, test, vi } from 'vitest';
vi.mock('@/hooks/useContextLookup', () => ({
  useContextLookup: vi.fn(),
}));

import { useContextDictionary } from '@/hooks/useContextDictionary';
import { useContextLookup } from '@/hooks/useContextLookup';
import type { UseContextLookupResult } from '@/hooks/useContextLookup';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  LookupAnnotationSlots,
  LookupExample,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
} from '@/services/contextTranslation/types';

const popupContextBundle: PopupContextBundle = {
  localPastContext: 'context text',
  localFutureBuffer: '',
  sameBookChunks: [],
  priorVolumeChunks: [],
  dictionaryEntries: [],
  retrievalStatus: 'local-only',
  retrievalHints: {
    currentVolumeIndexed: true,
    missingLocalIndex: false,
    missingPriorVolumes: [],
    missingSeriesAssignment: false,
  },
};

const retrievalHints: PopupRetrievalHints = {
  currentVolumeIndexed: true,
  missingLocalIndex: false,
  missingPriorVolumes: [],
  missingSeriesAssignment: false,
};

const lookupExamples: LookupExample[] = [];
const lookupAnnotations: LookupAnnotationSlots | null = null;
const lookupResult: UseContextLookupResult = {
  result: { simpleDefinition: 'simple definition' },
  partialResult: null,
  loading: false,
  streaming: false,
  activeFieldId: null,
  error: null,
  aiUnavailable: false,
  expandedText: null,
  validationDecision: null,
  retrievalStatus: 'local-only' as RetrievalStatus,
  retrievalHints,
  popupContext: popupContextBundle,
  examples: lookupExamples,
  annotations: lookupAnnotations,
  debugInfo: null,
  saveToVocabulary: vi.fn(async () => {}),
};

const defaultProps = {
  bookKey: 'book-1',
  bookHash: 'hash-1',
  selectedText: '知己',
  currentPage: 1,
  translationSettings: {
    enabled: true,
    targetLanguage: 'en',
    recentContextPages: 1,
    lookAheadWords: 16,
    sameBookRagEnabled: true,
    priorVolumeRagEnabled: false,
    sameBookChunkCount: 3,
    priorVolumeChunkCount: 0,
    outputFields: [],
    source: 'ai',
  } as ContextTranslationSettings,
  dictionarySettings: {
    enabled: true,
    sourceExamples: true,
    source: 'ai',
  } as ContextDictionarySettings,
};

beforeEach(() => {
  vi.mocked(useContextLookup).mockReturnValue(lookupResult);
});

describe('useContextDictionary', () => {
  test('maps dictionary props through the shared lookup hook', () => {
    const result = useContextDictionary(defaultProps);

    expect(useContextLookup).toHaveBeenCalledWith({
      mode: 'dictionary',
      bookKey: defaultProps.bookKey,
      bookHash: defaultProps.bookHash,
      selectedText: defaultProps.selectedText,
      currentPage: defaultProps.currentPage,
      settings: defaultProps.translationSettings,
      dictionarySettings: defaultProps.dictionarySettings,
    });
    expect(result.popupContext).toBe(popupContextBundle);
    expect(result.result).toBeNull();
    expect(result.examples).toEqual(lookupExamples);
  });

  test('merges dictionary-backed fields over AI results when configured', () => {
    vi.mocked(useContextLookup).mockReturnValue({
      ...lookupResult,
      result: {
        simpleDefinition: 'ai definition',
        contextualMeaning: 'ai contextual meaning',
        sourceExamples: 'ai examples',
      },
      partialResult: {
        simpleDefinition: 'streaming ai definition',
        contextualMeaning: 'streaming ai contextual meaning',
        sourceExamples: 'streaming ai examples',
      },
      popupContext: {
        ...popupContextBundle,
        dictionaryResults: [{ headword: '知己', definition: '辞書定義', source: 'Test Dict' }],
      },
      examples: [
        { exampleId: '1', sourceText: '彼は知己だ。', targetText: 'He is a close friend.' },
      ],
    });

    const result = useContextDictionary({
      ...defaultProps,
      dictionarySettings: {
        ...defaultProps.dictionarySettings,
        fieldSources: {
          simpleDefinition: 'dictionary',
          contextualMeaning: 'ai',
          sourceExamples: 'dictionary',
        },
      },
    });

    expect(result.result).toEqual({
      simpleDefinition: '辞書定義',
      contextualMeaning: 'ai contextual meaning',
    });
    expect(result.partialResult).toEqual({
      simpleDefinition: '辞書定義',
      contextualMeaning: 'streaming ai contextual meaning',
    });
    expect(result.examples).toEqual([]);
  });
});
