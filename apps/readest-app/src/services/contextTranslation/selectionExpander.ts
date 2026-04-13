import { isCJKStr } from '@/utils/lang';
import { isTokenizerReady, expandJapaneseSelection } from './plugins/jpTokenizer';
import { isJapaneseText } from './utils';

/**
 * Expand a text selection to word boundaries, using language-appropriate
 * strategies:
 *
 * - **Japanese**: kuromoji token boundaries (if tokenizer is loaded)
 * - **Latin/Cyrillic/etc**: whitespace + punctuation boundaries
 * - **Other CJK (Chinese/Korean)**: no expansion (character-level selection
 *   is normal for these languages)
 *
 * @param selected  The raw user selection
 * @param context   Surrounding text (page context) used for boundary detection
 * @returns         The expanded selection string
 */
export function expandToWordBoundary(selected: string, context: string): string {
  if (!selected) return selected;

  // Japanese: use kuromoji token boundaries
  if ((isJapaneseText(selected) || isJapaneseText(context)) && isTokenizerReady()) {
    return expandJapaneseSelection(context || selected, selected);
  }

  // Other CJK: character-level selection is standard, no expansion
  if (isCJKStr(selected)) {
    return selected;
  }

  // Latin/Cyrillic/etc: expand to whitespace/punctuation boundaries
  return expandLatinSelection(context || selected, selected);
}

/**
 * For Latin-script text, expand the selection to include complete words
 * on both ends. E.g. "ello worl" within "Hello world!" → "Hello world"
 */
function expandLatinSelection(context: string, selected: string): string {
  const idx = context.indexOf(selected);
  if (idx === -1) return selected;

  // Expand left to word boundary
  let start = idx;
  while (start > 0 && /\w/.test(context[start - 1]!)) {
    start--;
  }

  // Expand right to word boundary
  let end = idx + selected.length;
  while (end < context.length && /\w/.test(context[end]!)) {
    end++;
  }

  return context.slice(start, end);
}
