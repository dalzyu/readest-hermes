import { describe, expect, test, vi } from 'vitest';

vi.mock('@/hooks/useLookupPipeline', () => ({
  useLookupPipeline: vi.fn(),
}));

import { useContextLookup } from '@/hooks/useContextLookup';
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
const lookupAnnotations: LookupAnnotationSlots = {};

const mockedPipelineResult = {
  result: { translation: 'close friend' },
  partialResult: null,
  loading: false,
  streaming: false,
  activeFieldId: null,
  error: null,
  aiUnavailable: false,
  expandedText: null,
  validationDecision: 'accept' as const,
  retrievalStatus: 'local-only' as RetrievalStatus,
  retrievalHints,
  popupContext: popupContextBundle,
  examples: lookupExamples,
  annotations: lookupAnnotations,
  debugInfo: null,
  availabilityHint: 'ai-on' as const,
  fieldProvenance: { translation: 'ai' as const },
  saveToVocabulary: vi.fn(async () => {}),
};

const defaultProps = {
  mode: 'translation' as const,
  bookKey: 'book-1',
  bookHash: 'hash-1',
  selectedText: '知己',
  currentPage: 1,
  settings: {
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
};

describe('useContextLookup', () => {
  test('delegates to useLookupPipeline with identical lookup input', () => {
    vi.mocked(useLookupPipeline).mockReturnValue(mockedPipelineResult);

    const result = useContextLookup(defaultProps);

    expect(useLookupPipeline).toHaveBeenCalledWith(defaultProps);
    expect(result).toBe(mockedPipelineResult);
  });

  test('forwards dictionary settings unchanged', () => {
    vi.mocked(useLookupPipeline).mockReturnValue(mockedPipelineResult);

    const dictionarySettings = {
      enabled: true,
      sourceExamples: true,
      source: 'ai',
    } as ContextDictionarySettings;

    useContextLookup({
      ...defaultProps,
      mode: 'dictionary',
      dictionarySettings,
    });

    expect(useLookupPipeline).toHaveBeenCalledWith({
      ...defaultProps,
      mode: 'dictionary',
      dictionarySettings,
    });
  });
});
