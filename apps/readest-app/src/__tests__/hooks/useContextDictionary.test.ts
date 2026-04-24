import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/hooks/useLookupPipeline', () => ({
  useLookupPipeline: vi.fn(),
}));

import { useContextDictionary } from '@/hooks/useContextDictionary';
import { useLookupPipeline } from '@/hooks/useLookupPipeline';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
  LookupAnnotationSlots,
  LookupExample,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
} from '@/services/contextTranslation/types';
import type { UseContextLookupResult } from '@/hooks/useLookupPipeline';

const retrievalHints: PopupRetrievalHints = {
  currentVolumeIndexed: true,
  missingLocalIndex: false,
  missingPriorVolumes: [],
  missingSeriesAssignment: false,
};

const popupContextBundle: PopupContextBundle = {
  localPastContext: 'context text',
  localFutureBuffer: '',
  sameBookChunks: [],
  priorVolumeChunks: [],
  dictionaryEntries: [],
  retrievalStatus: 'local-only',
  retrievalHints,
  dictionaryResults: [],
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
  availabilityHint: null,
  fieldProvenance: null,
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
  vi.mocked(useLookupPipeline).mockReturnValue(lookupResult);
});

describe('useContextDictionary', () => {
  test('maps dictionary input through useContextLookup', () => {
    const result = useContextDictionary(defaultProps);

    expect(useLookupPipeline).toHaveBeenCalledWith({
      mode: 'dictionary',
      bookKey: defaultProps.bookKey,
      bookHash: defaultProps.bookHash,
      selectedText: defaultProps.selectedText,
      currentPage: defaultProps.currentPage,
      settings: defaultProps.translationSettings,
      dictionarySettings: defaultProps.dictionarySettings,
      bookLanguage: undefined,
    });
    expect(result).toBe(lookupResult);
  });

  test('passes through optional bookLanguage', () => {
    useContextDictionary({
      ...defaultProps,
      bookLanguage: 'ja',
    });

    expect(useLookupPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'dictionary',
        bookLanguage: 'ja',
      }),
    );
  });
});
