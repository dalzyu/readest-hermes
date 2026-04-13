import type { BookSeries } from './types';
import { aiStore } from '@/services/ai/storage/aiStore';

export async function getAllSeries(): Promise<BookSeries[]> {
  return aiStore.getAllSeries();
}

export async function getSeriesForBook(bookHash: string): Promise<BookSeries | null> {
  return aiStore.getSeriesForBook(bookHash);
}

export async function createSeries(name: string, bookHashes: string[]): Promise<BookSeries> {
  const series: BookSeries = {
    id: crypto.randomUUID(),
    name,
    volumes: bookHashes.map((bookHash, index) => ({
      bookHash,
      volumeIndex: index + 1,
      label: `Vol. ${index + 1}`,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await aiStore.saveSeries(series);
  return series;
}

export async function renameSeries(id: string, name: string): Promise<void> {
  const all = await aiStore.getAllSeries();
  const series = all.find((s) => s.id === id);
  if (!series) return;
  series.name = name;
  series.updatedAt = Date.now();
  await aiStore.saveSeries(series);
}

export async function addBookToSeries(seriesId: string, bookHash: string): Promise<void> {
  const all = await aiStore.getAllSeries();
  const series = all.find((s) => s.id === seriesId);
  if (!series) return;
  if (!series.volumes.some((volume) => volume.bookHash === bookHash)) {
    series.volumes.push({
      bookHash,
      volumeIndex: series.volumes.length + 1,
      label: `Vol. ${series.volumes.length + 1}`,
    });
    series.updatedAt = Date.now();
    await aiStore.saveSeries(series);
  }
}

export async function removeBookFromSeries(seriesId: string, bookHash: string): Promise<void> {
  const all = await aiStore.getAllSeries();
  const series = all.find((s) => s.id === seriesId);
  if (!series) return;
  series.volumes = series.volumes
    .filter((volume) => volume.bookHash !== bookHash)
    .map((volume, index) => ({ ...volume, volumeIndex: index + 1 }));
  series.updatedAt = Date.now();
  await aiStore.saveSeries(series);
}

export async function deleteSeries(id: string): Promise<void> {
  return aiStore.deleteSeries(id);
}

export async function updateSeriesVolume(
  seriesId: string,
  bookHash: string,
  patch: { volumeIndex?: number; label?: string },
): Promise<void> {
  const all = await aiStore.getAllSeries();
  const series = all.find((item) => item.id === seriesId);
  if (!series) return;

  series.volumes = series.volumes
    .map((volume) =>
      volume.bookHash === bookHash
        ? {
            ...volume,
            volumeIndex: patch.volumeIndex ?? volume.volumeIndex,
            label: patch.label ?? volume.label,
          }
        : volume,
    )
    .sort((a, b) => a.volumeIndex - b.volumeIndex);
  series.updatedAt = Date.now();
  await aiStore.saveSeries(series);
}

export async function getPriorVolumes(currentBookHash: string) {
  const series = await aiStore.getSeriesForBook(currentBookHash);
  if (!series) return [];

  const currentVolume = series.volumes.find((volume) => volume.bookHash === currentBookHash);
  if (!currentVolume) return [];

  return [...series.volumes]
    .sort((a, b) => a.volumeIndex - b.volumeIndex)
    .filter((volume) => volume.volumeIndex < currentVolume.volumeIndex);
}

export async function migrateLegacySeriesRecords(): Promise<void> {
  await aiStore.migrateLegacySeriesRecords();
}

/**
 * Search sibling volumes in the series for context relevant to `query`.
 * Returns up to `maxChunks` text snippets from indexed sibling books.
 * Books that are not yet indexed are silently skipped.
 */
export async function getCrossVolumeContext(
  currentBookHash: string,
  query: string,
  maxChunks: number,
): Promise<string> {
  const series = await aiStore.getSeriesForBook(currentBookHash);
  if (!series) return '';

  const currentVolume = series.volumes.find((volume) => volume.bookHash === currentBookHash);
  if (!currentVolume) return '';

  const priorVolumeHashes = series.volumes
    .filter((volume) => volume.volumeIndex < currentVolume.volumeIndex)
    .sort((a, b) => a.volumeIndex - b.volumeIndex)
    .map((volume) => volume.bookHash);
  if (priorVolumeHashes.length === 0) return '';

  const results: string[] = [];
  for (const siblingHash of priorVolumeHashes) {
    if (results.length >= maxChunks) break;
    const isIndexed = await aiStore.isIndexed(siblingHash);
    if (!isIndexed) continue;
    const chunks = await aiStore.bm25Search(siblingHash, query, maxChunks - results.length);
    for (const chunk of chunks) {
      results.push(`[${chunk.chapterTitle}] ${chunk.text}`);
      if (results.length >= maxChunks) break;
    }
  }

  return results.join('\n\n');
}
