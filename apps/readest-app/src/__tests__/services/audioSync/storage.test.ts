import { describe, expect, it } from 'vitest';

import { Book } from '@/types/book';
import { BaseDir, FileInfo, FileItem, FileSystem, ResolvedPath } from '@/types/system';
import { AUDIO_SYNC_MAP_VERSION } from '@/services/audioSync/constants';
import {
  clearBookAudioSidecars,
  hasLegacyAudioSyncMap,
  loadAudioAlignmentReport,
  loadAudioSyncGeneratedPackage,
  loadAudioSyncMap,
  loadBookAudioAsset,
  saveAudioAlignmentReport,
  saveAudioSyncGeneratedPackage,
  saveAudioSyncMap,
  saveBookAudioAsset,
} from '@/services/audioSync/storage';
import {
  AudioAlignmentReport,
  AudioSyncGeneratedPackage,
  AudioSyncMap,
  BookAudioAsset,
} from '@/services/audioSync/types';
import {
  getAudioAlignmentReportFilename,
  getAudioAssetFilename,
  getAudioSyncPackageFilename,
  getAudioSyncPackageProvenanceFilename,
  getLegacyAudioSyncMapFilename,
  getAudioSyncMapFilename,
  getBookAudioDir,
} from '@/utils/book';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'book-hash',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Tester',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeResolvedPath(path: string, base: BaseDir): ResolvedPath {
  return {
    baseDir: 0,
    basePrefix: async () => '',
    fp: path,
    base,
  };
}

function createMemoryFileSystem(): FileSystem {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const normalize = (path: string, base: BaseDir) => `${base}:${path}`;
  const ensureParentDirs = (path: string, base: BaseDir) => {
    const parts = path.split('/');
    const segments: string[] = [];
    for (const part of parts.slice(0, -1)) {
      segments.push(part);
      dirs.add(normalize(segments.join('/'), base));
    }
  };

  return {
    resolvePath: (path, base) => makeResolvedPath(path, base),
    getURL: (path) => path,
    getBlobURL: async (path) => path,
    getImageURL: async (path) => path,
    openFile: async () => new File(['audio'], 'audio.mp3'),
    copyFile: async (_srcPath, dstPath, base) => {
      ensureParentDirs(dstPath, base);
      files.set(normalize(dstPath, base), 'copied');
    },
    readFile: async (path, base, mode) => {
      const value = files.get(normalize(path, base));
      if (value == null) throw new Error(`Missing file: ${path}`);
      return mode === 'text' ? value : new TextEncoder().encode(value).buffer;
    },
    writeFile: async (path, base, content) => {
      ensureParentDirs(path, base);
      if (content instanceof ArrayBuffer) {
        files.set(normalize(path, base), new TextDecoder().decode(content));
      } else if (content instanceof File) {
        files.set(normalize(path, base), await content.text());
      } else {
        files.set(normalize(path, base), content);
      }
    },
    removeFile: async (path, base) => {
      files.delete(normalize(path, base));
    },
    readDir: async (path, base) => {
      const prefix = `${normalize(path, base)}/`;
      const items = new Set<string>();
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          items.add(key.slice(prefix.length).split('/')[0]!);
        }
      }
      return Array.from(items).map(
        (name): FileItem => ({ path: `${path}/${name}`.replace(/^\//, ''), size: 0 }),
      );
    },
    createDir: async (path, base) => {
      dirs.add(normalize(path, base));
    },
    removeDir: async (path, base) => {
      const key = normalize(path, base);
      dirs.delete(key);
      for (const fileKey of Array.from(files.keys())) {
        if (fileKey === key || fileKey.startsWith(`${key}/`)) {
          files.delete(fileKey);
        }
      }
      for (const dirKey of Array.from(dirs)) {
        if (dirKey === key || dirKey.startsWith(`${key}/`)) {
          dirs.delete(dirKey);
        }
      }
    },
    exists: async (path, base) => {
      const key = normalize(path, base);
      return (
        files.has(key) ||
        dirs.has(key) ||
        Array.from(files.keys()).some((fileKey) => fileKey.startsWith(`${key}/`))
      );
    },
    stats: async (): Promise<FileInfo> => ({
      isFile: true,
      isDirectory: false,
      size: 0,
      mtime: null,
      atime: null,
      birthtime: null,
    }),
    getPrefix: async () => '',
  };
}

describe('audioSync/storage', () => {
  it('saves and loads an audio asset sidecar', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();
    const asset: BookAudioAsset = {
      id: 'asset-1',
      bookHash: book.hash,
      audioHash: 'audio-hash',
      originalPath: `${getBookAudioDir(book)}/source.mp3`,
      originalFilename: 'source.mp3',
      format: 'mp3',
      durationMs: 12_345,
      createdAt: 1,
      updatedAt: 2,
    };

    await saveBookAudioAsset(fs, book, asset);

    await expect(loadBookAudioAsset(fs, book)).resolves.toEqual(asset);
  });

  it('rejects sync maps with the wrong version', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();
    const filename = getAudioSyncMapFilename(book);

    await fs.writeFile(
      filename,
      'Books',
      JSON.stringify({
        version: AUDIO_SYNC_MAP_VERSION + 1,
        bookHash: book.hash,
        audioHash: 'x',
        segments: [],
      }),
    );

    await expect(loadAudioSyncMap(fs, book)).resolves.toBeNull();
  });

  it('detects legacy sync maps without loading them as current artifacts', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();

    await fs.writeFile(
      getLegacyAudioSyncMapFilename(book),
      'Books',
      JSON.stringify({ version: 1, bookHash: book.hash, audioHash: 'legacy-audio', segments: [] }),
    );

    await expect(hasLegacyAudioSyncMap(fs, book)).resolves.toBe(true);
    await expect(loadAudioSyncMap(fs, book)).resolves.toBeNull();
  });

  it('clears the entire per-book audio directory', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();
    const asset: BookAudioAsset = {
      id: 'asset-1',
      bookHash: book.hash,
      audioHash: 'audio-hash',
      originalPath: `${getBookAudioDir(book)}/source.mp3`,
      originalFilename: 'source.mp3',
      format: 'mp3',
      createdAt: 1,
      updatedAt: 2,
    };
    const map: AudioSyncMap = {
      id: 'map-1',
      version: AUDIO_SYNC_MAP_VERSION,
      bookHash: book.hash,
      audioHash: 'audio-hash',
      granularity: 'sentence',
      status: 'ready',
      coverage: { matchedChars: 10, totalChars: 10, matchedRatio: 1 },
      confidence: { overall: 1, byChapter: { chapter1: 1 } },
      segments: [],
      createdAt: 1,
      updatedAt: 2,
    };
    const report: AudioAlignmentReport = {
      bookHash: book.hash,
      audioHash: 'audio-hash',
      runId: 'run-1',
      phase: 'ready',
      createdAt: 1,
      updatedAt: 2,
    };
    const generatedPackage: AudioSyncGeneratedPackage = {
      version: 1,
      generator: 'test-generator',
      bookHash: book.hash,
      audioHash: 'audio-hash',
      syncMapId: map.id,
      syncMapVersion: map.version,
      packagePath: getAudioSyncPackageFilename(book),
      audioPath: `${getBookAudioDir(book)}/normalized.mp3`,
      audioFileName: 'asset.mp3',
      sizeBytes: 256,
      createdAt: 1,
      updatedAt: 2,
      validation: {
        valid: true,
        checkedAt: 2,
        diagnostics: [],
      },
    };

    await saveBookAudioAsset(fs, book, asset);
    await saveAudioSyncMap(fs, book, map);
    await saveAudioAlignmentReport(fs, book, report);
    await fs.writeFile(getAudioSyncPackageFilename(book), 'Books', 'epub');
    await saveAudioSyncGeneratedPackage(fs, book, generatedPackage);
    await fs.writeFile(`${getBookAudioDir(book)}/source.mp3`, 'Books', 'audio');

    await clearBookAudioSidecars(fs, book);

    await expect(fs.exists(getBookAudioDir(book), 'Books')).resolves.toBe(false);
    await expect(loadBookAudioAsset(fs, book)).resolves.toBeNull();
    await expect(loadAudioSyncMap(fs, book)).resolves.toBeNull();
    await expect(loadAudioAlignmentReport(fs, book)).resolves.toBeNull();
    await expect(loadAudioSyncGeneratedPackage(fs, book)).resolves.toBeNull();
    await expect(fs.exists(getAudioAssetFilename(book), 'Books')).resolves.toBe(false);
    await expect(fs.exists(getAudioAlignmentReportFilename(book), 'Books')).resolves.toBe(false);
  });

  it('loads generated package provenance only when the package file exists', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();
    const generatedPackage: AudioSyncGeneratedPackage = {
      version: 1,
      generator: 'test-generator',
      bookHash: book.hash,
      audioHash: 'audio-hash',
      syncMapId: 'map-1',
      syncMapVersion: AUDIO_SYNC_MAP_VERSION,
      packagePath: getAudioSyncPackageFilename(book),
      audioPath: `${getBookAudioDir(book)}/normalized.mp3`,
      audioFileName: 'asset.mp3',
      sizeBytes: 123,
      createdAt: 1,
      updatedAt: 2,
      validation: {
        valid: true,
        checkedAt: 2,
        diagnostics: [],
      },
    };

    await saveAudioSyncGeneratedPackage(fs, book, generatedPackage);
    await expect(loadAudioSyncGeneratedPackage(fs, book)).resolves.toBeNull();

    await fs.writeFile(getAudioSyncPackageFilename(book), 'Books', 'epub');
    await expect(loadAudioSyncGeneratedPackage(fs, book)).resolves.toEqual(generatedPackage);
    await expect(fs.exists(getAudioSyncPackageProvenanceFilename(book), 'Books')).resolves.toBe(
      true,
    );
  });
});
