import { describe, expect, test } from 'vitest';
import {
  HAN_REGEX,
  isChineseText,
  getPinyinParts,
  findExampleMatchRanges,
  getRetrievalStatusMeta,
  buildRetrievalInfoText,
  buildAskAboutThisMessage,
} from '@/app/reader/components/annotator/LookupPopupUtils';
import type { PopupContextBundle } from '@/services/contextTranslation/types';

describe('LookupPopupUtils', () => {
  describe('HAN_REGEX', () => {
    test('matches Chinese characters', () => {
      expect(HAN_REGEX.test('知')).toBe(true);
      expect(HAN_REGEX.test('知己')).toBe(true);
      expect(HAN_REGEX.test('hello')).toBe(false);
    });
  });

  describe('isChineseText', () => {
    test('returns true for Chinese text', () => {
      expect(isChineseText('知己')).toBe(true);
      expect(isChineseText('hello')).toBe(false);
      expect(isChineseText('hello世界')).toBe(true);
    });
  });

  describe('getPinyinParts', () => {
    test('returns array of pinyin for Chinese text', () => {
      const parts = getPinyinParts('知己');
      expect(parts).toContain('zhī');
      expect(parts).toContain('jǐ');
    });
  });

  describe('findExampleMatchRanges', () => {
    test('finds exact highlight ranges', () => {
      const ranges = findExampleMatchRanges('人生难得一知己。', '知己');
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toMatchObject({ start: 5, end: 7, kind: 'exact' });
    });

    test('returns empty array when no match', () => {
      const ranges = findExampleMatchRanges('人生难得一知己。', '不存在');
      expect(ranges).toHaveLength(0);
    });
  });

  describe('getRetrievalStatusMeta', () => {
    test('returns cross-volume metadata', () => {
      const meta = getRetrievalStatusMeta('cross-volume');
      expect(meta.label).toBe('Cross-volume context');
      expect(meta.className).toContain('green');
    });

    test('returns local-only metadata', () => {
      const meta = getRetrievalStatusMeta('local-only');
      expect(meta.label).toBe('Local context only');
      expect(meta.className).toContain('red');
    });
  });

  describe('buildRetrievalInfoText', () => {
    test('returns guidance when local index is missing', () => {
      const hints = {
        currentVolumeIndexed: false,
        missingLocalIndex: true,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      };
      const text = buildRetrievalInfoText('local-only', hints);
      expect(text).toContain('Index this volume');
    });

    test('returns configuration guidance when embeddings are unavailable', () => {
      const hints = {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
        embeddingUnavailable: true,
      };
      const text = buildRetrievalInfoText('local-only', hints);
      expect(text).toContain('Configure an embedding model');
    });

    test('returns fuller context message when retrieval is active', () => {
      const hints = {
        currentVolumeIndexed: true,
        missingLocalIndex: false,
        missingPriorVolumes: [],
        missingSeriesAssignment: false,
      };
      const text = buildRetrievalInfoText('cross-volume', hints);
      expect(text).toContain('local context');
    });
  });

  describe('buildAskAboutThisMessage', () => {
    test('includes selection, result fields, and context', () => {
      const result = {
        simpleDefinition: 'a trusted companion',
        contextualMeaning: 'someone you can count on',
      };
      const popupContext: PopupContextBundle = {
        localPastContext: 'past context',
        localFutureBuffer: '',
        sameBookChunks: [],
        priorVolumeChunks: [],
        dictionaryEntries: [],
        retrievalStatus: 'local-only',
        retrievalHints: {
          currentVolumeIndexed: false,
          missingLocalIndex: true,
          missingPriorVolumes: [],
          missingSeriesAssignment: false,
        },
      };
      const message = buildAskAboutThisMessage('知己', result, popupContext);
      expect(message).toContain('Selection:\n知己');
      expect(message).toContain('simpleDefinition:');
      expect(message).toContain('a trusted companion');
      expect(message).toContain('Local Past Context:\npast context');
      expect(message).toContain('Help me understand');
    });
  });
});
