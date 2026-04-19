import clsx from 'clsx';
import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { PiPlus } from 'react-icons/pi';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { Book, BooksGroup, ReadingStatus } from '@/types/book';
import {
  LibraryCoverFitType,
  LibraryGroupByType,
  LibrarySurfaceModeType,
  LibrarySortByType,
  LibraryViewModeType,
} from '@/types/settings';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useAutoFocus } from '@/hooks/useAutoFocus';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { navigateToLibrary, navigateToReader, showReaderWindow } from '@/utils/nav';
import {
  createBookFilter,
  createBookGroups,
  createBookSorter,
  createGroupSorter,
  createWithinGroupSorter,
  ensureLibraryGroupByType,
  ensureLibrarySortByType,
  getBookSortValue,
  getGroupSortValue,
  compareSortValues,
} from '../utils/libraryUtils';
import { eventDispatcher } from '@/utils/event';

import { useSpatialNavigation } from '../hooks/useSpatialNavigation';
import Alert from '@/components/Alert';
import Spinner from '@/components/Spinner';
import ModalPortal from '@/components/ModalPortal';
import BookshelfItem, { generateBookshelfItems } from './BookshelfItem';
import SelectModeActions from './SelectModeActions';
import GroupingModal from './GroupingModal';
import SeriesModal from './SeriesModal';
import SeriesShelf from './SeriesShelf';
import SetStatusAlert from './SetStatusAlert';
import LibraryStatsCard from './LibraryStatsCard';

interface BookshelfProps {
  libraryBooks: Book[];
  isSelectMode: boolean;
  isSelectAll: boolean;
  isSelectNone: boolean;
  handleImportBooks: () => void;
  handleBookDownload: (
    book: Book,
    options?: { redownload?: boolean; queued?: boolean },
  ) => Promise<boolean>;
  handleBookUpload: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleBookDelete: (book: Book, syncBooks?: boolean) => Promise<boolean>;
  handleSetSelectMode: (selectMode: boolean) => void;
  handleShowDetailsBook: (book: Book) => void;
  handleLibraryNavigation: (targetGroup: string) => void;
  handlePushLibrary: () => Promise<void>;
  booksTransferProgress: { [key: string]: number | null };
}

const Bookshelf: React.FC<BookshelfProps> = ({
  libraryBooks,
  isSelectMode,
  isSelectAll,
  isSelectNone,
  handleImportBooks,
  handleBookUpload,
  handleBookDownload,
  handleBookDelete,
  handleSetSelectMode,
  handleShowDetailsBook,
  handleLibraryNavigation,
  handlePushLibrary,
  booksTransferProgress,
}) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { safeAreaInsets } = useThemeStore();

  const groupId = searchParams?.get('group') || '';
  const surfaceMode = (
    searchParams?.get('surface') === 'series' ? 'series' : 'books'
  ) as LibrarySurfaceModeType;
  const queryTerm = searchParams?.get('q') || null;
  const viewMode = searchParams?.get('view') || settings.libraryViewMode;
  const sortBy = ensureLibrarySortByType(searchParams?.get('sort'), settings.librarySortBy);
  const sortOrder = searchParams?.get('order') || (settings.librarySortAscending ? 'asc' : 'desc');
  const groupBy = ensureLibraryGroupByType(searchParams?.get('groupBy'), settings.libraryGroupBy);
  const coverFit = searchParams?.get('cover') || settings.libraryCoverFit;
  const showLibraryStatsCard = surfaceMode === 'books' && !groupId && !queryTerm;

  const [loading, setLoading] = useState(false);
  const [showSelectModeActions, setShowSelectModeActions] = useState(false);
  const [bookIdsToDelete, setBookIdsToDelete] = useState<string[]>([]);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showStatusAlert, setShowStatusAlert] = useState(false);
  const [showGroupingModal, setShowGroupingModal] = useState(false);
  const [importBookUrl] = useState(searchParams?.get('url') || '');

  const abortDeletionRef = useRef(false);
  const isImportingBook = useRef(false);
  const iconSize15 = useResponsiveSize(15);
  const autofocusRef = useAutoFocus<HTMLDivElement>();
  useSpatialNavigation(autofocusRef);

  const { setCurrentBookshelf, setLibrary, updateBooks } = useLibraryStore();
  const { setSelectedBooks, getSelectedBooks, toggleSelectedBook } = useLibraryStore();
  const { getGroupName } = useLibraryStore();

  const uiLanguage = localStorage?.getItem('i18nextLng') || '';

  const updateUrlParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams?.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      if (params.get('sort') === LibrarySortByType.Updated) params.delete('sort');
      if (params.get('order') === 'desc') params.delete('order');
      if (params.get('groupBy') === LibraryGroupByType.Group) params.delete('groupBy');
      if (params.get('cover') === 'crop') params.delete('cover');
      if (params.get('view') === 'grid') params.delete('view');

      const newParamString = params.toString();
      const currentParamString = searchParams?.toString() || '';

      if (newParamString !== currentParamString) {
        navigateToLibrary(router, newParamString);
      }
    },
    [router, searchParams],
  );

  const handleSetSurfaceMode = useCallback(
    (mode: LibrarySurfaceModeType) => {
      const currentGroupBy = searchParams?.get('groupBy');
      const nextGroupBy =
        mode === 'series'
          ? null
          : currentGroupBy === LibraryGroupByType.Series
            ? null
            : currentGroupBy || null;

      startTransition(() => {
        updateUrlParams({
          surface: mode,
          group: null,
          groupBy: nextGroupBy,
        });
      });
    },
    [searchParams, updateUrlParams],
  );

  const filteredBooks = useMemo(() => {
    const bookFilter = createBookFilter(queryTerm);
    return queryTerm ? libraryBooks.filter((book) => bookFilter(book)) : libraryBooks;
  }, [libraryBooks, queryTerm]);

  const currentBookshelfItems = useMemo(() => {
    if (groupBy === LibraryGroupByType.Group) {
      // Use existing generateBookshelfItems for group mode
      const groupName = getGroupName(groupId) || '';
      if (groupId && !groupName) {
        return [];
      }
      return generateBookshelfItems(filteredBooks, groupName);
    } else {
      // Use new createBookGroups for series/author/none modes
      const allItems = createBookGroups(filteredBooks, groupBy);

      // If navigating into a specific group, show only that group's books
      if (groupId) {
        const targetGroup = allItems.find(
          (item): item is BooksGroup => 'books' in item && item.id === groupId,
        );
        if (targetGroup) {
          // Return the books from the target group as individual items
          return targetGroup.books;
        }
        // Group not found, return empty
        return [];
      }

      return allItems;
    }
  }, [filteredBooks, groupBy, groupId, getGroupName]);

  useEffect(() => {
    if (!groupId) return;
    if (currentBookshelfItems.length > 0) return;
    updateUrlParams({ group: null });
  }, [groupId, currentBookshelfItems.length, updateUrlParams]);

  const sortedBookshelfItems = useMemo(() => {
    const sortOrderMultiplier = sortOrder === 'asc' ? 1 : -1;

    // Separate into ungrouped books and groups
    const ungroupedBooks = currentBookshelfItems.filter((item): item is Book => 'format' in item);
    const groups = currentBookshelfItems.filter((item): item is BooksGroup => 'books' in item);

    // Sort books within each group
    // For series groups, series index is always ascending; sort direction applies to fallback only
    const sortAscending = sortOrder === 'asc';
    const withinGroupSorter = createWithinGroupSorter(groupBy, sortBy, uiLanguage, sortAscending);
    groups.forEach((group) => {
      group.books.sort(withinGroupSorter);
    });

    // Sort ungrouped books - use within-group sorter if we're inside a group
    // (for series, this ensures books are sorted by series index)
    const bookSorter = createBookSorter(sortBy, uiLanguage);
    if (groupId && groupBy !== LibraryGroupByType.Group && groupBy !== LibraryGroupByType.None) {
      ungroupedBooks.sort(withinGroupSorter);
      // When inside a group, books are already sorted correctly — return directly
      // to avoid the merge sort below overriding the within-group sort order
      return ungroupedBooks;
    } else {
      ungroupedBooks.sort((a, b) => bookSorter(a, b) * sortOrderMultiplier);
    }

    // Merge groups and ungrouped books, then sort them together
    const allItems: (Book | BooksGroup)[] = [...groups, ...ungroupedBooks];
    const groupSorter = createGroupSorter(sortBy, uiLanguage, groupBy);

    allItems.sort((a, b) => {
      const isAGroup = 'books' in a;
      const isBGroup = 'books' in b;

      // If both are groups, use group sorter
      if (isAGroup && isBGroup) {
        return groupSorter(a, b) * sortOrderMultiplier;
      }

      // If both are books, use book sorter
      if (!isAGroup && !isBGroup) {
        return bookSorter(a, b) * sortOrderMultiplier;
      }

      // For series/author groups: compare sort values to interleave properly
      if (isAGroup && !isBGroup) {
        const groupValue = getGroupSortValue(a, sortBy, groupBy);
        const bookValue = getBookSortValue(b, sortBy);
        return compareSortValues(groupValue, bookValue, uiLanguage) * sortOrderMultiplier;
      } else if (!isAGroup && isBGroup) {
        const bookValue = getBookSortValue(a, sortBy);
        const groupValue = getGroupSortValue(b, sortBy, groupBy);
        return compareSortValues(bookValue, groupValue, uiLanguage) * sortOrderMultiplier;
      }
      return 0;
    });

    return allItems;
  }, [sortOrder, sortBy, groupBy, groupId, uiLanguage, currentBookshelfItems]);

  useEffect(() => {
    if (isImportingBook.current) return;
    isImportingBook.current = true;

    if (importBookUrl && appService) {
      const importBook = async () => {
        console.log('Importing book from URL:', importBookUrl);
        const book = await appService.importBook(importBookUrl, libraryBooks);
        if (book) {
          setLibrary(libraryBooks);
          appService.saveLibraryBooks(libraryBooks);
          navigateToReader(router, [book.hash]);
        }
      };
      importBook();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importBookUrl, appService]);

  const currentBookshelfSignature = useMemo(
    () =>
      currentBookshelfItems
        .map((item) => ('hash' in item ? `book:${item.hash}` : `group:${item.id}`))
        .join('|'),
    [currentBookshelfItems],
  );
  const lastBookshelfSignatureRef = useRef<string>('');

  useEffect(() => {
    if (lastBookshelfSignatureRef.current === currentBookshelfSignature) return;
    lastBookshelfSignatureRef.current = currentBookshelfSignature;
    setCurrentBookshelf(currentBookshelfItems);
  }, [currentBookshelfItems, currentBookshelfSignature, setCurrentBookshelf]);
  const toggleSelection = useCallback(
    (id: string) => {
      toggleSelectedBook(id);
    },
    [toggleSelectedBook],
  );

  const openSelectedBooks = () => {
    handleSetSelectMode(false);
    if (appService?.hasWindow && settings.openBookInNewWindow) {
      showReaderWindow(appService, getSelectedBooks());
    } else {
      setTimeout(() => setLoading(true), 200);
      navigateToReader(router, getSelectedBooks());
    }
  };

  const openBookDetails = () => {
    handleSetSelectMode(false);
    const selectedBooks = getSelectedBooks();
    const book = libraryBooks.find((book) => book.hash === selectedBooks[0]);
    if (book) {
      handleShowDetailsBook(book);
    }
  };

  const getBooksToDelete = () => {
    const booksToDelete: Book[] = [];
    bookIdsToDelete.forEach((id) => {
      for (const book of filteredBooks.filter((book) => book.hash === id || book.groupId === id)) {
        if (book && !book.deletedAt) {
          booksToDelete.push(book);
        }
      }
    });
    return booksToDelete;
  };

  const confirmDelete = async () => {
    const books = getBooksToDelete();
    const concurrency = 20;

    for (let i = 0; i < books.length; i += concurrency) {
      if (abortDeletionRef.current) {
        abortDeletionRef.current = false;
        break;
      }
      const batch = books.slice(i, i + concurrency);
      await Promise.all(batch.map((book) => handleBookDelete(book, false)));
    }
    handlePushLibrary();
    setSelectedBooks([]);
    setShowDeleteAlert(false);
    setShowSelectModeActions(true);
  };

  const deleteSelectedBooks = () => {
    setBookIdsToDelete(getSelectedBooks());
    setShowSelectModeActions(false);
    setShowDeleteAlert(true);
  };

  const groupSelectedBooks = () => {
    setShowSelectModeActions(false);
    setShowGroupingModal(true);
  };

  const showStatusSelection = () => {
    setShowSelectModeActions(false);
    setShowStatusAlert(true);
  };

  const updateBooksStatus = async (status: ReadingStatus | undefined) => {
    const selectedIds = getSelectedBooks();
    const booksToUpdate: Book[] = [];

    for (const id of selectedIds) {
      const book = filteredBooks.find((b) => b.hash === id);
      if (book) {
        booksToUpdate.push({ ...book, readingStatus: status, updatedAt: Date.now() });
      }
    }

    if (booksToUpdate.length > 0) {
      await updateBooks(envConfig, booksToUpdate);
    }

    setSelectedBooks([]);
    setShowStatusAlert(false);
    setShowSelectModeActions(true);
  };

  const handleUpdateReadingStatus = useCallback(
    async (book: Book, status: ReadingStatus | undefined) => {
      const updatedBook = { ...book, readingStatus: status, updatedAt: Date.now() };
      await updateBooks(envConfig, [updatedBook]);
    },
    [envConfig, updateBooks],
  );

  const handleDeleteBooksIntent = (event: CustomEvent) => {
    const { ids } = event.detail;
    setBookIdsToDelete(ids);
    setShowSelectModeActions(false);
    setShowDeleteAlert(true);
  };

  useEffect(() => {
    if (isSelectMode) {
      setShowSelectModeActions(true);
      if (isSelectAll) {
        setSelectedBooks(
          currentBookshelfItems.map((item) => ('hash' in item ? item.hash : item.id)),
        );
      } else if (isSelectNone) {
        setSelectedBooks([]);
      }
    } else {
      setSelectedBooks([]);
      setShowSelectModeActions(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelectMode, isSelectAll, isSelectNone, currentBookshelfItems]);

  useEffect(() => {
    eventDispatcher.on('delete-books', handleDeleteBooksIntent);
    return () => {
      eventDispatcher.off('delete-books', handleDeleteBooksIntent);
    };
  }, []);

  const selectedBooks = getSelectedBooks();
  const shouldVirtualize = sortedBookshelfItems.length > 120;
  const shouldVirtualizeGrid =
    viewMode === 'grid' && shouldVirtualize && settings.libraryAutoColumns;
  const shouldVirtualizeList = viewMode === 'list' && shouldVirtualize;
  const showImportTile = viewMode === 'grid' && currentBookshelfItems.length > 0;
  const usesVirtualizedSurface = shouldVirtualizeGrid || shouldVirtualizeList;
  const gridListClassName = clsx(
    'grid auto-rows-max content-start grid-cols-3 gap-x-4 px-4 sm:gap-x-0 sm:px-2',
    'sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-12',
  );

  const renderImportTile = () => (
    <div className='book-item bookshelf-import-item px-0 py-2 sm:px-4 sm:py-4'>
      <div className='visible-focus-inset-2 sm:hover:bg-base-300/50 group flex h-full flex-col sm:rounded-md'>
        <div className='flex h-full flex-col justify-end'>
          <button
            aria-label={_('Import Books')}
            className={clsx(
              'bookitem-main bg-base-100 hover:bg-base-300/50',
              'flex items-center justify-center',
              'aspect-[28/41] w-full',
            )}
            onClick={handleImportBooks}
          >
            <div className='flex items-center justify-center'>
              <PiPlus className='size-10' color='gray' />
            </div>
          </button>
          <div className='flex w-full flex-col p-0 pt-2'>
            <div className='min-w-0 flex-1'>
              <h4 className='invisible overflow-hidden text-ellipsis whitespace-nowrap text-[0.6em] text-xs font-semibold'>
                {_('Import Books')}
              </h4>
            </div>
            <div
              data-import-footer
              aria-hidden='true'
              className='flex items-center justify-end'
              style={{ height: `${iconSize15}px`, minHeight: `${iconSize15}px` }}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderBookshelfItem = (item: Book | BooksGroup, key?: string) => (
    <BookshelfItem
      key={key}
      item={item}
      mode={viewMode as LibraryViewModeType}
      coverFit={coverFit as LibraryCoverFitType}
      isSelectMode={isSelectMode}
      itemSelected={
        'hash' in item ? selectedBooks.includes(item.hash) : selectedBooks.includes(item.id)
      }
      setLoading={setLoading}
      toggleSelection={toggleSelection}
      handleGroupBooks={groupSelectedBooks}
      handleBookUpload={handleBookUpload}
      handleBookDownload={handleBookDownload}
      handleBookDelete={handleBookDelete}
      handleSetSelectMode={handleSetSelectMode}
      handleShowDetailsBook={handleShowDetailsBook}
      handleLibraryNavigation={handleLibraryNavigation}
      handleUpdateReadingStatus={handleUpdateReadingStatus}
      transferProgress={'hash' in item ? booksTransferProgress[item.hash] || null : null}
    />
  );

  return (
    <div className='bookshelf flex h-full min-h-full flex-col'>
      <div className='min-h-0 flex-1'>
        {surfaceMode === 'books' ? (
          <div
            ref={autofocusRef}
            tabIndex={-1}
            className={clsx(
              'bookshelf-items transform-wrapper h-full focus:outline-none',
              usesVirtualizedSurface && 'flex min-h-0 flex-col',
              !usesVirtualizedSurface &&
                viewMode === 'grid' &&
                'grid flex-1 auto-rows-max grid-cols-3 content-start gap-x-4 px-4 sm:gap-x-0 sm:px-2',
              !usesVirtualizedSurface &&
                viewMode === 'grid' &&
                'sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-12',
              !usesVirtualizedSurface && viewMode === 'list' && 'flex flex-col',
            )}
            style={{
              gridTemplateColumns:
                !usesVirtualizedSurface && viewMode === 'grid' && !settings.libraryAutoColumns
                  ? `repeat(${settings.libraryColumns}, minmax(0, 1fr))`
                  : undefined,
            }}
            role='main'
            aria-label={_('Bookshelf')}
          >
            {showLibraryStatsCard && (
              <LibraryStatsCard
                className={clsx(
                  !usesVirtualizedSurface && viewMode === 'grid' ? 'col-span-full' : 'mx-4',
                  'mb-4',
                )}
              />
            )}
            {usesVirtualizedSurface ? (
              <div className='min-h-0 flex-1'>
                {shouldVirtualizeGrid ? (
                  <VirtuosoGrid
                    style={{ height: '100%' }}
                    totalCount={sortedBookshelfItems.length + (showImportTile ? 1 : 0)}
                    listClassName={gridListClassName}
                    itemContent={(index) => {
                      if (showImportTile && index === sortedBookshelfItems.length) {
                        return renderImportTile();
                      }
                      return renderBookshelfItem(sortedBookshelfItems[index]!);
                    }}
                  />
                ) : (
                  <Virtuoso
                    style={{ height: '100%' }}
                    totalCount={sortedBookshelfItems.length}
                    itemContent={(index) => renderBookshelfItem(sortedBookshelfItems[index]!)}
                  />
                )}
              </div>
            ) : (
              <>
                {sortedBookshelfItems.map((item) =>
                  renderBookshelfItem(item, `library-item-${'hash' in item ? item.hash : item.id}`),
                )}
                {showImportTile && renderImportTile()}
              </>
            )}
          </div>
        ) : (
          <SeriesShelf libraryBooks={libraryBooks} />
        )}
      </div>
      {loading && (
        <div className='fixed inset-0 z-50 flex items-center justify-center'>
          <Spinner loading />
        </div>
      )}
      {!showGroupingModal && isSelectMode && showSelectModeActions && (
        <SelectModeActions
          selectedBooks={selectedBooks}
          safeAreaBottom={safeAreaInsets?.bottom || 0}
          onOpen={openSelectedBooks}
          onGroup={groupSelectedBooks}
          onDetails={openBookDetails}
          onStatus={showStatusSelection}
          onDelete={deleteSelectedBooks}
          onCancel={() => handleSetSelectMode(false)}
        />
      )}
      <SeriesModal />
      {showGroupingModal && selectedBooks.length > 0 && (
        <ModalPortal>
          <GroupingModal
            libraryBooks={libraryBooks}
            selectedBooks={selectedBooks}
            parentGroupName={getGroupName(groupId) || ''}
            onCancel={() => {
              setShowGroupingModal(false);
              setShowSelectModeActions(true);
            }}
            onConfirm={() => {
              setShowGroupingModal(false);
              handleSetSelectMode(false);
            }}
          />
        </ModalPortal>
      )}
      {showDeleteAlert && (
        <div
          className={clsx('delete-alert fixed bottom-0 left-0 right-0 z-50 flex justify-center')}
          style={{
            paddingBottom: `${(safeAreaInsets?.bottom || 0) + 16}px`,
          }}
        >
          <Alert
            title={_('Confirm Deletion')}
            message={_('Are you sure to delete {{count}} selected book(s)?', {
              count: getBooksToDelete().length,
            })}
            onCancel={() => {
              abortDeletionRef.current = true;
              setShowDeleteAlert(false);
              setShowSelectModeActions(true);
            }}
            onConfirm={confirmDelete}
          />
        </div>
      )}
      {showStatusAlert && (
        <SetStatusAlert
          selectedCount={getSelectedBooks().length}
          safeAreaBottom={safeAreaInsets?.bottom || 0}
          onCancel={() => {
            setShowStatusAlert(false);
            setShowSelectModeActions(true);
          }}
          onUpdateStatus={updateBooksStatus}
        />
      )}
      <div
        className='bg-base-100/95 border-base-300 sticky bottom-0 z-10 mt-4 flex items-center justify-center gap-2 border-t px-4 py-3 backdrop-blur'
        style={{
          paddingBottom: `${(safeAreaInsets?.bottom || 0) + 12}px`,
        }}
      >
        <button
          className={clsx(
            'btn btn-sm rounded-full',
            surfaceMode === 'books' ? 'btn-primary' : 'btn-ghost',
          )}
          onClick={() => handleSetSurfaceMode('books')}
        >
          {_('My Books')}
        </button>
        <button
          className={clsx(
            'btn btn-sm rounded-full',
            surfaceMode === 'series' ? 'btn-primary' : 'btn-ghost',
          )}
          onClick={() => handleSetSurfaceMode('series')}
        >
          {_('My Series')}
        </button>
      </div>
    </div>
  );
};

export default Bookshelf;
