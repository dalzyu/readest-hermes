import { describe, expect, it } from 'vitest';

import { loadBookContent } from '@/services/bookService';
import { Book } from '@/types/book';
import { BaseDir, FileInfo, FileItem, FileSystem, ResolvedPath } from '@/types/system';
import { getAudioSyncPackageFilename, getAudioSyncPackageProvenanceFilename } from '@/utils/book';

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
    openFile: async (path) => new File([path], path.split('/').pop() || 'file.epub'),
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
    readDir: async () => [],
    createDir: async (path, base) => {
      dirs.add(normalize(path, base));
    },
    removeDir: async (path, base) => {
      const key = normalize(path, base);
      dirs.delete(key);
    },
    exists: async (path, base) => {
      const key = normalize(path, base);
      return files.has(key) || dirs.has(key);
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

describe('bookService audio sync package preference', () => {
  it('prefers the validated generated EPUB package over the original book file', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();
    const originalPath = `${book.hash}/Test Book.epub`;
    const packagePath = getAudioSyncPackageFilename(book);

    await fs.writeFile(originalPath, 'Books', 'original');
    await fs.writeFile(packagePath, 'Books', 'generated');
    await fs.writeFile(
      getAudioSyncPackageProvenanceFilename(book),
      'Books',
      JSON.stringify({
        version: 1,
        generator: 'test-generator',
        bookHash: book.hash,
        audioHash: 'audio-hash',
        syncMapId: 'map-1',
        syncMapVersion: 2,
        packagePath,
        audioPath: 'OEBPS/audio/asset.mp3',
        audioFileName: 'asset.mp3',
        sizeBytes: 123,
        createdAt: 1,
        updatedAt: 2,
        validation: {
          valid: true,
          checkedAt: 2,
          diagnostics: [],
        },
      }),
    );

    const content = await loadBookContent(fs, book);

    expect(content.file.name).toBe('synced.epub');
  });

  it('falls back to the original EPUB when the generated package is not validated', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();
    const originalPath = `${book.hash}/Test Book.epub`;
    const packagePath = getAudioSyncPackageFilename(book);

    await fs.writeFile(originalPath, 'Books', 'original');
    await fs.writeFile(packagePath, 'Books', 'generated');
    await fs.writeFile(
      getAudioSyncPackageProvenanceFilename(book),
      'Books',
      JSON.stringify({
        version: 1,
        generator: 'test-generator',
        bookHash: book.hash,
        audioHash: 'audio-hash',
        syncMapId: 'map-1',
        syncMapVersion: 2,
        packagePath,
        audioPath: 'OEBPS/audio/asset.mp3',
        audioFileName: 'asset.mp3',
        sizeBytes: 123,
        createdAt: 1,
        updatedAt: 2,
        validation: {
          valid: false,
          checkedAt: 2,
          diagnostics: [{ code: 'invalid', message: 'invalid', severity: 'error' }],
        },
      }),
    );

    const content = await loadBookContent(fs, book);

    expect(content.file.name).toBe('Test Book.epub');
  });

  it('can explicitly load the original EPUB even when a validated generated package exists', async () => {
    const fs = createMemoryFileSystem();
    const book = makeBook();
    const originalPath = `${book.hash}/Test Book.epub`;
    const packagePath = getAudioSyncPackageFilename(book);

    await fs.writeFile(originalPath, 'Books', 'original');
    await fs.writeFile(packagePath, 'Books', 'generated');
    await fs.writeFile(
      getAudioSyncPackageProvenanceFilename(book),
      'Books',
      JSON.stringify({
        version: 1,
        generator: 'test-generator',
        bookHash: book.hash,
        audioHash: 'audio-hash',
        syncMapId: 'map-1',
        syncMapVersion: 2,
        packagePath,
        audioPath: 'OEBPS/audio/asset.mp3',
        audioFileName: 'asset.mp3',
        sizeBytes: 123,
        createdAt: 1,
        updatedAt: 2,
        validation: {
          valid: true,
          checkedAt: 2,
          diagnostics: [],
        },
      }),
    );

    const content = await loadBookContent(fs, book, { preferGeneratedPackage: false });

    expect(content.file.name).toBe('Test Book.epub');
  });
});
