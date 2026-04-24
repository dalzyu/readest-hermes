import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import LookupHistoryView from '@/app/reader/components/sidebar/LookupHistoryView';
import VocabularyPanel from '@/app/reader/components/notebook/VocabularyPanel';
import { eventDispatcher } from '@/utils/event';
import type { VocabularyEntry } from '@/services/contextTranslation/types';
import type { LookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';

const mockGetBookData = vi.fn();
const mockGetView = vi.fn();
const mockGetLookupHistoryForBook = vi.fn();
const mockGetVocabularyForBook = vi.fn();
const mockGetDueVocabularyForBook = vi.fn();
const mockSearchVocabulary = vi.fn();
const mockDeleteVocabularyEntry = vi.fn();
const mockExportAsAnkiTSV = vi.fn();
const mockExportAsCSV = vi.fn();
const mockMarkVocabularyEntryReviewed = vi.fn();

const historyEntries: LookupHistoryEntry[] = [
  {
    id: 'hist-new',
    recordedAt: 2_000,
    bookHash: 'book-hash',
    term: 'lookup-beta',
    context: 'context beta',
    result: { translation: 'beta translation', simpleDefinition: 'beta summary' },
    mode: 'dictionary',
    location: 'epubcfi(/6/4:10)',
  },
  {
    id: 'hist-old',
    recordedAt: 1_000,
    bookHash: 'book-hash',
    term: 'lookup-alpha',
    context: 'context alpha',
    result: { translation: 'alpha translation', contextualMeaning: 'alpha meaning' },
    mode: 'translation',
  },
];

const vocabEntries: VocabularyEntry[] = [
  {
    id: 'alpha-id',
    bookHash: 'book-hash',
    term: 'alpha',
    context: 'alpha context',
    result: { translation: 'alpha answer', contextualMeaning: 'alpha meaning' },
    addedAt: 1000,
    reviewCount: 0,
  },
];

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (value: string) => value,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasRoundedWindow: false, isAndroidApp: false } }),
}));

vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      aiSettings: { enabled: false },
      globalReadSettings: {
        contextTranslation: {
          enabled: true,
          outputFields: [
            { id: 'translation', label: 'Translation', enabled: true, order: 0 },
            { id: 'contextualMeaning', label: 'Contextual Meaning', enabled: true, order: 1 },
            { id: 'simpleDefinition', label: 'Definition', enabled: true, order: 2 },
          ],
        },
      },
    },
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: mockGetBookData }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: mockGetView }),
}));

vi.mock('@/services/contextTranslation/lookupHistoryService', () => ({
  getLookupHistoryForBook: (...args: unknown[]) => mockGetLookupHistoryForBook(...args),
}));

vi.mock('@/services/contextTranslation/vocabularyService', () => ({
  getVocabularyForBook: (...args: unknown[]) => mockGetVocabularyForBook(...args),
  getDueVocabularyForBook: (...args: unknown[]) => mockGetDueVocabularyForBook(...args),
  deleteVocabularyEntry: (...args: unknown[]) => mockDeleteVocabularyEntry(...args),
  searchVocabulary: (...args: unknown[]) => mockSearchVocabulary(...args),
  exportAsAnkiTSV: (...args: unknown[]) => mockExportAsAnkiTSV(...args),
  exportAsCSV: (...args: unknown[]) => mockExportAsCSV(...args),
  markVocabularyEntryReviewed: (...args: unknown[]) => mockMarkVocabularyEntryReviewed(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();

  mockGetBookData.mockReturnValue({ book: { hash: 'book-hash', primaryLanguage: 'en' } });
  mockGetView.mockReturnValue({ goTo: vi.fn() });
  mockGetLookupHistoryForBook.mockReturnValue(historyEntries);
  mockGetVocabularyForBook.mockResolvedValue(vocabEntries);
  mockGetDueVocabularyForBook.mockResolvedValue(vocabEntries);
  mockSearchVocabulary.mockResolvedValue([]);
  mockDeleteVocabularyEntry.mockResolvedValue(undefined);
  mockExportAsAnkiTSV.mockReturnValue('anki');
  mockExportAsCSV.mockReturnValue('csv');
  mockMarkVocabularyEntryReviewed.mockImplementation(async (entry: VocabularyEntry) => ({
    ...entry,
    reviewCount: entry.reviewCount + 1,
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LookupHistoryView history rows', () => {
  test('plain click replays the saved lookup while modifier-click jumps to the stored location', async () => {
    const goTo = vi.fn();
    mockGetView.mockReturnValue({ goTo });
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue(undefined);

    render(<LookupHistoryView bookKey='book-key' />);

    const betaRow = await screen.findByRole('button', { name: /lookup-beta/i });
    expect(screen.getByText('context beta · beta summary')).toBeTruthy();
    expect(screen.getByText('context alpha · alpha meaning')).toBeTruthy();

    fireEvent.click(betaRow);

    const replayPopup = screen.getByTestId('lookup-history-replay-popup');
    expect(replayPopup).toBeTruthy();
    expect(within(replayPopup).getByText('beta translation')).toBeTruthy();
    expect(within(replayPopup).getByText('beta summary')).toBeTruthy();
    expect(goTo).not.toHaveBeenCalled();

    fireEvent.click(betaRow, { ctrlKey: true });

    expect(goTo).toHaveBeenCalledWith('epubcfi(/6/4:10)');
    expect(dispatchSpy).toHaveBeenCalledWith('navigate', {
      bookKey: 'book-key',
      cfi: 'epubcfi(/6/4:10)',
    });
  });
});

describe('VocabularyPanel history rows', () => {
  test('plain click replays the saved lookup and modifier-click without a location does nothing', async () => {
    const goTo = vi.fn();
    mockGetView.mockReturnValue({ goTo });

    render(<VocabularyPanel bookKey='book-key' bookHash='book-hash' />);

    const historySection = await screen.findByText('Recent lookups');
    expect(historySection).toBeTruthy();

    const alphaRow = screen.getByRole('button', { name: /lookup-alpha/i });
    fireEvent.click(alphaRow);

    const replayPopup = screen.getByTestId('lookup-history-replay-popup');
    expect(replayPopup).toBeTruthy();
    expect(within(replayPopup).getByText('alpha translation')).toBeTruthy();
    expect(within(replayPopup).getByText('alpha meaning')).toBeTruthy();

    fireEvent.click(alphaRow, { shiftKey: true });
    expect(goTo).not.toHaveBeenCalled();
  });
});
