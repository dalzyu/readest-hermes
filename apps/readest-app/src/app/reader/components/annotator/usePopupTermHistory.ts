import { useCallback, useEffect, useMemo, useState } from 'react';

interface PopupTermHistoryState {
  items: string[];
  index: number;
}

export function usePopupTermHistory(initialTerm: string) {
  const [history, setHistory] = useState<PopupTermHistoryState>({
    items: [initialTerm],
    index: 0,
  });

  useEffect(() => {
    setHistory({ items: [initialTerm], index: 0 });
  }, [initialTerm]);

  const currentTerm = history.items[history.index] ?? initialTerm;
  const canGoBack = history.index > 0;
  const canGoForward = history.index < history.items.length - 1;

  const pushTerm = useCallback((nextTerm: string) => {
    const trimmed = nextTerm.trim();
    if (!trimmed) return;

    setHistory((current) => {
      const currentTerm = current.items[current.index];
      if (currentTerm === trimmed) return current;
      const nextItems = [...current.items.slice(0, current.index + 1), trimmed];
      return { items: nextItems, index: nextItems.length - 1 };
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((current) => {
      if (current.index === 0) return current;
      return { ...current, index: current.index - 1 };
    });
  }, []);

  const goForward = useCallback(() => {
    setHistory((current) => {
      if (current.index >= current.items.length - 1) return current;
      return { ...current, index: current.index + 1 };
    });
  }, []);

  return useMemo(
    () => ({
      currentTerm,
      canGoBack,
      canGoForward,
      pushTerm,
      goBack,
      goForward,
    }),
    [currentTerm, canGoBack, canGoForward, pushTerm, goBack, goForward],
  );
}
