/**
 * Dictionary format detection and routing.
 *
 * Supported formats:
 * - StarDict (.zip containing .ifo/.idx/.dict) — fully supported
 * - DSL (.dsl or .dsl.dz) — fully supported
 * - MDict (.mdx) — planned, not yet implemented
 * - EPWING — planned, not yet implemented
 */
import type { DictionaryEntry } from '../types';
import { extractFromZip, parseStarDict } from '../dictionaryParser';
import { parseDSL, isDSLFile, decodeDSLBuffer } from './dslParser';

export const SUPPORTED_DICTIONARY_IMPORT_EXTENSIONS = [
  '.zip',
  '.dsl',
  '.dsl.dz',
  '.csv',
  '.tsv',
  '.txt',
  '.json',
  '.jsonl',
] as const;

export const SUPPORTED_DICTIONARY_IMPORT_FORMATS =
  'StarDict (.zip), DSL (.dsl/.dz), CSV (.csv), TSV (.tsv), plain text (.txt), JSON (.json/.jsonl)';

export type DictionaryFormat =
  | 'stardict'
  | 'dsl'
  | 'csv'
  | 'tsv'
  | 'txt'
  | 'json'
  | 'jsonl'
  | 'unknown';

function normalizeTextContent(content: string): string {
  return content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function inferDictionaryName(filename: string): string {
  return filename
    .replace(/\.dsl\.dz$/i, '')
    .replace(/\.(zip|dsl|csv|tsv|txt|jsonl?|mdx)$/i, '')
    .trim();
}

function isPrimitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function addDictionaryEntry(
  entries: DictionaryEntry[],
  seenHeadwords: Set<string>,
  headword: string,
  definition: string,
): void {
  const trimmedHeadword = headword.trim();
  const trimmedDefinition = definition.trim();
  if (!trimmedHeadword || !trimmedDefinition || seenHeadwords.has(trimmedHeadword)) return;
  seenHeadwords.add(trimmedHeadword);
  entries.push({ headword: trimmedHeadword, definition: trimmedDefinition });
}

function pickStringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function collectJsonDictionaryEntries(
  value: unknown,
  entries: DictionaryEntry[],
  seenHeadwords: Set<string>,
): void {
  if (Array.isArray(value)) {
    if (value.length >= 2 && isPrimitiveValue(value[0]) && isPrimitiveValue(value[1])) {
      addDictionaryEntry(entries, seenHeadwords, String(value[0]), String(value[1]));
      return;
    }

    for (const item of value) {
      collectJsonDictionaryEntries(item, entries, seenHeadwords);
    }
    return;
  }

  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const headword = pickStringValue(record, ['headword', 'term', 'word', 'entry', 'lemma', 'head']);
  const definition = pickStringValue(record, [
    'definition',
    'meaning',
    'gloss',
    'explanation',
    'def',
  ]);

  if (headword && definition) {
    addDictionaryEntry(entries, seenHeadwords, headword, definition);
    return;
  }

  for (const nestedKey of ['entries', 'items', 'words', 'dictionary', 'data']) {
    if (record[nestedKey] !== undefined) {
      collectJsonDictionaryEntries(record[nestedKey], entries, seenHeadwords);
      return;
    }
  }

  const primitiveEntries = Object.entries(record).filter(([, value]) => isPrimitiveValue(value));
  if (primitiveEntries.length > 0 && primitiveEntries.length === Object.keys(record).length) {
    for (const [headwordKey, definitionValue] of primitiveEntries) {
      addDictionaryEntry(entries, seenHeadwords, headwordKey, String(definitionValue));
    }
    return;
  }

  for (const nestedValue of Object.values(record)) {
    collectJsonDictionaryEntries(nestedValue, entries, seenHeadwords);
  }
}

function parseJsonDictionary(content: string, filename: string): DictionaryEntry[] {
  const parsed: unknown = JSON.parse(normalizeTextContent(content).trim());
  const entries: DictionaryEntry[] = [];
  const seenHeadwords = new Set<string>();

  collectJsonDictionaryEntries(parsed, entries, seenHeadwords);

  if (entries.length === 0) {
    throw new Error(
      `No usable dictionary entries found in ${filename}. Expected JSON objects, arrays of [headword, definition], or key/value maps.`,
    );
  }

  return entries;
}

function parseJsonLinesDictionary(content: string, filename: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const seenHeadwords = new Set<string>();
  const lines = normalizeTextContent(content).split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      collectJsonDictionaryEntries(JSON.parse(trimmed), entries, seenHeadwords);
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : 'invalid JSON';
      throw new Error(`Invalid JSON on line ${index + 1} in ${filename}: ${reason}`);
    }
  });

  if (entries.length === 0) {
    throw new Error(
      `No usable dictionary entries found in ${filename}. Expected one JSON object per line.`,
    );
  }

  return entries;
}

function parseDelimitedRows(content: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  const normalized = normalizeTextContent(content);

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;

    if (inQuotes) {
      if (char === '"') {
        const nextChar = normalized[index + 1];
        if (nextChar === '"') {
          currentCell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (char === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);

  return rows;
}

function looksLikeTabularHeader(row: string[]): boolean {
  if (row.length < 2) return false;
  const first = row[0]?.trim().toLowerCase() ?? '';
  const second = row[1]?.trim().toLowerCase() ?? '';
  return (
    ['headword', 'term', 'word', 'entry', 'lemma'].includes(first) &&
    ['definition', 'meaning', 'gloss', 'translation', 'sense'].includes(second)
  );
}

function parseTabularDictionary(
  content: string,
  filename: string,
  delimiter: ',' | '\t',
): DictionaryEntry[] {
  const rows = parseDelimitedRows(content, delimiter);
  const entries: DictionaryEntry[] = [];
  const seenHeadwords = new Set<string>();

  rows.forEach((row, index) => {
    const cleaned = row.map((cell) => cell.trim());
    if (cleaned.every((cell) => !cell)) return;
    if (index === 0 && looksLikeTabularHeader(cleaned)) return;
    if (cleaned.length < 2) return;

    const headword = cleaned[0] ?? '';
    const definition = cleaned.slice(1).join(' ').trim();
    addDictionaryEntry(entries, seenHeadwords, headword, definition);
  });

  if (entries.length === 0) {
    throw new Error(
      `No usable dictionary entries found in ${filename}. Expected rows with a headword and definition separated by ${delimiter === '\t' ? 'tabs' : 'commas'}.`,
    );
  }

  return entries;
}

function parsePlainTextDictionary(content: string, filename: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const seenHeadwords = new Set<string>();
  const separators = ['\t', ' => ', ' :: ', ' | ', ' - ', ':', ','] as const;

  for (const rawLine of normalizeTextContent(content).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;

    for (const separator of separators) {
      const separatorIndex = line.indexOf(separator);
      if (separatorIndex <= 0) continue;

      const headword = line.slice(0, separatorIndex).trim();
      const definition = line.slice(separatorIndex + separator.length).trim();
      if (!headword || !definition) continue;

      addDictionaryEntry(entries, seenHeadwords, headword, definition);
      break;
    }
  }

  if (entries.length === 0) {
    throw new Error(
      `No usable dictionary entries found in ${filename}. Expected lines like "headword<TAB>definition" or "headword - definition".`,
    );
  }

  return entries;
}

/**
 * Detect dictionary format from filename and/or file content.
 */
export function detectFormat(filename: string, buffer?: Uint8Array): DictionaryFormat {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.zip')) return 'stardict';
  if (lower.endsWith('.dsl') || lower.endsWith('.dsl.dz')) return 'dsl';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.jsonl')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json';

  // Try content-based detection
  if (buffer && isDSLFile(buffer)) return 'dsl';

  return 'unknown';
}

/**
 * Parse a dictionary file into entries based on its detected format.
 */
export async function parseDictionary(
  filename: string,
  buffer: Uint8Array,
): Promise<{ entries: DictionaryEntry[]; name: string }> {
  const format = detectFormat(filename, buffer);
  const content = new TextDecoder('utf-8').decode(buffer);

  switch (format) {
    case 'stardict': {
      const { ifo, idx, dict } = await extractFromZip(buffer);
      const { parseIfo } = await import('../dictionaryParser');
      const ifoData = parseIfo(ifo);
      const entries = parseStarDict({ ifo, idx, dict });
      return { entries, name: ifoData.name };
    }

    case 'dsl': {
      // Handle .dsl.dz (gzip-compressed DSL)
      let content: string;
      if (filename.toLowerCase().endsWith('.dz')) {
        const { gunzip } = await import('fflate');
        const decompressed = await new Promise<Uint8Array>((resolve, reject) => {
          gunzip(buffer, (err, data) => {
            if (err) reject(new Error(`Failed to decompress .dsl.dz: ${err.message}`));
            else resolve(data);
          });
        });
        content = decodeDSLBuffer(decompressed);
      } else {
        content = decodeDSLBuffer(buffer);
      }
      const entries = parseDSL(content);
      // Try to extract name from DSL header
      const nameMatch = content.match(/^#NAME\s+"?(.+?)"?\s*$/m);
      const name = nameMatch?.[1] ?? filename.replace(/\.(dsl|dsl\.dz)$/i, '');
      return { entries, name };
    }

    case 'csv':
      return {
        entries: parseTabularDictionary(content, filename, ','),
        name: inferDictionaryName(filename),
      };

    case 'tsv':
      return {
        entries: parseTabularDictionary(content, filename, '\t'),
        name: inferDictionaryName(filename),
      };

    case 'txt':
      return {
        entries: parsePlainTextDictionary(content, filename),
        name: inferDictionaryName(filename),
      };

    case 'json':
      return {
        entries: parseJsonDictionary(content, filename),
        name: inferDictionaryName(filename),
      };

    case 'jsonl':
      return {
        entries: parseJsonLinesDictionary(content, filename),
        name: inferDictionaryName(filename),
      };

    default:
      throw new Error(
        `Unsupported dictionary format for file: ${filename}. Supported formats: ${SUPPORTED_DICTIONARY_IMPORT_FORMATS}`,
      );
  }
}
