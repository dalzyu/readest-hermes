import type { DictionaryEntry } from './types';

/**
 * Parse a StarDict .ifo file.
 * @returns Object with name, wordcount, and sametypesequence (if present)
 */
export function parseIfo(buffer: Uint8Array): {
  name: string;
  wordcount: number;
  sametypesequence?: string;
} {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  const lines = text.split(/\r?\n/);

  const parsed: Record<string, string> = {};
  for (const line of lines) {
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex);
    const value = line.slice(eqIndex + 1);
    parsed[key] = value;
  }

  if (!parsed['bookname']) {
    throw new Error('bookname not found in .ifo file');
  }

  const wordcountStr = parsed['wordcount'];
  const wordcount = parseInt(wordcountStr ?? '', 10);
  if (isNaN(wordcount)) {
    throw new Error('wordcount not found or invalid in .ifo file');
  }

  return {
    name: parsed['bookname'] ?? '',
    wordcount,
    sametypesequence: parsed['sametypesequence'],
  };
}

/**
 * Parse a StarDict dictionary from its component buffers.
 * Returns entries sorted by headword (StarDict .idx is pre-sorted).
 */
export function parseStarDict(buffers: {
  ifo: Uint8Array;
  idx: Uint8Array;
  dict: Uint8Array;
}): DictionaryEntry[] {
  let sametype: string | undefined;
  try {
    const ifoResult = parseIfo(buffers.ifo);
    sametype = ifoResult.sametypesequence?.charAt(0);
  } catch {
    // If ifo parsing fails (e.g., empty buffer), proceed without sametypesequence
    sametype = undefined;
  }

  const entries: DictionaryEntry[] = [];
  const idx = buffers.idx;
  const dict = buffers.dict;

  let offset = 0;

  while (offset < idx.length) {
    // Read null-terminated UTF-8 headword
    let termEnd = offset;
    while (termEnd < idx.length && idx[termEnd] !== 0) {
      termEnd++;
    }
    if (termEnd >= idx.length) break;

    const headwordBytes = idx.slice(offset, termEnd);
    const headword = new TextDecoder('utf-8', { fatal: true }).decode(headwordBytes);

    offset = termEnd + 1; // skip null terminator

    // Read 4-byte big-endian offset
    if (offset + 4 > idx.length) break;
    const entryOffset =
      ((idx[offset] ?? 0) << 24) |
      ((idx[offset + 1] ?? 0) << 16) |
      ((idx[offset + 2] ?? 0) << 8) |
      (idx[offset + 3] ?? 0);
    offset += 4;

    // Read 4-byte big-endian size
    if (offset + 4 > idx.length) break;
    const size =
      ((idx[offset] ?? 0) << 24) |
      ((idx[offset + 1] ?? 0) << 16) |
      ((idx[offset + 2] ?? 0) << 8) |
      (idx[offset + 3] ?? 0);
    offset += 4;

    // Slice dict buffer
    const definitionBytes = dict.slice(entryOffset, entryOffset + size);
    let definition = new TextDecoder('utf-8', { fatal: true }).decode(definitionBytes);

    // Process based on sametypesequence first char
    if (sametype === 'h') {
      // Strip HTML tags
      definition = definition.replace(/<[^>]+>/g, '');
    } else if (sametype === 't' || sametype === 'm') {
      // Plain text, no processing
    } else if (sametype !== undefined) {
      // Unrecognized type - throw
      throw new Error(`Unrecognized type '${sametype}' in sametypesequence`);
    }
    // If sametype is undefined (empty/missing ifo), do no processing

    entries.push({ headword, definition });
  }

  // StarDict .idx is pre-sorted, but ensure sorting for safety
  entries.sort((a, b) => a.headword.localeCompare(b.headword));

  return entries;
}

/**
 * Extract .ifo, .idx, and .dict files from a StarDict zip buffer.
 * Supports both .dict and .dict.dz (compressed dict) files.
 */
export async function extractFromZip(
  zipBuffer: Uint8Array,
): Promise<{ ifo: Uint8Array; idx: Uint8Array; dict: Uint8Array }> {
  const { unzip } = await import('fflate');

  return new Promise((resolve, reject) => {
    unzip(zipBuffer, (err, files) => {
      if (err) {
        reject(new Error(`Failed to unzip: ${err.message}`));
        return;
      }

      let ifoBuffer: Uint8Array | undefined;
      let idxBuffer: Uint8Array | undefined;
      let dictBuffer: Uint8Array | undefined;

      for (const [filename, file] of Object.entries(files)) {
        if (!file) continue;

        if (filename.endsWith('.ifo')) {
          ifoBuffer = file;
        } else if (filename.endsWith('.idx')) {
          idxBuffer = file;
        } else if (filename.endsWith('.dict.dz') || filename.endsWith('.dict')) {
          dictBuffer = file;
        }
      }

      if (!ifoBuffer) throw new Error('.ifo file not found in zip');
      if (!idxBuffer) throw new Error('.idx file not found in zip');
      if (!dictBuffer) throw new Error('.dict or .dict.dz file not found in zip');

      resolve({ ifo: ifoBuffer, idx: idxBuffer, dict: dictBuffer });
    });
  });
}
