'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import ContextLookupPopup from '@/components/ContextLookupPopup';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_CONTEXT_TRANSLATION_SETTINGS } from '@/services/contextTranslation/defaults';
import type { LookupHistoryEntry } from '@/services/contextTranslation/lookupHistoryService';
import { eventDispatcher } from '@/utils/event';
import type { Position } from '@/utils/sel';

const POPUP_MAX_WIDTH = 560;
const POPUP_MAX_HEIGHT = 260;
const POPUP_PADDING = 12;
const TRIANGLE_GAP = 6;

interface ReplayGeometry {
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
}

interface ReplaySnapshot extends ReplayGeometry {
  entry: LookupHistoryEntry;
}

interface ReplayFieldEntry {
  id: string;
  label: string;
  value: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isHistoryJumpGesture(
  event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

function humanizeFieldId(fieldId: string): string {
  const withSpaces = fieldId.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function buildReplayGeometry(anchorRect: DOMRect): ReplayGeometry {
  const popupWidth = Math.max(
    240,
    Math.min(POPUP_MAX_WIDTH, window.innerWidth - POPUP_PADDING * 2),
  );
  const popupHeight = Math.max(
    180,
    Math.min(POPUP_MAX_HEIGHT, window.innerHeight - POPUP_PADDING * 2),
  );

  const triangleX = anchorRect.left + anchorRect.width / 2;
  const spaceAbove = anchorRect.top - POPUP_PADDING;
  const spaceBelow = window.innerHeight - anchorRect.bottom - POPUP_PADDING;
  const placeBelow = spaceBelow >= popupHeight || spaceBelow >= spaceAbove;

  const dir: Position['dir'] = placeBelow ? 'down' : 'up';
  const triangleY = placeBelow ? anchorRect.bottom + TRIANGLE_GAP : anchorRect.top - TRIANGLE_GAP;
  const maxLeft = Math.max(POPUP_PADDING, window.innerWidth - popupWidth - POPUP_PADDING);
  const maxTop = Math.max(POPUP_PADDING, window.innerHeight - popupHeight - POPUP_PADDING);
  const left = clamp(triangleX - popupWidth / 2, POPUP_PADDING, maxLeft);
  const top = placeBelow
    ? clamp(triangleY, POPUP_PADDING, maxTop)
    : clamp(triangleY - popupHeight, POPUP_PADDING, maxTop);

  return {
    position: { point: { x: left, y: top }, dir },
    trianglePosition: { point: { x: triangleX, y: triangleY }, dir },
    popupWidth,
    popupHeight,
  };
}

function buildReplayFieldEntries(
  entry: LookupHistoryEntry,
  outputFields: Array<{ id: string; label: string; enabled: boolean; order: number }>,
  _: (value: string) => string,
): ReplayFieldEntry[] {
  const consumed = new Set<string>();
  const knownFields = outputFields
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order)
    .flatMap((field) => {
      const value = entry.result[field.id]?.trim() ?? '';
      if (!value) return [];
      consumed.add(field.id);
      return [
        {
          id: field.id,
          label: _(field.label),
          value,
        },
      ];
    });

  const extraFields = Object.entries(entry.result)
    .map(([id, value]) => ({ id, value: value.trim() }))
    .filter(({ id, value }) => value.length > 0 && !consumed.has(id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, value }) => ({ id, label: humanizeFieldId(id), value }));

  return [...knownFields, ...extraFields];
}

interface LookupHistoryReplayPopupProps {
  bookKey: string;
  entry: LookupHistoryEntry;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss: () => void;
}

export const LookupHistoryReplayPopup: React.FC<LookupHistoryReplayPopupProps> = ({
  bookKey,
  entry,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();

  const ctxSettings =
    settings?.globalReadSettings?.contextTranslation ?? DEFAULT_CONTEXT_TRANSLATION_SETTINGS;
  const fields = useMemo(
    () => buildReplayFieldEntries(entry, ctxSettings.outputFields, _),
    [entry, ctxSettings.outputFields, _],
  );
  const term = entry.term.trim();
  const context = entry.context.trim();
  const replayBadgeLabel =
    entry.mode === 'dictionary' ? _('Dictionary lookup replay') : _('Translation lookup replay');
  const bookLanguage = getBookData(bookKey)?.book?.primaryLanguage;

  const handleSpeak = useCallback(() => {
    void eventDispatcher.dispatch('tts-speak', {
      bookKey,
      text: term,
      oneTime: true,
      ...(bookLanguage ? { lang: bookLanguage } : {}),
    });
  }, [bookKey, bookLanguage, term]);

  if (!term) return null;

  return createPortal(
    <ContextLookupPopup
      selectedText={term}
      retrievalStatusMeta={{
        label: replayBadgeLabel,
        className: 'border border-slate-500/40 bg-slate-600/80 text-slate-100',
      }}
      retrievalInfoText={_('Replaying a saved lookup from history.')}
      loading={false}
      aiEnabled={false}
      hasDisplayedResult={true}
      availabilityHint={null}
      onSpeakSelectedText={handleSpeak}
      askAboutThisEnabled={false}
      onAskAboutThis={() => undefined}
      saveEnabled={false}
      saved={false}
      onSave={() => undefined}
      position={position}
      trianglePosition={trianglePosition}
      popupWidth={popupWidth}
      popupHeight={popupHeight}
      onDismiss={onDismiss}
      testId='lookup-history-replay-popup'
      maxWidth='620px'
    >
      {context && (
        <div>
          <h3 className='text-base-content/50 mb-1 text-xs font-medium uppercase tracking-wide'>
            {_('Context')}
          </h3>
          <p className='not-eink:text-white/90 whitespace-pre-wrap text-sm leading-relaxed'>
            {context}
          </p>
        </div>
      )}
      <div className='space-y-3'>
        {fields.map((field) => (
          <div key={field.id}>
            <h3 className='text-base-content/50 mb-1 text-xs font-medium uppercase tracking-wide'>
              {field.label}
            </h3>
            <p className='not-eink:text-white/90 whitespace-pre-wrap text-sm leading-relaxed'>
              {field.value}
            </p>
          </div>
        ))}
      </div>
      {entry.location && (
        <p className='text-base-content/40 text-xs leading-snug'>
          {_('Shift/Ctrl/Cmd-click the row to jump to the saved location.')}
        </p>
      )}
    </ContextLookupPopup>,
    document.body,
  );
};

export function useLookupHistoryReplay(bookKey: string) {
  const { getView } = useReaderStore();
  const [snapshot, setSnapshot] = useState<ReplaySnapshot | null>(null);

  const openReplay = useCallback((entry: LookupHistoryEntry, anchor: HTMLElement) => {
    const geometry = buildReplayGeometry(anchor.getBoundingClientRect());
    setSnapshot({ ...geometry, entry });
  }, []);

  const handleHistoryRowClick = useCallback(
    (entry: LookupHistoryEntry, event: React.MouseEvent<HTMLElement>) => {
      if (isHistoryJumpGesture(event)) {
        if (!entry.location) return;
        const view = getView(bookKey);
        if (!view) return;
        void eventDispatcher.dispatch('navigate', {
          bookKey,
          cfi: entry.location,
        });
        view.goTo(entry.location);
        setSnapshot(null);
        return;
      }

      openReplay(entry, event.currentTarget);
    },
    [bookKey, getView, openReplay],
  );

  const replayPopup = snapshot ? (
    <LookupHistoryReplayPopup
      bookKey={bookKey}
      entry={snapshot.entry}
      position={snapshot.position}
      trianglePosition={snapshot.trianglePosition}
      popupWidth={snapshot.popupWidth}
      popupHeight={snapshot.popupHeight}
      onDismiss={() => setSnapshot(null)}
    />
  ) : null;

  return { handleHistoryRowClick, replayPopup };
}

export type { ReplaySnapshot as LookupHistoryReplaySnapshot };
