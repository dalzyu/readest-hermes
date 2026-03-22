import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import ContextTranslationPopup from '@/app/reader/components/annotator/ContextTranslationPopup';
import type { ContextTranslationSettings } from '@/services/contextTranslation/types';

const mockDispatch = vi.fn();
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/app/reader/hooks/useOpenAIInNotebook', () => ({
  __esModule: true,
  default: () => ({
    openAIInNotebook: vi.fn(),
    closeAIInNotebook: vi.fn(),
  }),
}));

const mockUseContextTranslation = vi.fn();

vi.mock('@/hooks/useContextTranslation', () => ({
  useContextTranslation: (...args: unknown[]) => mockUseContextTranslation(...args),
}));

const settings: ContextTranslationSettings = {
  enabled: true,
  targetLanguage: 'en',
  recentContextPages: 3,
  lookAheadWords: 80,
  sameBookRagEnabled: true,
  priorVolumeRagEnabled: true,
  sameBookChunkCount: 3,
  priorVolumeChunkCount: 2,
  outputFields: [
    {
      id: 'translation',
      label: 'Translation',
      enabled: true,
      order: 0,
      promptInstruction: 'Provide a direct translation.',
    },
    {
      id: 'contextualMeaning',
      label: 'Contextual Meaning',
      enabled: true,
      order: 1,
      promptInstruction: 'Explain contextual meaning.',
    },
    {
      id: 'examples',
      label: 'Usage Examples',
      enabled: true,
      order: 2,
      promptInstruction: 'Give usage examples.',
    },
  ],
};

const defaultProps = {
  bookKey: 'book-key-1',
  bookHash: 'hash-abc',
  selectedText: '\u8eab\u4fa7',
  currentPage: 5,
  settings,
  position: { point: { x: 0, y: 0 } },
  trianglePosition: { point: { x: 0, y: 0 } },
  popupWidth: 400,
  popupHeight: 260,
};

describe('ContextTranslationPopup', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders header pinyin, retrieval status, and ruby usage examples with highlighted selected text', () => {
    mockUseContextTranslation.mockReturnValue({
      result: null,
      partialResult: {
        translation: 'by his side',
        contextualMeaning: 'trusted companion',
        examples:
          '1. \u7a0b\u535a\u6325\u624b\uff0c\u62db\u547c\u4f8d\u536b\u5e26\u81ea\u5df1\u79bb\u5f00\uff0c\u5361\u7279\u72b9\u8c6b\u4e86\u4e00\u4e0b\uff0c\u8fd8\u662f\u8ddf\u4e0a\u961f\u4f0d\uff0c\u8d70\u5728\u56db\u738b\u5b50\u8eab\u4fa7\u3002\nPinyin: ignored\nEnglish: Carter walked beside the prince.\n\n2. \u4ed6\u59cb\u7ec8\u5b88\u5728\u8eab\u4fa7\uff0c\u4e0d\u6562\u9000\u540e\u3002\nPinyin: ignored\nEnglish: He remained by his side without stepping back.',
      },
      loading: true,
      streaming: true,
      activeFieldId: 'examples',
      error: null,
      retrievalStatus: 'cross-volume',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: {
        localPastContext: 'past',
        localFutureBuffer: 'future',
        sameBookChunks: [],
        priorVolumeChunks: [],
        retrievalStatus: 'cross-volume',
        retrievalHints: {
          currentVolumeIndexed: true,
          missingLocalIndex: false,
          missingPriorVolumes: [],
          missingSeriesAssignment: false,
        },
      },
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    const { container } = render(<ContextTranslationPopup {...defaultProps} />);

    expect(screen.getByText('\u8eab\u4fa7')).toBeTruthy();
    expect(screen.getByText('sh\u0113n c\u00e8')).toBeTruthy();
    expect(screen.getByText('by his side')).toBeTruthy();
    expect(screen.getByText('Cross-volume context')).toBeTruthy();
    expect(screen.getByText('Ask About This')).toBeTruthy();
    expect(screen.queryByText('Translating...')).toBeNull();

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Carter walked beside the prince.')).toBeTruthy();
    expect(container.querySelectorAll('ruby').length).toBeGreaterThan(2);
    expect(container.querySelectorAll('.bg-yellow-300\\/20').length).toBeGreaterThan(0);
  });

  test('renders a speak button that dispatches tts-speak with text and bookKey', () => {
    mockUseContextTranslation.mockReturnValue({
      result: { translation: 'by his side' },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: false,
        missingLocalIndex: true,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    render(<ContextTranslationPopup {...defaultProps} />);

    const speakBtns = screen.getAllByRole('button', { name: 'Speak' });
    fireEvent.click(speakBtns[0]!);

    expect(mockDispatch).toHaveBeenCalledWith('tts-speak', {
      bookKey: 'book-key-1',
      text: '\u8eab\u4fa7',
      oneTime: true,
    });
  });

  test('uses a secondary highlight color for spacing-variant example matches and omits invalid examples', () => {
    mockUseContextTranslation.mockReturnValue({
      result: {
        translation: 'by his side',
        examples:
          '1. \u4ed6\u59cb\u7ec8\u5b88\u5728\u8eab \u4fa7\u3002\nPinyin: ignored\nEnglish: He stayed by his side.\n\n2. \u4f17\u4eba\u7eb7\u7eb7\u540e\u9000\u3002\nPinyin: ignored\nEnglish: The crowd backed away.',
      },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-volume',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [1],
        missingSeriesAssignment: false,
      },
      popupContext: {
        localPastContext: 'past',
        localFutureBuffer: '',
        sameBookChunks: ['same-book'],
        priorVolumeChunks: [],
        retrievalStatus: 'local-volume',
        retrievalHints: {
          currentVolumeIndexed: true,
          missingLocalIndex: false,
          missingPriorVolumes: [1],
          missingSeriesAssignment: false,
        },
      },
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    const { container } = render(
      <ContextTranslationPopup {...defaultProps} selectedText='\u8eab\u4fa7' />,
    );

    expect(screen.queryByText('English: The crowd backed away.')).toBeNull();
    expect(container.textContent).toContain('English: He stayed by his side.');
  });

  test('renders usage examples from structured sourceText and targetText fields', () => {
    mockUseContextTranslation.mockReturnValue({
      result: {
        translation: 'kindred spirit',
        examples: '1. 知己难逢\nPinyin: zhī jǐ nán féng\nEnglish: True friends are hard to find.',
      },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    render(
      <ContextTranslationPopup
        {...defaultProps}
        selectedText='知己'
        settings={{ ...settings, targetLanguage: 'en', outputFields: settings.outputFields }}
      />,
    );

    expect(screen.getByText('True friends are hard to find.')).toBeTruthy();
    expect(screen.getByText('kindred spirit')).toBeTruthy();
  });

  test('renders english-to-chinese examples without requiring language-label parsing in popup', () => {
    mockUseContextTranslation.mockReturnValue({
      result: {
        translation: '格林尼斯公司',
        examples: '1. Mr. Dursley worked at Grunnings.\nChinese: 杜斯礼先生在格林尼斯公司工作。',
      },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    const { container } = render(
      <ContextTranslationPopup
        {...defaultProps}
        selectedText='Grunnings'
        settings={{ ...settings, targetLanguage: 'zh', outputFields: settings.outputFields }}
      />,
    );

    // The example sentence text should be visible
    expect(container.textContent).toContain('Mr. Dursley worked at Grunnings.');
    // The Chinese translation should appear (from Chinese: label in formatted text)
    expect(container.textContent).toContain('格林尼斯公司');
  });

  test('translation field has TTS button', () => {
    mockUseContextTranslation.mockReturnValue({
      result: { translation: 'by his side', contextualMeaning: 'trusted companion' },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    render(<ContextTranslationPopup {...defaultProps} />);
    expect(screen.getByTestId('tts-translation')).toBeTruthy();
  });

  test('contextual meaning field has TTS button', () => {
    mockUseContextTranslation.mockReturnValue({
      result: { translation: 'by his side', contextualMeaning: 'trusted companion' },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    render(<ContextTranslationPopup {...defaultProps} />);
    expect(screen.getByTestId('tts-contextual-meaning')).toBeTruthy();
  });

  test('TTS button on translation field dispatches tts-speak with translation text', () => {
    mockUseContextTranslation.mockReturnValue({
      result: { translation: 'by his side', contextualMeaning: 'trusted companion' },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    render(<ContextTranslationPopup {...defaultProps} />);
    fireEvent.click(screen.getByTestId('tts-translation'));

    expect(mockDispatch).toHaveBeenCalledWith('tts-speak', {
      bookKey: 'book-key-1',
      text: 'by his side',
      oneTime: true,
    });
  });

  test('TTS button on contextual meaning field dispatches tts-speak with contextual meaning text', () => {
    mockUseContextTranslation.mockReturnValue({
      result: { translation: 'by his side', contextualMeaning: 'trusted companion' },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    render(<ContextTranslationPopup {...defaultProps} />);
    fireEvent.click(screen.getByTestId('tts-contextual-meaning'));

    expect(mockDispatch).toHaveBeenCalledWith('tts-speak', {
      bookKey: 'book-key-1',
      text: 'trusted companion',
      oneTime: true,
    });
  });

  test('popup wrapper has maxWidth 600px constraint', () => {
    mockUseContextTranslation.mockReturnValue({
      result: { translation: 'by his side' },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-only',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: null,
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    render(<ContextTranslationPopup {...defaultProps} popupWidth={800} />);
    const popup = screen.getByTestId('context-translation-popup');
    expect(popup.style.maxWidth).toBe('600px');
  });

  test('renders english-to-chinese examples with grouped english highlights and chinese ruby translation', () => {
    mockUseContextTranslation.mockReturnValue({
      result: {
        translation: '\u683c\u6797\u5c3c\u65af\u516c\u53f8',
        examples:
          '1. Mr. Dursley worked at Grunnings, a company that manufactured drills.\nChinese: \u675c\u65af\u793c\u5148\u751f\u5728\u4e00\u5bb6\u751f\u4ea7\u94bb\u673a\u7684\u683c\u6797\u5c3c\u65af\u516c\u53f8\u5de5\u4f5c\u3002',
      },
      partialResult: null,
      loading: false,
      streaming: false,
      activeFieldId: null,
      error: null,
      retrievalStatus: 'local-volume',
      retrievalHints: {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      },
      popupContext: {
        localPastContext: 'past',
        localFutureBuffer: '',
        sameBookChunks: [],
        priorVolumeChunks: [],
        retrievalStatus: 'local-volume',
        retrievalHints: {
          currentVolumeIndexed: true,
          missingLocalIndex: false,
          missingPriorVolumes: [],
          missingSeriesAssignment: false,
        },
      },
      examples: [],
      annotations: {},
      saveToVocabulary: vi.fn(),
    });

    const { container } = render(
      <ContextTranslationPopup {...defaultProps} selectedText='Grunnings' />,
    );

    expect(container.textContent).toContain(
      'Mr. Dursley worked at Grunnings, a company that manufactured drills.',
    );
    expect(
      Array.from(container.querySelectorAll('.bg-yellow-300\\/20')).some(
        (node) => node.textContent === 'Grunnings',
      ),
    ).toBe(true);
    expect(container.querySelectorAll('ruby').length).toBeGreaterThan(0);
  });
});
