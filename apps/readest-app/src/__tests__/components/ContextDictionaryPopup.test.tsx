import { beforeEach, describe, expect, test, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LookupAnnotationSlots } from '@/services/contextTranslation/types';
import { eventDispatcher } from '@/utils/event';
import ContextDictionaryPopup from '@/app/reader/components/annotator/ContextDictionaryPopup';
import type {
  ContextDictionarySettings,
  ContextTranslationSettings,
} from '@/services/contextTranslation/types';
import {
  DEFAULT_CONTEXT_DICTIONARY_SETTINGS,
  DEFAULT_CONTEXT_TRANSLATION_SETTINGS,
} from '@/services/contextTranslation/defaults';

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

const mockOpenAIFns = { openAIInNotebook: vi.fn(), closeAIInNotebook: vi.fn() };
vi.mock('@/app/reader/hooks/useOpenAIInNotebook', () => ({
  useOpenAIInNotebook: vi.fn(() => mockOpenAIFns),
}));

const mockUseContextDictionary = vi.fn();
vi.mock('@/hooks/useContextDictionary', () => ({
  useContextDictionary: (...args: unknown[]) => mockUseContextDictionary(...args),
}));

const translationSettings: ContextTranslationSettings = DEFAULT_CONTEXT_TRANSLATION_SETTINGS;
const dictionarySettings: ContextDictionarySettings = DEFAULT_CONTEXT_DICTIONARY_SETTINGS;

const defaultProps = {
  bookKey: 'book-1',
  bookHash: 'hash-1',
  selectedText: '知己',
  currentPage: 1,
  translationSettings,
  dictionarySettings,
  position: { point: { x: 0, y: 0 } },
  trianglePosition: { point: { x: 0, y: 0 } },
  popupWidth: 400,
  popupHeight: 260,
};

function mockResult(overrides: Partial<ReturnType<typeof mockUseContextDictionary>> = {}) {
  return {
    result: {
      simpleDefinition: 'a trusted companion',
      contextualMeaning: 'someone you can count on',
    },
    partialResult: null,
    loading: false,
    streaming: false,
    activeFieldId: null,
    error: null,
    validationDecision: 'accept' as const,
    retrievalStatus: 'local-only' as const,
    retrievalHints: {
      currentVolumeIndexed: false,
      missingLocalIndex: true,
      missingPriorVolumes: [],
      missingSeriesAssignment: false,
    },
    popupContext: {
      localPastContext: 'past context',
      localFutureBuffer: '',
      sameBookChunks: [],
      priorVolumeChunks: [],
      retrievalStatus: 'local-only' as const,
      retrievalHints: {
        currentVolumeIndexed: false,
        missingLocalIndex: true,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
    },
    examples: [],
    annotations: {},
    availabilityHint: 'ai-on' as const,
    saveToVocabulary: vi.fn(),
    ...overrides,
  };
}

describe('ContextDictionaryPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  test('renders TTS button, Ask About This, and save buttons in header', () => {
    mockUseContextDictionary.mockReturnValue(mockResult());

    render(<ContextDictionaryPopup {...defaultProps} />);

    expect(screen.getAllByRole('button', { name: 'Speak' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Ask About This' })).toBeTruthy();
  });

  test('TTS button dispatches tts-popup-speak event with selected text and bookKey', () => {
    mockUseContextDictionary.mockReturnValue(mockResult());

    render(<ContextDictionaryPopup {...defaultProps} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Speak' })[0]!);

    expect(eventDispatcher.dispatch).toHaveBeenCalledWith('tts-popup-speak', {
      bookKey: 'book-1',
      text: '知己',
      oneTime: true,
    });
  });

  test('Ask About This button calls openAIInNotebook with context summary', () => {
    mockUseContextDictionary.mockReturnValue(mockResult());

    render(<ContextDictionaryPopup {...defaultProps} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Ask About This' })[0]!);

    expect(mockOpenAIFns.openAIInNotebook).toHaveBeenCalledWith({
      bookHash: 'hash-1',
      newConversationTitle: 'Ask about 知己',
      firstMessageContent: expect.stringContaining('Selection:\n知己'),
    });
  });

  test('save button calls saveToVocabulary', () => {
    const saveFn = vi.fn();
    mockUseContextDictionary.mockReturnValue(mockResult({ saveToVocabulary: saveFn }));

    const { container } = render(<ContextDictionaryPopup {...defaultProps} />);

    const buttons = container.querySelectorAll('button');
    // Find the bookmark/save button by checking for the icon class or title
    const saveButton = Array.from(buttons).find(
      (btn) => btn.getAttribute('title') === 'Save to vocabulary',
    );

    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);
    expect(saveFn).toHaveBeenCalled();
  });

  test('renders pinyin in header for Chinese selected text', () => {
    mockUseContextDictionary.mockReturnValue(mockResult());

    const { container } = render(<ContextDictionaryPopup {...defaultProps} />);

    // pinyin for 知己 with symbol toneType is "zhī jǐ"
    expect(container.textContent).toMatch(/zhī jǐ/);
  });

  test('renders structured source examples with RubyText for Chinese text', () => {
    const examples = [
      {
        exampleId: '1',
        sourceText: '人生难得一知己。',
        targetText: 'A true friend is hard to find in life.',
      },
    ];
    const annotations: LookupAnnotationSlots = {
      source: {
        examples: {
          '1': { phonetic: 'shēng rén nán dé yī zhī jǐ' },
        },
      },
    };
    mockUseContextDictionary.mockReturnValue(
      mockResult({
        result: {
          simpleDefinition: 'a trusted companion',
          contextualMeaning: 'someone you can count on',
          sourceExamples: '1. 人生难得一知己。\nEnglish: A true friend is hard to find in life.',
        },
        examples,
        annotations,
      }),
    );

    render(<ContextDictionaryPopup {...defaultProps} />);

    expect(screen.getByText('A true friend is hard to find in life.')).toBeTruthy();
    const { container } = render(<ContextDictionaryPopup {...defaultProps} />);
    expect(container.querySelectorAll('ruby').length).toBeGreaterThan(0);
  });

  test('renders retrieval status badge', () => {
    mockUseContextDictionary.mockReturnValue(
      mockResult({ retrievalStatus: 'cross-volume' as const }),
    );

    render(<ContextDictionaryPopup {...defaultProps} />);

    expect(screen.getByText('Cross-volume context')).toBeTruthy();
  });

  test('renders partial result during streaming', () => {
    mockUseContextDictionary.mockReturnValue(
      mockResult({
        loading: true,
        streaming: true,
        partialResult: { simpleDefinition: 'a friend', contextualMeaning: '' },
        result: null,
      }),
    );

    render(<ContextDictionaryPopup {...defaultProps} />);

    expect(screen.getByText('a friend')).toBeTruthy();
  });

  test('follows dictionary links with back and forward history', () => {
    mockUseContextDictionary.mockImplementation(({ selectedText }: { selectedText: string }) =>
      selectedText === '伙伴'
        ? mockResult({
            result: {
              simpleDefinition: 'a partner in hardship',
              contextualMeaning: 'someone who stands beside you',
            },
            popupContext: {
              localPastContext: 'later context',
              localFutureBuffer: '',
              sameBookChunks: [],
              priorVolumeChunks: [],
              retrievalStatus: 'local-only' as const,
              retrievalHints: {
                currentVolumeIndexed: false,
                missingLocalIndex: true,
                missingPriorVolumes: [],
                missingSeriesAssignment: false,
              },
              dictionaryResults: [
                {
                  headword: '伙伴',
                  definition: 'Trusted ally.',
                  source: 'Wiktionary',
                },
              ],
            },
          })
        : mockResult({
            popupContext: {
              localPastContext: 'past context',
              localFutureBuffer: '',
              sameBookChunks: [],
              priorVolumeChunks: [],
              retrievalStatus: 'local-only' as const,
              retrievalHints: {
                currentVolumeIndexed: false,
                missingLocalIndex: true,
                missingPriorVolumes: [],
                missingSeriesAssignment: false,
              },
              dictionaryResults: [
                {
                  headword: '知己',
                  definition: 'See <a rel="mw:WikiLink" title="伙伴">伙伴</a>.',
                  source: 'Wiktionary',
                },
              ],
            },
          }),
    );

    render(<ContextDictionaryPopup {...defaultProps} />);

    fireEvent.click(screen.getByText('Dictionary'));
    fireEvent.click(screen.getByText('伙伴'));
    expect(screen.getByText('a partner in hardship')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('a trusted companion')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByText('a partner in hardship')).toBeTruthy();
  });
});
