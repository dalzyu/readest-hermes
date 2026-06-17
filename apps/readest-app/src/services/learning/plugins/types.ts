import type { LookupAnnotations, LookupExample } from '../types';

export interface LookupPlugin {
  /** The normalized language this plugin handles (e.g. 'zh', 'en', 'fallback') */
  language: string;
  /** Enriches the result with source-language annotations */
  enrichSourceAnnotations?: (
    fields: Record<string, string>,
    selectedText: string,
  ) => LookupAnnotations | undefined;
  /** Enriches the result with target-language annotations */
  enrichTargetAnnotations?: (
    fields: Record<string, string>,
    selectedText: string,
  ) => LookupAnnotations | undefined;
  enrichExampleAnnotations?: (
    examples: LookupExample[],
    slot: 'source' | 'target',
  ) => LookupAnnotations['examples'] | undefined;
}
