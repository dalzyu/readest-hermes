import { yandexProvider } from './yandex';
import { azureProvider } from './azure';
import { googleProvider } from './google';

export { yandexProvider } from './yandex';
export { azureProvider } from './azure';
export { googleProvider } from './google';

export interface Translator {
  name: string;
  label: string;
  disabled?: boolean;
  authRequired?: boolean;
  quotaExceeded?: boolean;
  translate: (...args: unknown[]) => Promise<unknown>;
}

const providers: Translator[] = [
  googleProvider as Translator,
  yandexProvider as Translator,
  azureProvider as Translator,
];

export function getTranslators(): Translator[] {
  return [...providers];
}

export function getTranslator(name: string): Translator | undefined {
  return providers.find((p) => p.name === name);
}

export function isTranslatorAvailable(translator: Translator, hasToken?: boolean): boolean {
  if (translator.disabled) return false;
  if (translator.quotaExceeded) return false;
  if (translator.authRequired && !hasToken) return false;
  return true;
}

export function getTranslatorDisplayLabel(
  t: Translator,
  hasToken: boolean,
  translateFn?: (key: string) => string,
): string {
  if (t.disabled) {
    return `${t.label}`;
  }
  if (t.authRequired && !hasToken) {
    return translateFn ? `${t.label} (${translateFn('Login Required')})` : t.label;
  }
  if (t.quotaExceeded) {
    return translateFn ? `${t.label} (${translateFn('Quota Exceeded')})` : t.label;
  }
  return t.label;
}
