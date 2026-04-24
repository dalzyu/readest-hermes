import { describe, expect, it } from 'vitest';

import { Book } from '@/types/book';
import { BaseDir, FileInfo, FileSystem, ResolvedPath } from '@/types/system';
import {
  deleteAudioSyncCorrectionSidecar,
  loadAudioSyncCorrectionSidecar,
  saveAudioSyncCorrectionSidecar,
} from '@/services/audioSync/storage';
import { hasStaleCorrectionsSince } from '@/services/audioSync/status';
import { AudioSyncCorrectionSidecar, AudioSyncGeneratedPackage } from '@/services/audioSync/types';

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
  return { baseDir: 0, basePrefix: async () => '', fp: path, base };
}

function createMemoryFs(): FileSystem {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const normalize = (path: string, base: BaseDir) => `${base}:${path}`;
  const ensureParents = (path: string, base: BaseDir) => {
    const parts = path.split('/');
    const segs: string[] = [];
    for (const part of parts.slice(0, -1)) {
      segs.push(part);
      dirs.add(normalize(segs.join('/'), base));
    }
  };
  return {
    resolvePath: (path, base) => makeResolvedPath(path, base),
    getURL: (p) => p,
    getBlobURL: async (p) => p,
    getImageURL: async (p) => p,
    openFile: async () => new File([''], 'f'),
    copyFile: async (_s, d, b) => {
      ensureParents(d, b);
      files.set(normalize(d, b), 'copied');
    },
    readFile: async (path, base, mode) => {
      const v = files.get(normalize(path, base));
      if (v == null) throw new Error(`Missing: ${path}`);
      return mode === 'text' ? v : new TextEncoder().encode(v).buffer;
    },
    writeFile: async (path, base, content) => {
      ensureParents(path, base);
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
      for (const k of Array.from(files.keys())) {
        if (k === key || k.startsWith(`${key}/`)) files.delete(k);
      }
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

function makeSidecar(updatedAt = 100): AudioSyncCorrectionSidecar {
  return {
    bookHash: 'book-hash',
    audioHash: 'audio-hash',
    corrections: [
      {
        audioChapterIndex: 0,
        audioOffsetMs: 500,
        nonBookAudio: true,
        note: 'Intro track — skip',
      },
      {
        audioChapterIndex: 2,
        sectionIndexOverride: 3,
        note: 'Chapter 3 maps to section 3 not 2',
      },
    ],
    createdAt: 50,
    updatedAt,
  };
}

function makePackage(createdAt = 200): AudioSyncGeneratedPackage {
  return {
    version: 1,
    generator: 'test',
    bookHash: 'book-hash',
    audioHash: 'audio-hash',
    syncMapId: 'map-1',
    syncMapVersion: 2,
    packagePath: 'book-hash/audio/epub3-sync/v1/synced.epub',
    audioPath: 'OEBPS/audio/asset.mp3',
    audioFileName: 'asset.mp3',
    sizeBytes: 1024,
    createdAt,
    updatedAt: createdAt,
    validation: { valid: true, checkedAt: createdAt, diagnostics: [] },
  };
}

describe('AudioSyncCorrectionSidecar storage', () => {
  it('saves and loads a correction sidecar', async () => {
    const fs = createMemoryFs();
    const book = makeBook();
    const sidecar = makeSidecar();

    await saveAudioSyncCorrectionSidecar(fs, book, sidecar);

    const loaded = await loadAudioSyncCorrectionSidecar(fs, book);
    expect(loaded).toEqual(sidecar);
    expect(loaded?.corrections).toHaveLength(2);
    expect(loaded?.corrections[0]?.nonBookAudio).toBe(true);
    expect(loaded?.corrections[1]?.sectionIndexOverride).toBe(3);
  });

  it('returns null when no correction sidecar exists', async () => {
    const fs = createMemoryFs();
    const book = makeBook();
    await expect(loadAudioSyncCorrectionSidecar(fs, book)).resolves.toBeNull();
  });

  it('rejects a sidecar whose bookHash does not match', async () => {
    const fs = createMemoryFs();
    const book = makeBook();
    const sidecar = makeSidecar();

    await saveAudioSyncCorrectionSidecar(fs, book, sidecar);

    const other = makeBook({ hash: 'other-hash' });
    await expect(loadAudioSyncCorrectionSidecar(fs, other)).resolves.toBeNull();
  });

  it('deletes the correction sidecar', async () => {
    const fs = createMemoryFs();
    const book = makeBook();

    await saveAudioSyncCorrectionSidecar(fs, book, makeSidecar());
    await deleteAudioSyncCorrectionSidecar(fs, book);

    await expect(loadAudioSyncCorrectionSidecar(fs, book)).resolves.toBeNull();
  });
});

describe('hasStaleCorrectionsSince', () => {
  it('returns false when there is no sidecar', () => {
    expect(hasStaleCorrectionsSince(null, makePackage())).toBe(false);
  });

  it('returns false when there is no generated package', () => {
    expect(hasStaleCorrectionsSince(makeSidecar(300), null)).toBe(false);
  });

  it('returns true when the sidecar was updated after the package was generated', () => {
    // sidecar updated at 300, package created at 200 → stale
    expect(hasStaleCorrectionsSince(makeSidecar(300), makePackage(200))).toBe(true);
  });

  it('returns false when the sidecar was updated before the package was generated', () => {
    // sidecar updated at 100, package created at 200 → not stale
    expect(hasStaleCorrectionsSince(makeSidecar(100), makePackage(200))).toBe(false);
  });
});
