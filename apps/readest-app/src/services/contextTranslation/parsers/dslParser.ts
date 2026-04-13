import type { DictionaryEntry } from '../types';

/**
 * Parse an ABBYY Lingvo DSL dictionary file.
 *
 * DSL format overview:
 * - UTF-16LE or UTF-8 text file
 * - Lines starting with a non-whitespace character are headwords
 * - Lines starting with whitespace (tab/space) are definition body
 * - DSL markup tags: [b], [i], [u], [c], [m], [*], [trn], [/trn], etc.
 * - Comment lines start with ## (or {{) at the top of the file
 *
 * We strip DSL markup tags and produce plain-text definitions.
 */
export function parseDSL(content: string): DictionaryEntry[] {
  const entries: DictionaryEntry[] = [];
  const lines = content.split(/\r?\n/);

  let currentHeadword = '';
  let currentDefinition: string[] = [];

  const flushEntry = () => {
    if (currentHeadword && currentDefinition.length > 0) {
      const definition = stripDSLMarkup(currentDefinition.join('\n')).trim();
      if (definition) {
        entries.push({ headword: currentHeadword, definition });
      }
    }
    currentHeadword = '';
    currentDefinition = [];
  };

  for (const line of lines) {
    // Skip file-level comments / metadata
    if (line.startsWith('#') || line.startsWith('{{')) continue;

    // Empty line — could be paragraph separator in definition or between entries
    if (line.trim() === '') {
      if (currentDefinition.length > 0) {
        currentDefinition.push('');
      }
      continue;
    }

    // Headword line: starts with non-whitespace
    if (line[0] !== '\t' && line[0] !== ' ') {
      flushEntry();
      // Headword may have alternates separated by {, but we take the primary form
      currentHeadword = line.replace(/\{.*$/, '').trim();
    } else {
      // Definition body line (starts with tab/space)
      currentDefinition.push(line.trimStart());
    }
  }

  flushEntry();

  return entries;
}

/**
 * Strip DSL markup tags, leaving plain text.
 */
function stripDSLMarkup(text: string): string {
  return (
    text
      // Remove tag pairs like [b]...[/b], [i]...[/i], [c]...[/c], etc.
      .replace(/\[(\/?)(?:b|i|u|c|sup|sub|ex|com|trn|!trs|\*|m\d?|s|url|ref|p)\b[^\]]*\]/g, '')
      // Remove media references [s]file.wav[/s]
      .replace(/\[s\][^\[]*\[\/s\]/g, '')
      // Remove remaining bracket tags that may not be covered above
      .replace(/\[[^\]]{1,20}\]/g, '')
      // Clean up excessive whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Detect if a buffer looks like a DSL file.
 * Checks for UTF-16LE BOM or common DSL header patterns.
 */
export function isDSLFile(buffer: Uint8Array): boolean {
  // UTF-16LE BOM: 0xFF 0xFE
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return true;

  // Try decoding first 200 bytes as UTF-8 and check for DSL header
  try {
    const header = new TextDecoder('utf-8').decode(buffer.slice(0, 200));
    if (header.startsWith('#NAME') || header.startsWith('#INDEX_LANGUAGE')) return true;
  } catch {
    // Not valid UTF-8
  }
  return false;
}

/**
 * Decode a DSL buffer to string, handling UTF-16LE and UTF-8.
 */
export function decodeDSLBuffer(buffer: Uint8Array): string {
  // UTF-16LE BOM
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer);
  }
  // UTF-8 BOM
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer.slice(3));
  }
  return new TextDecoder('utf-8').decode(buffer);
}
