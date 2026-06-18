export interface Translator {
  id: string;
  name: string;
  languages: string[];
  disabled?: boolean;
}

export function getTranslators(): Translator[] {
  return [];
}

export function isTranslatorAvailable(
  _translator: Translator | string,
  _hasToken?: boolean,
): boolean {
  return false;
}

export function getTranslatorDisplayLabel(
  t: Translator,
  _hasToken: boolean,
  _t?: (key: string) => string,
): string {
  return t.name;
}
