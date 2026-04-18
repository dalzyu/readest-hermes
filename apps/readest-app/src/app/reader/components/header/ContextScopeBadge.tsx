import React, { useEffect, useState } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isBookIndexed } from '@/services/ai/ragService';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';

interface ContextScopeBadgeProps {
  bookKey: string;
}

const ContextScopeBadge: React.FC<ContextScopeBadgeProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const [indexed, setIndexed] = useState(false);
  const indexingProgress = useReaderStore((state) => state.indexingProgress[bookKey]);

  const hash = getBookData(bookKey)?.book?.hash;
  const translationSettings = settings.globalReadSettings.contextTranslation;
  const sameBook = translationSettings?.sameBookRagEnabled !== false;
  const crossVolume = translationSettings?.priorVolumeRagEnabled === true;

  useEffect(() => {
    if (!hash) {
      setIndexed(false);
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
  }, [hash]);

  useEffect(() => {
    if (!hash || indexingProgress) return;
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
  }, [hash, indexingProgress]);

  const scope: 'local' | 'volume' | 'series' =
    !indexed || !sameBook ? 'local' : crossVolume ? 'series' : 'volume';
  const label = scope === 'series' ? _('Series') : scope === 'volume' ? _('Volume') : _('Local');
  const toneClass =
    scope === 'series'
      ? 'border-success/40 bg-success/10 text-success'
      : scope === 'volume'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-error/40 bg-error/10 text-error';

  return (
    <span className={`badge badge-sm hidden border md:inline-flex ${toneClass}`}>{label}</span>
  );
};

export default ContextScopeBadge;
