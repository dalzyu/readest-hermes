import { basename } from 'node:path';
import { readFile, writeFile as writeNodeFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { prepareAudioAlignmentInput } from '@/services/audioSync/alignmentInput';
import { AppService } from '@/types/system';
import { Book } from '@/types/book';
import { BookAudioAsset } from '@/services/audioSync/types';

const sampleEpub = process.env['HERMES_AUDIO_SYNC_SAMPLE_EPUB'];
const materializedOutput = process.env['HERMES_AUDIO_SYNC_SAMPLE_INPUT_OUT'];
const runIfSample = sampleEpub ? it : it.skip;

if (!globalThis.CSS) {
  Object.defineProperty(globalThis, 'CSS', {
    value: { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
    configurable: true,
  });
} else if (!globalThis.CSS.escape) {
  Object.defineProperty(globalThis.CSS, 'escape', {
    value: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
    configurable: true,
  });
}

function makeBook(): Book {
  return {
    hash: 'real-sample-book',
    format: 'EPUB',
    title: 'Real Sample',
    author: 'Unknown',
    createdAt: 1,
    updatedAt: 2,
  };
}

function makeAsset(): BookAudioAsset {
  return {
    id: 'asset-1',
    bookHash: 'real-sample-book',
    audioHash: 'audio-1',
    originalPath: 'real-sample-book/audio/source.m4b',
    originalFilename: 'source.m4b',
    format: 'm4b',
    durationMs: 1,
    chapters: [{ index: 0, title: 'Sample', startMs: 0, endMs: 1 }],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('prepareAudioAlignmentInput real sample', () => {
  runIfSample(
    'extracts canonical sections from a real EPUB sample',
    async () => {
      const buffer = await readFile(sampleEpub!);
      const book = makeBook();
      const asset = makeAsset();
      const writeFile = vi
        .fn()
        .mockImplementation(async (_path: string, _base: string, content: string) => {
          if (materializedOutput) {
            await writeNodeFile(materializedOutput, content, 'utf8');
          }
        });
      const resolveFilePath = vi
        .fn()
        .mockResolvedValue(materializedOutput || 'C:/tmp/alignment-input.v3.json');
      const appService = {
        loadBookContent: vi.fn().mockResolvedValue({
          book,
          file: new File([buffer], basename(sampleEpub!), { type: 'application/epub+zip' }),
        }),
        writeFile,
        resolveFilePath,
      } as Pick<AppService, 'loadBookContent' | 'writeFile' | 'resolveFilePath'> as AppService;

      const result = await prepareAudioAlignmentInput(appService, book, asset);
      const payload = JSON.parse(writeFile.mock.calls[0]![2] as string);

      expect(result).toBe(materializedOutput || 'C:/tmp/alignment-input.v3.json');
      expect(payload.version).toBe(3);
      expect(payload.audio.chapters.length).toBe(1);
      expect(payload.sections.length).toBeGreaterThan(5);
      expect(
        payload.sections.some((section: { tokens: Array<unknown> }) => section.tokens.length > 0),
      ).toBe(true);
      expect(payload.toc.length).toBeGreaterThan(0);
      if (materializedOutput) {
        const materialized = JSON.parse(await readFile(materializedOutput, 'utf8'));
        expect(materialized.sections.length).toBe(payload.sections.length);
      }
    },
    120_000,
  );
});
