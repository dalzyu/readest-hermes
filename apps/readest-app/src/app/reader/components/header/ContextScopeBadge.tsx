import React, { useEffect, useMemo, useState } from 'react';

import { isBookIndexed } from '@/services/ai/ragService';
import { getSeriesForBook } from '@/services/contextTranslation/seriesService';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

type ScopeLabel = 'local' | 'volume' | 'series';

interface ContextScopeBadgeProps {
  bookKey: string;
}

function resolveScope(
  indexed: boolean,
  sameBookEnabled: boolean,
  priorVolumeEnabled: boolean,
  hasPriorVolumes: boolean,
): ScopeLabel {
  if (!indexed || !sameBookEnabled) return 'local';
  if (priorVolumeEnabled && hasPriorVolumes) return 'series';
  return 'volume';
}

const ContextScopeBadge: React.FC<ContextScopeBadgeProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const [indexed, setIndexed] = useState(false);
  const [hasPriorVolumes, setHasPriorVolumes] = useState(false);
  const [heldScope, setHeldScope] = useState<ScopeLabel | null>(null);

  const indexingProgress = useReaderStore((state) => state.indexingProgress[bookKey]);
  const indexingPhase = indexingProgress?.phase;

  const hash = getBookData(bookKey)?.book?.hash;
  const translationSettings = settings.globalReadSettings.contextTranslation;
  const sameBookEnabled = translationSettings?.sameBookRagEnabled !== false;
  const priorVolumeEnabled = translationSettings?.priorVolumeRagEnabled === true;

  const liveScope = useMemo(
    () => resolveScope(indexed, sameBookEnabled, priorVolumeEnabled, hasPriorVolumes),
    [indexed, sameBookEnabled, priorVolumeEnabled, hasPriorVolumes],
  );

  const indexingActive = Boolean(indexingPhase && indexingPhase !== 'complete');

  useEffect(() => {
    if (!hash) {
      setIndexed(false);
      return;
    }

    if (indexingPhase && indexingPhase !== 'complete') {
      return;
    }

    let cancelled = false;
    void isBookIndexed(hash)
      .then((value) => {
        if (!cancelled) setIndexed(value);
      })
      .catch(() => {
        if (!cancelled) setIndexed(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hash, indexingPhase]);

  useEffect(() => {
    if (!hash || !priorVolumeEnabled) {
      setHasPriorVolumes(false);
      return;
    }

    let cancelled = false;
    void getSeriesForBook(hash)
      .then((series) => {
        if (cancelled || !series) {
          if (!cancelled) setHasPriorVolumes(false);
          return;
        }

        const currentVolume = series.volumes.find((volume) => volume.bookHash === hash);
        if (!currentVolume) {
          setHasPriorVolumes(false);
          return;
        }

        setHasPriorVolumes(
          series.volumes.some((volume) => volume.volumeIndex < currentVolume.volumeIndex),
        );
      })
      .catch(() => {
        if (!cancelled) setHasPriorVolumes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hash, priorVolumeEnabled]);

  useEffect(() => {
    if (indexingActive) {
      setHeldScope((previous) => previous ?? liveScope);
      return;
    }

    setHeldScope(null);
  }, [indexingActive, liveScope]);

  const displayedScope = indexingActive ? (heldScope ?? liveScope) : liveScope;

  const label =
    displayedScope === 'series'
      ? _('Series')
      : displayedScope === 'volume'
        ? _('Volume')
        : _('Local');

  const toneClass =
    displayedScope === 'series'
      ? 'border-success/40 bg-success/10 text-success'
      : displayedScope === 'volume'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-error/40 bg-error/10 text-error';

  return (
    <span className={`badge badge-sm hidden border md:inline-flex ${toneClass}`}>{label}</span>
  );
};

export default ContextScopeBadge;
