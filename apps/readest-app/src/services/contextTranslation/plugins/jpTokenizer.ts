/**
 * Japanese morphological tokenizer backed by kuromoji.
 *
 * kuromoji provides deterministic, context-aware readings for Japanese text
 * including kanji. The tokenizer is initialized lazily (background XHR of
 * ~17 MB dictionary files from /vendor/kuromoji/) and, once ready, the
 * `tokenize()` call is purely synchronous.
 *
 * Consumers should call `initJapaneseTokenizer()` early (e.g. on first
 * Japanese book open) so the dictionary is warm by the time a user selects
 * text. If the tokenizer is not yet ready, callers can check
 * `isTokenizerReady()` and fall back to wanakana for kana-only text.
 */
import { toRomaji } from 'wanakana';
import type { Tokenizer } from 'kuromoji';

let tokenizer: Tokenizer | null = null;
let initPromise: Promise<Tokenizer> | null = null;

function getDicPath(): string {
  // Dict files are served from public/vendor/kuromoji/ by Next.js / Tauri.
  return '/vendor/kuromoji/';
}

/**
 * Start loading the kuromoji dictionary in the background.
 * Safe to call multiple times — only the first call triggers the load.
 * Returns a promise that resolves to the tokenizer instance.
 */
export function initJapaneseTokenizer(): Promise<Tokenizer> {
  if (initPromise) return initPromise;
  initPromise = new Promise<Tokenizer>((resolve, reject) => {
    // Dynamic import avoids pulling kuromoji into SSR bundles
    import('kuromoji').then((kuromoji) => {
      kuromoji
        .builder({ dicPath: getDicPath() })
        .build((err: Error | null, tok: Tokenizer) => {
          if (err) {
            console.error('[jpTokenizer] Failed to load dictionary:', err);
            initPromise = null; // allow retry
            reject(err);
          } else {
            tokenizer = tok;
            resolve(tok);
          }
        });
    }).catch((e) => {
      console.error('[jpTokenizer] Failed to import kuromoji:', e);
      initPromise = null;
      reject(e);
    });
  });
  return initPromise;
}

/** Returns true once the dictionary has been loaded and tokenize() is usable. */
export function isTokenizerReady(): boolean {
  return tokenizer !== null;
}

/**
 * Deterministic romaji for arbitrary Japanese text (including kanji).
 *
 * Each token's katakana `reading` is converted to romaji via wanakana.
 * Tokens without a reading (symbols, punctuation) pass through as-is.
 *
 * Returns empty string if the tokenizer is not yet ready.
 */
export function getReadingRomaji(text: string): string {
  if (!tokenizer) return '';
  const tokens = tokenizer.tokenize(text);
  return tokens
    .map((t) => {
      // `reading` is katakana (e.g. "タベル" for "食べる")
      if (t.reading) return toRomaji(t.reading);
      // Fall back to surface form for punctuation / symbols
      return t.surface_form;
    })
    .join('');
}

/**
 * Deconjugate Japanese text to its dictionary form using kuromoji's `basic_form`.
 *
 * For single-token conjugated verbs/adjectives (e.g. 食べた → 食べる, 美しかった → 美しい),
 * returns the dictionary form. For multi-token phrases or when the tokenizer is not ready,
 * returns the original text unchanged.
 */
export function getDictionaryForm(text: string): string {
  if (!tokenizer) return text;
  const tokens = tokenizer.tokenize(text);
  if (tokens.length === 0) return text;

  // For single-token selections, use the basic_form directly
  if (tokens.length === 1) {
    const t = tokens[0]!;
    return t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form;
  }

  // For multi-token: return basic_form of each content token joined together
  // This handles compound verbs like 食べていた → 食べている (approximately)
  return tokens
    .map((t) => (t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form))
    .join('');
}

/**
 * Expand a Japanese text selection to kuromoji token boundaries.
 *
 * Given a `text` (the broader context around the selection) and the `selected`
 * substring, tokenizes the full text and returns the minimal span of tokens
 * that covers the selection.
 *
 * Returns the original selection if the tokenizer is not ready.
 */
export function expandJapaneseSelection(text: string, selected: string): string {
  if (!tokenizer) return selected;
  const idx = text.indexOf(selected);
  if (idx === -1) return selected;

  const tokens = tokenizer.tokenize(text);
  let pos = 0;
  let start = -1;
  let end = -1;

  for (const t of tokens) {
    const tokenStart = pos;
    const tokenEnd = pos + t.surface_form.length;

    // Token overlaps with the selection range
    if (tokenEnd > idx && tokenStart < idx + selected.length) {
      if (start === -1) start = tokenStart;
      end = tokenEnd;
    }
    pos = tokenEnd;
  }

  if (start === -1 || end === -1) return selected;
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------
// Test helpers — allow tests to inject / reset a mock tokenizer
// ---------------------------------------------------------------------------
export function _setTokenizerForTest(mock: Tokenizer | null): void {
  tokenizer = mock;
}
