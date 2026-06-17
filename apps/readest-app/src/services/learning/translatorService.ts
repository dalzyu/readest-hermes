export * from './translator/types';
export * from './translator/cache';
export * from './translator/polish';
export * from './translator/preprocess';
export * from './translator/providers';
export * from './translator/translateWithUpstream';
export { getDailyUsage, isTranslationAvailable, saveDailyUsage } from './translator/utils';

export const ErrorCodes = {
  DAILY_LIMIT_EXCEEDED: 'DAILY_LIMIT_EXCEEDED',
  TRANSLATION_FAILED: 'TRANSLATION_FAILED',
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const;
