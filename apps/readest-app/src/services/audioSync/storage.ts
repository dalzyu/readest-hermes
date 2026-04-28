import { Book } from '@/types/book';
import { FileSystem } from '@/types/system';
import { safeLoadJSON, safeSaveJSON } from '@/services/persistence';
import {
  getAudioAlignmentReportFilename,
  getAudioAssetFilename,
  getAudioSyncCorrectionFilename,
  getAudioSyncMapFilename,
  getAudioSyncPackageFilename,
  getAudioSyncPackageProvenanceFilename,
  getAudioSyncPackageVersionDir,
  getBookAudioDir,
  getLegacyAudioSyncMapFilename,
} from '@/utils/book';

import {
  AUDIO_ALIGNMENT_REPORT_FILENAME,
  AUDIO_ASSET_FILENAME,
  AUDIO_SYNC_EPUB3_DIRNAME,
  AUDIO_SYNC_EPUB3_FILENAME,
  AUDIO_SYNC_LEGACY_MAP_FILENAME,
  AUDIO_SYNC_MAP_FILENAME,
  AUDIO_SYNC_MAP_VERSION,
  AUDIO_SYNC_PACKAGE_PROVENANCE_FILENAME,
} from './constants';
import {
  AudioAlignmentReport,
  AudioSyncCorrectionSidecar,
  AudioSyncGeneratedPackage,
  AudioSyncMap,
  BookAudioAsset,
} from './types';

async function ensureBookAudioDir(fs: FileSystem, book: Book): Promise<void> {
  const dir = getBookAudioDir(book);
  if (!(await fs.exists(dir, 'Books'))) {
    await fs.createDir(dir, 'Books', true);
  }
}

function validateAudioAsset(asset: unknown, book: Book): BookAudioAsset | null {
  if (!asset || typeof asset !== 'object') return null;
  const candidate = asset as Partial<BookAudioAsset>;
  if (!candidate.id || candidate.bookHash !== book.hash || !candidate.audioHash) {
    return null;
  }
  return candidate as BookAudioAsset;
}

function validateSyncMap(map: unknown, book: Book): AudioSyncMap | null {
  if (!map || typeof map !== 'object') return null;
  const candidate = map as Partial<AudioSyncMap>;
  if (
    candidate.version !== AUDIO_SYNC_MAP_VERSION ||
    candidate.bookHash !== book.hash ||
    !candidate.audioHash ||
    !Array.isArray(candidate.segments)
  ) {
    return null;
  }
  return candidate as AudioSyncMap;
}

function validateAlignmentReport(report: unknown, book: Book): AudioAlignmentReport | null {
  if (!report || typeof report !== 'object') return null;
  const candidate = report as Partial<AudioAlignmentReport>;
  if (!candidate.runId || candidate.bookHash !== book.hash || !candidate.audioHash) {
    return null;
  }
  return candidate as AudioAlignmentReport;
}

function validateGeneratedPackage(
  generatedPackage: unknown,
  book: Book,
): AudioSyncGeneratedPackage | null {
  if (!generatedPackage || typeof generatedPackage !== 'object') return null;
  const candidate = generatedPackage as Partial<AudioSyncGeneratedPackage>;
  if (
    candidate.bookHash !== book.hash ||
    !candidate.audioHash ||
    !candidate.packagePath ||
    !candidate.audioPath ||
    !candidate.validation ||
    !Array.isArray(candidate.validation.diagnostics)
  ) {
    return null;
  }
  return candidate as AudioSyncGeneratedPackage;
}

export async function loadBookAudioAsset(
  fs: FileSystem,
  book: Book,
): Promise<BookAudioAsset | null> {
  const filename = getAudioAssetFilename(book);
  if (!(await fs.exists(filename, 'Books'))) {
    return null;
  }
  const data = await safeLoadJSON<unknown>(fs, filename, 'Books', null);
  return validateAudioAsset(data, book);
}

export async function saveBookAudioAsset(
  fs: FileSystem,
  book: Book,
  asset: BookAudioAsset,
): Promise<void> {
  await ensureBookAudioDir(fs, book);
  await safeSaveJSON(fs, getAudioAssetFilename(book), 'Books', asset);
}

export async function deleteBookAudioAsset(fs: FileSystem, book: Book): Promise<void> {
  const filename = getAudioAssetFilename(book);
  if (await fs.exists(filename, 'Books')) {
    await fs.removeFile(filename, 'Books');
  }
  const backupFilename = `${filename}.bak`;
  if (await fs.exists(backupFilename, 'Books')) {
    await fs.removeFile(backupFilename, 'Books');
  }
}

export async function loadAudioSyncMap(fs: FileSystem, book: Book): Promise<AudioSyncMap | null> {
  const filename = getAudioSyncMapFilename(book);
  if (!(await fs.exists(filename, 'Books'))) {
    return null;
  }
  const data = await safeLoadJSON<unknown>(fs, filename, 'Books', null);
  return validateSyncMap(data, book);
}

export async function saveAudioSyncMap(
  fs: FileSystem,
  book: Book,
  map: AudioSyncMap,
): Promise<void> {
  await ensureBookAudioDir(fs, book);
  await safeSaveJSON(fs, getAudioSyncMapFilename(book), 'Books', map);
}

export async function deleteAudioSyncMap(fs: FileSystem, book: Book): Promise<void> {
  for (const filename of [getAudioSyncMapFilename(book), getLegacyAudioSyncMapFilename(book)]) {
    if (await fs.exists(filename, 'Books')) {
      await fs.removeFile(filename, 'Books');
    }
    const backupFilename = `${filename}.bak`;
    if (await fs.exists(backupFilename, 'Books')) {
      await fs.removeFile(backupFilename, 'Books');
    }
  }
}

export async function hasLegacyAudioSyncMap(fs: FileSystem, book: Book): Promise<boolean> {
  return await fs.exists(getLegacyAudioSyncMapFilename(book), 'Books');
}

export async function loadAudioAlignmentReport(
  fs: FileSystem,
  book: Book,
): Promise<AudioAlignmentReport | null> {
  const filename = getAudioAlignmentReportFilename(book);
  if (!(await fs.exists(filename, 'Books'))) {
    return null;
  }
  const data = await safeLoadJSON<unknown>(fs, filename, 'Books', null);
  return validateAlignmentReport(data, book);
}

export async function saveAudioAlignmentReport(
  fs: FileSystem,
  book: Book,
  report: AudioAlignmentReport,
): Promise<void> {
  await ensureBookAudioDir(fs, book);
  await safeSaveJSON(fs, getAudioAlignmentReportFilename(book), 'Books', report);
}

export async function deleteAudioAlignmentReport(fs: FileSystem, book: Book): Promise<void> {
  const filename = getAudioAlignmentReportFilename(book);
  if (await fs.exists(filename, 'Books')) {
    await fs.removeFile(filename, 'Books');
  }
  const backupFilename = `${filename}.bak`;
  if (await fs.exists(backupFilename, 'Books')) {
    await fs.removeFile(backupFilename, 'Books');
  }
}

export async function loadAudioSyncGeneratedPackage(
  fs: FileSystem,
  book: Book,
): Promise<AudioSyncGeneratedPackage | null> {
  const provenanceFilename = getAudioSyncPackageProvenanceFilename(book);
  const packageFilename = getAudioSyncPackageFilename(book);
  if (
    !(await fs.exists(provenanceFilename, 'Books')) ||
    !(await fs.exists(packageFilename, 'Books'))
  ) {
    return null;
  }
  const data = await safeLoadJSON<unknown>(fs, provenanceFilename, 'Books', null);
  return validateGeneratedPackage(data, book);
}

export async function saveAudioSyncGeneratedPackage(
  fs: FileSystem,
  book: Book,
  generatedPackage: AudioSyncGeneratedPackage,
): Promise<void> {
  await ensureBookAudioDir(fs, book);
  await fs.createDir(getAudioSyncPackageVersionDir(book), 'Books', true);
  await safeSaveJSON(fs, getAudioSyncPackageProvenanceFilename(book), 'Books', generatedPackage);
}

export async function deleteAudioSyncGeneratedPackage(fs: FileSystem, book: Book): Promise<void> {
  const packageFilename = getAudioSyncPackageFilename(book);
  const provenanceFilename = getAudioSyncPackageProvenanceFilename(book);
  for (const filename of [packageFilename, provenanceFilename]) {
    if (await fs.exists(filename, 'Books')) {
      await fs.removeFile(filename, 'Books');
    }
    const backupFilename = `${filename}.bak`;
    if (await fs.exists(backupFilename, 'Books')) {
      await fs.removeFile(backupFilename, 'Books');
    }
  }
}

export async function loadAudioSyncCorrectionSidecar(
  fs: FileSystem,
  book: Book,
): Promise<AudioSyncCorrectionSidecar | null> {
  const filename = getAudioSyncCorrectionFilename(book);
  if (!(await fs.exists(filename, 'Books'))) {
    return null;
  }
  const data = await safeLoadJSON<unknown>(fs, filename, 'Books', null);
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Partial<AudioSyncCorrectionSidecar>;
  if (candidate.bookHash !== book.hash || !Array.isArray(candidate.corrections)) {
    return null;
  }
  return candidate as AudioSyncCorrectionSidecar;
}

export async function saveAudioSyncCorrectionSidecar(
  fs: FileSystem,
  book: Book,
  sidecar: AudioSyncCorrectionSidecar,
): Promise<void> {
  await ensureBookAudioDir(fs, book);
  await safeSaveJSON(fs, getAudioSyncCorrectionFilename(book), 'Books', sidecar);
}

export async function deleteAudioSyncCorrectionSidecar(fs: FileSystem, book: Book): Promise<void> {
  const filename = getAudioSyncCorrectionFilename(book);
  if (await fs.exists(filename, 'Books')) {
    await fs.removeFile(filename, 'Books');
  }
}

export async function clearBookAudioSidecars(fs: FileSystem, book: Book): Promise<void> {
  const dir = getBookAudioDir(book);
  if (await fs.exists(dir, 'Books')) {
    await fs.removeDir(dir, 'Books', true);
  }
}

export const AUDIO_SYNC_SIDECAR_FILES = {
  asset: AUDIO_ASSET_FILENAME,
  map: AUDIO_SYNC_MAP_FILENAME,
  legacyMap: AUDIO_SYNC_LEGACY_MAP_FILENAME,
  report: AUDIO_ALIGNMENT_REPORT_FILENAME,
  packageDir: AUDIO_SYNC_EPUB3_DIRNAME,
  packageFile: AUDIO_SYNC_EPUB3_FILENAME,
  packageProvenance: AUDIO_SYNC_PACKAGE_PROVENANCE_FILENAME,
} as const;
