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

export type DictionaryFormat = 'stardict' | 'dsl' | 'mdict' | 'epwing' | 'unknown';

/**
 * Detect dictionary format from filename and/or file content.
 */
export function detectFormat(filename: string, buffer?: Uint8Array): DictionaryFormat {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.zip')) return 'stardict';
  if (lower.endsWith('.dsl') || lower.endsWith('.dsl.dz')) return 'dsl';
  if (lower.endsWith('.mdx')) return 'mdict';

  // EPWING typically has a CATALOGS file inside the directory
  if (lower === 'catalogs' || lower === 'catalog') return 'epwing';

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

    case 'mdict':
      throw new Error(
        'MDict (.mdx) format is not yet supported. Support for this format is planned for a future release.',
      );

    case 'epwing':
      throw new Error(
        'EPWING format is not yet supported. Support for this format is planned for a future release.',
      );

    default:
      throw new Error(`Unrecognized dictionary format for file: ${filename}`);
  }
}
