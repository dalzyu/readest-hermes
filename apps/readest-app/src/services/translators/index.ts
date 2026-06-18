export interface Translator {
  id: string;
  name: string;
  languages: string[];
}

export function getTranslators(): Translator[] {
  return [];
}

export function isTranslatorAvailable(_id: string): boolean {
  return false;
}
