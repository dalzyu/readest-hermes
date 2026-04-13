declare module 'kuromoji' {
  export interface IpadicToken {
    /** The original surface form of the token */
    surface_form: string;
    /** Part of speech */
    pos: string;
    pos_detail_1: string;
    pos_detail_2: string;
    pos_detail_3: string;
    conjugated_type: string;
    conjugated_form: string;
    /** Dictionary/base form */
    basic_form: string;
    /** Reading in katakana (e.g. "タベル" for "食べる") */
    reading?: string;
    /** Pronunciation in katakana */
    pronunciation?: string;
    word_id: number;
    word_type: string;
    word_position: number;
  }

  export interface Tokenizer {
    tokenize(text: string): IpadicToken[];
  }

  export interface TokenizerBuilder {
    build(callback: (err: Error | null, tokenizer: Tokenizer) => void): void;
  }

  export function builder(option: { dicPath: string }): TokenizerBuilder;
}
