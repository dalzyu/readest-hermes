import React, { useEffect, useState } from 'react';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { isBookIndexed } from '@/services/ai/ragService';
import { useTranslation } from '@/hooks/useTranslation';

interface ContextScopeBadgeProps {
  bookKey: string;
}

const ContextScopeBadge: React.FC<ContextScopeBadgeProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const [indexed, setIndexed] = useState(false);

  const hash = getBookData(bookKey)?.book?.hash;
  const translationSettings = settings.globalReadSettings.contextTranslation;
  const sameBook = translationSettings?.sameBookRagEnabled;
  const crossVolume = translationSettings?.priorVolumeRagEnabled;

  useEffect(() => {
    if (!hash) return;
    void isBookIndexed(hash)
      .then(setIndexed)
      .catch(() => setIndexed(false));
  }, [hash]);

  const label = !indexed ? _('Off') : crossVolume ? _('Cross') : sameBook ? _('Local') : _('Off');

  return <span className='badge badge-outline badge-sm hidden md:inline-flex'>{label}</span>;
};

export default ContextScopeBadge;
