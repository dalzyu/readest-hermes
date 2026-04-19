import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/hooks/useContextLookup', () => ({
  useContextLookup: vi.fn(),
}));

import { useContextTranslation } from '@/hooks/useContextTranslation';
import { useContextLookup } from '@/hooks/useContextLookup';
import type {
  ContextTranslationSettings,
  LookupAnnotationSlots,
  LookupExample,
  PopupContextBundle,
  PopupRetrievalHints,
  RetrievalStatus,
} from '@/services/contextTranslation/types';
import type { UseContextLookupResult } from '@/hooks/useContextLookup';

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
  result: { translation: 'close friend' },
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
  availabilityHint: 'ai-on',
  fieldProvenance: { translation: 'ai' },
  saveToVocabulary: vi.fn(async () => {}),
};

const defaultSettings: ContextTranslationSettings = {
  enabled: true,
  targetLanguage: 'en',
  recentContextPages: 3,
  lookAheadWords: 80,
  sameBookRagEnabled: true,
  priorVolumeRagEnabled: true,
  sameBookChunkCount: 3,
  priorVolumeChunkCount: 2,
  outputFields: [],
  source: 'ai',
};

const defaultProps = {
  bookKey: 'book-key-1',
  bookHash: 'hash-abc',
  selectedText: '知己',
  currentPage: 5,
  settings: defaultSettings,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useContextLookup).mockReturnValue(lookupResult);
});

describe('useContextTranslation', () => {
  test('maps translation input through useContextLookup', () => {
    const result = useContextTranslation(defaultProps);

    expect(useContextLookup).toHaveBeenCalledWith({
      mode: 'translation',
      bookKey: defaultProps.bookKey,
      bookHash: defaultProps.bookHash,
      selectedText: defaultProps.selectedText,
      currentPage: defaultProps.currentPage,
      settings: defaultProps.settings,
      bookLanguage: undefined,
    });

    expect(result.result).toEqual({ translation: 'close friend' });
    expect(result.popupContext).toBe(popupContextBundle);
    expect(result.availabilityHint).toBe('ai-on');
    expect(result.fieldProvenance).toEqual({ translation: 'ai' });
  });

  test('passes through saveToVocabulary and retrieval metadata', async () => {
    const result = useContextTranslation({
      ...defaultProps,
      bookLanguage: 'ja',
    });

    expect(result.retrievalStatus).toBe('local-only');
    expect(result.retrievalHints).toEqual(retrievalHints);

    await result.saveToVocabulary();
    expect(lookupResult.saveToVocabulary).toHaveBeenCalledTimes(1);
  });
});
