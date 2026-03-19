import React, { useCallback, useEffect, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { getAllSeries } from '@/services/contextTranslation/seriesService';
import type { Book } from '@/types/book';
import type { BookSeries } from '@/services/contextTranslation/types';

import SeriesCard from './SeriesCard';

interface SeriesShelfProps {
  libraryBooks: Book[];
}

const SeriesShelf: React.FC<SeriesShelfProps> = ({ libraryBooks }) => {
  const _ = useTranslation();
  const [seriesList, setSeriesList] = useState<BookSeries[]>([]);

  const loadSeries = useCallback(async () => {
    setSeriesList(await getAllSeries());
  }, []);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  if (seriesList.length === 0) {
    return (
      <div className='px-4 py-10 text-center text-sm text-base-content/60'>
        {_('No series yet.')}
      </div>
    );
  }

  return (
    <div className='space-y-4 px-4 pb-24'>
      {seriesList.map((series) => (
        <SeriesCard
          key={series.id}
          series={series}
          libraryBooks={libraryBooks}
          onIndexed={loadSeries}
        />
      ))}
    </div>
  );
};

export default SeriesShelf;
