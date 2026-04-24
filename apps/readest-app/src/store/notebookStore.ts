import { create } from 'zustand';
import { BookNote } from '@/types/book';
import { TextSelection } from '@/utils/sel';

export type NotebookTab = 'notes' | 'ai' | 'vocabulary';

interface NotebookState {
  notebookWidth: string;
  isNotebookVisible: boolean;
  isNotebookPinned: boolean;
  notebookActiveBookKey: string | null;
  notebookActiveTab: NotebookTab;
  notebookActiveTabs: Record<string, NotebookTab>;
  notebookNewAnnotation: TextSelection | null;
  notebookEditAnnotation: BookNote | null;
  notebookAnnotationDrafts: { [key: string]: string };
  getIsNotebookVisible: () => boolean;
  toggleNotebook: () => void;
  toggleNotebookPin: () => void;
  getNotebookWidth: () => string;
  setNotebookWidth: (width: string) => void;
  setNotebookVisible: (visible: boolean) => void;
  setNotebookPin: (pinned: boolean) => void;
  setNotebookBookKey: (bookKey: string | null) => void;
  setNotebookActiveTab: (bookKeyOrTab: string | NotebookTab, tab?: NotebookTab) => void;
  setNotebookNewAnnotation: (selection: TextSelection | null) => void;
  setNotebookEditAnnotation: (note: BookNote | null) => void;
  saveNotebookAnnotationDraft: (key: string, note: string) => void;
  getNotebookAnnotationDraft: (key: string) => string | undefined;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebookWidth: '',
  isNotebookVisible: false,
  isNotebookPinned: false,
  notebookActiveBookKey: null,
  notebookActiveTab: 'notes',
  notebookActiveTabs: {},
  notebookNewAnnotation: null,
  notebookEditAnnotation: null,
  notebookAnnotationDrafts: {},
  getIsNotebookVisible: () => get().isNotebookVisible,
  getNotebookWidth: () => get().notebookWidth,
  setNotebookWidth: (width: string) => set({ notebookWidth: width }),
  toggleNotebook: () => set((state) => ({ isNotebookVisible: !state.isNotebookVisible })),
  toggleNotebookPin: () => set((state) => ({ isNotebookPinned: !state.isNotebookPinned })),
  setNotebookVisible: (visible: boolean) => set({ isNotebookVisible: visible }),
  setNotebookPin: (pinned: boolean) => set({ isNotebookPinned: pinned }),
  setNotebookBookKey: (bookKey: string | null) =>
    set((state) => {
      const normalizedBookKey = bookKey?.trim().length ? bookKey.trim() : null;
      if (state.notebookActiveBookKey === normalizedBookKey) return state;
      if (!normalizedBookKey) {
        return {
          notebookActiveBookKey: null,
          notebookActiveTab: 'notes',
        };
      }

      const storedTab = state.notebookActiveTabs[normalizedBookKey];
      if (storedTab) {
        return {
          notebookActiveBookKey: normalizedBookKey,
          notebookActiveTab: storedTab,
        };
      }

      return {
        notebookActiveBookKey: normalizedBookKey,
        notebookActiveTab: state.notebookActiveBookKey === null ? state.notebookActiveTab : 'notes',
      };
    }),
  setNotebookActiveTab: (bookKeyOrTab: string | NotebookTab, tab?: NotebookTab) =>
    set((state) => {
      if (tab === undefined) {
        const nextTab = bookKeyOrTab as NotebookTab;
        if (!state.notebookActiveBookKey) {
          return { notebookActiveTab: nextTab };
        }

        return {
          notebookActiveTabs: {
            ...state.notebookActiveTabs,
            [state.notebookActiveBookKey]: nextTab,
          },
          notebookActiveTab: nextTab,
        };
      }

      const normalizedBookKey = bookKeyOrTab.trim();
      if (!normalizedBookKey) return state;

      const nextTabs = { ...state.notebookActiveTabs, [normalizedBookKey]: tab };
      const shouldUpdateShadow =
        state.notebookActiveBookKey === normalizedBookKey || state.notebookActiveBookKey === null;

      return {
        notebookActiveTabs: nextTabs,
        ...(shouldUpdateShadow ? { notebookActiveTab: tab } : {}),
      };
    }),
  setNotebookNewAnnotation: (selection: TextSelection | null) =>
    set({ notebookNewAnnotation: selection }),
  setNotebookEditAnnotation: (note: BookNote | null) => set({ notebookEditAnnotation: note }),
  saveNotebookAnnotationDraft: (key: string, note: string) =>
    set((state) => ({
      notebookAnnotationDrafts: { ...state.notebookAnnotationDrafts, [key]: note },
    })),
  getNotebookAnnotationDraft: (key: string) => get().notebookAnnotationDrafts[key],
}));
