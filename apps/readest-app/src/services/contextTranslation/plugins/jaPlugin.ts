import type { LookupAnnotations, LookupExample } from '../types';
import type { LookupPlugin } from './types';

/**
 * Converts katakana/hiragana text to romaji using a simple syllable-based mapping.
 * Handles basic hiragana (あ→a, か→ka, etc.) and katakana.
 * Falls back to returning nothing for kanji or unknown characters.
 */
function toRomaji(text: string): string {
  // Basic hiragana → romaji mapping (gojuon)
  const hiraganaMap: Record<string, string> = {
    あ: 'a',
    い: 'i',
    う: 'u',
    え: 'e',
    お: 'o',
    か: 'ka',
    き: 'ki',
    く: 'ku',
    け: 'ke',
    こ: 'ko',
    さ: 'sa',
    し: 'shi',
    す: 'su',
    せ: 'se',
    そ: 'so',
    た: 'ta',
    ち: 'chi',
    つ: 'tsu',
    て: 'te',
    と: 'to',
    な: 'na',
    に: 'ni',
    ぬ: 'nu',
    ね: 'ne',
    の: 'no',
    は: 'ha',
    ひ: 'hi',
    ふ: 'fu',
    へ: 'he',
    ほ: 'ho',
    ま: 'ma',
    み: 'mi',
    む: 'mu',
    め: 'me',
    も: 'mo',
    や: 'ya',
    ゆ: 'yu',
    よ: 'yo',
    ら: 'ra',
    り: 'ri',
    る: 'ru',
    れ: 're',
    ろ: 'ro',
    わ: 'wa',
    を: 'wo',
    ん: 'n',
    が: 'ga',
    ぎ: 'gi',
    ぐ: 'gu',
    げ: 'ge',
    ご: 'go',
    ざ: 'za',
    じ: 'ji',
    ず: 'zu',
    ぜ: 'ze',
    ぞ: 'zo',
    だ: 'da',
    ぢ: 'di',
    づ: 'du',
    で: 'de',
    ど: 'do',
    ば: 'ba',
    び: 'bi',
    ぶ: 'bu',
    べ: 'be',
    ぼ: 'bo',
    ぱ: 'pa',
    ぴ: 'pi',
    ぷ: 'pu',
    ぺ: 'pe',
    ぽ: 'po',
    きゃ: 'kya',
    きゅ: 'kyu',
    きょ: 'kyo',
    しゃ: 'sha',
    しゅ: 'shu',
    しょ: 'sho',
    ちゃ: 'cha',
    ちゅ: 'chu',
    ちょ: 'cho',
    にゃ: 'nya',
    にゅ: 'nyu',
    にょ: 'nyo',
    ひゃ: 'hya',
    ひゅ: 'hyu',
    ひょ: 'hyo',
    みゃ: 'mya',
    みゅ: 'myu',
    みょ: 'myo',
    りゃ: 'rya',
    りゅ: 'ryu',
    りょ: 'ryo',
    ぎゃ: 'gya',
    ぎゅ: 'gyu',
    ぎょ: 'gyo',
    じゃ: 'ja',
    じゅ: 'ju',
    じょ: 'jo',
    びゃ: 'bya',
    びゅ: 'byu',
    びょ: 'byo',
    ぴゃ: 'pya',
    ぴゅ: 'pyu',
    ぴょ: 'pyo',
  };

  // Basic katakana → romaji mapping
  const katakanaMap: Record<string, string> = {
    ア: 'a',
    イ: 'i',
    ウ: 'u',
    エ: 'e',
    オ: 'o',
    カ: 'ka',
    キ: 'ki',
    ク: 'ku',
    ケ: 'ke',
    コ: 'ko',
    サ: 'sa',
    シ: 'shi',
    ス: 'su',
    セ: 'se',
    ソ: 'so',
    タ: 'ta',
    チ: 'chi',
    ツ: 'tsu',
    テ: 'te',
    ト: 'to',
    ナ: 'na',
    ニ: 'ni',
    ヌ: 'nu',
    ネ: 'ne',
    ノ: 'no',
    ハ: 'ha',
    ヒ: 'hi',
    フ: 'fu',
    ヘ: 'he',
    ホ: 'ho',
    マ: 'ma',
    ミ: 'mi',
    ム: 'mu',
    メ: 'me',
    モ: 'mo',
    ヤ: 'ya',
    ユ: 'yu',
    ヨ: 'yo',
    ラ: 'ra',
    リ: 'ri',
    ル: 'ru',
    レ: 're',
    ロ: 'ro',
    ワ: 'wa',
    ヲ: 'wo',
    ン: 'n',
    ガ: 'ga',
    ギ: 'gi',
    グ: 'gu',
    ゲ: 'ge',
    ゴ: 'go',
    ザ: 'za',
    ジ: 'ji',
    ズ: 'zu',
    ゼ: 'ze',
    ゾ: 'zo',
    ダ: 'da',
    ヂ: 'di',
    ヅ: 'du',
    デ: 'de',
    ド: 'do',
    バ: 'ba',
    ビ: 'bi',
    ブ: 'bu',
    ベ: 'be',
    ボ: 'bo',
    パ: 'pa',
    ピ: 'pi',
    プ: 'pu',
    ペ: 'pe',
    ポ: 'po',
    キャ: 'kya',
    キュ: 'kyu',
    キョ: 'kyo',
    シャ: 'sha',
    シュ: 'shu',
    ショ: 'sho',
    チャ: 'cha',
    チュ: 'chu',
    チョ: 'cho',
    ニャ: 'nya',
    ニュ: 'nyu',
    ニョ: 'nyo',
    ヒャ: 'hya',
    ヒュ: 'hyu',
    ヒョ: 'hyo',
    ミャ: 'mya',
    ミュ: 'myu',
    ミョ: 'myo',
    リャ: 'rya',
    リュ: 'ryu',
    リョ: 'ryo',
    ギャ: 'gya',
    ギュ: 'gyu',
    ギョ: 'gyo',
    ジャ: 'ja',
    ジュ: 'ju',
    ジョ: 'jo',
    ビャ: 'bya',
    ビュ: 'byu',
    ビョ: 'byo',
    ピャ: 'pya',
    ピュ: 'pyu',
    ピョ: 'pyo',
  };

  // Simple character-by-character conversion with small-kana support
  const smallKana: Record<string, string> = {
    っ: '',
    ゃ: 'ya',
    ゅ: 'yu',
    ょ: 'yo',
    ぁ: 'a',
    ぃ: 'i',
    ぅ: 'u',
    ぇ: 'e',
    ぉ: 'o',
    ュ: 'yu',
    ョ: 'yo',
    ァ: 'a',
    ィ: 'i',
    ゥ: 'u',
    ェ: 'e',
    ォ: 'o',
  };

  let result = '';
  let i = 0;
  const chars = Array.from(text);

  while (i < chars.length) {
    const char = chars[i]!;
    let converted = false;

    // Try 3-char match (e.g. きゃ)
    if (i + 2 < chars.length) {
      const triple = char + chars[i + 1]! + chars[i + 2]!;
      if (hiraganaMap[triple]) {
        result += hiraganaMap[triple];
        i += 3;
        converted = true;
      } else if (katakanaMap[triple]) {
        result += katakanaMap[triple];
        i += 3;
        converted = true;
      }
    }

    if (converted) continue;

    // Try 2-char match (e.g. きゅ, キャ)
    if (i + 1 < chars.length) {
      const double = char + chars[i + 1]!;
      if (hiraganaMap[double]) {
        result += hiraganaMap[double];
        i += 2;
        converted = true;
      } else if (katakanaMap[double]) {
        result += katakanaMap[double];
        i += 2;
        converted = true;
      } else if (smallKana[chars[i + 1]!]) {
        // Small kana following a regular kana: merge (e.g. かっ → ka + tsu → katsu)
        const base = hiraganaMap[char] ?? katakanaMap[char] ?? char;
        result += base;
        i += 2;
        converted = true;
      }
    }

    if (converted) continue;

    // Single char
    if (hiraganaMap[char]) {
      result += hiraganaMap[char];
    } else if (katakanaMap[char]) {
      result += katakanaMap[char];
    } else if (smallKana[char]) {
      // Geminate or small vowel — skip (handled by preceding char)
    } else {
      result += char;
    }
    i++;
  }

  return result
    .replace(/([aiueo])\1+/g, '$1') // collapse double vowels
    .replace(/([kstnhmyrw])+/g, '$1'); // collapse double consonants (approximate)
}

function getRomaji(text: string): string {
  return toRomaji(text);
}

function buildExampleAnnotations(
  examples: LookupExample[],
  slot: 'source' | 'target',
): LookupAnnotations['examples'] | undefined {
  const key = slot === 'source' ? 'sourceText' : 'targetText';
  const annotations = Object.fromEntries(
    examples
      .map((example) => {
        const romaji = getRomaji(example[key]);
        return romaji && romaji !== example[key] ? [example.exampleId, { phonetic: romaji }] : null;
      })
      .filter((entry): entry is [string, { phonetic: string }] => entry !== null),
  );

  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

export const jaPlugin: LookupPlugin = {
  language: 'ja',
  enrichSourceAnnotations(
    _fields: Record<string, string>,
    selectedText: string,
  ): LookupAnnotations | undefined {
    const romaji = getRomaji(selectedText);
    if (!romaji || romaji === selectedText) return undefined;
    return { phonetic: romaji };
  },
  enrichExampleAnnotations(examples, slot) {
    return buildExampleAnnotations(examples, slot);
  },
};
