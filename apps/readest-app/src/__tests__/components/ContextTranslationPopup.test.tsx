import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import ContextTranslationPopup from '@/app/reader/components/annotator/ContextTranslationPopup';
import type { ContextTranslationSettings } from '@/services/contextTranslation/types';

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
  selectedText: '身侧',
  currentPage: 5,
  settings,
  position: { point: { x: 0, y: 0 } },
  trianglePosition: { point: { x: 0, y: 0 } },
  popupWidth: 400,
  popupHeight: 260,
};

describe('ContextTranslationPopup', () => {
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
          '1. 程岩挥挥手，招呼侍卫带自己离开，卡特犹豫了下，还是跟上队伍，走在四王子身侧。\nPinyin: ignored\nEnglish: Carter walked beside the prince.\n\n2. 他始终守在身侧，不敢退后。\nPinyin: ignored\nEnglish: He remained by his side without stepping back.',
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
      saveToVocabulary: vi.fn(),
    });

    const { container } = render(<ContextTranslationPopup {...defaultProps} />);

    expect(screen.getByText('身侧')).toBeTruthy();
    expect(screen.getByText('shēn cè')).toBeTruthy();
    expect(screen.getByText('by his side')).toBeTruthy();
    expect(screen.getByText('Cross-volume context')).toBeTruthy();
    expect(screen.getByText('Ask About This')).toBeTruthy();
    expect(screen.queryByText('Translating...')).toBeNull();

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('English: Carter walked beside the prince.')).toBeTruthy();

    const rubyNodes = container.querySelectorAll('ruby');
    expect(rubyNodes.length).toBeGreaterThan(2);

    const highlightedNodes = container.querySelectorAll('.bg-yellow-300\\/20');
    expect(highlightedNodes.length).toBeGreaterThan(0);
  });

  test('uses a secondary highlight color for spacing-variant example matches and omits invalid examples', () => {
    mockUseContextTranslation.mockReturnValue({
      result: {
        translation: 'by his side',
        examples:
          '1. 他始终守在身 侧。\nPinyin: ignored\nEnglish: He stayed by his side.\n\n2. 众人纷纷后退。\nPinyin: ignored\nEnglish: The crowd backed away.',
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
      saveToVocabulary: vi.fn(),
    });

    const { container } = render(
      <ContextTranslationPopup {...defaultProps} selectedText='身侧' />,
    );

    expect(container.querySelectorAll('ol > li')).toHaveLength(1);
    expect(screen.queryByText('English: The crowd backed away.')).toBeNull();

    const variantHighlightedNodes = container.querySelectorAll('.bg-cyan-300\\/20');
    expect(variantHighlightedNodes.length).toBeGreaterThan(0);
  });
});
