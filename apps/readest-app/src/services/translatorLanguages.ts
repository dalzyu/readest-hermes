import { TRANSLATOR_LANGS } from './constants';

export interface TranslatorLanguageOption {
  value: string;
  label: string;
}

export function getTranslatorLanguageLabel(code: string): string {
  return TRANSLATOR_LANGS[code] ?? code;
}

export function getTranslatorLanguageOptions({
  includeSystemLanguage = false,
  translate = (value: string) => value,
}: {
  includeSystemLanguage?: boolean;
  translate?: (value: string) => string;
} = {}): TranslatorLanguageOption[] {
  const options = Object.entries(TRANSLATOR_LANGS)
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));

  if (includeSystemLanguage) {
    options.unshift({ value: '', label: translate('System Language') });
  }

  return options;
}
