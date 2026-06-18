import { normalizeToShortLang } from '@/utils/lang';

export const yandexProvider = {
  name: 'yandex',
  label: 'Yandex Translate',
  authRequired: false,
  disabled: true,

  async translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    if (!texts.length) return [];

    const service = 'yandexgpt';
    const source_lang =
      sourceLang === 'AUTO' ? 'en' : normalizeToShortLang(sourceLang).toLowerCase();
    const target_lang = normalizeToShortLang(targetLang).toLowerCase();
    const lang = `${source_lang}-${target_lang}`;

    const responses = await Promise.all(
      texts.map(async (text) => {
        const response = await fetch('https://translate.toil.cc/v2/translate/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lang, service, text }),
        });

        if (!response.ok) {
          throw new Error(`${service} failed with status ${response.status}`);
        }

        const data = await response.json();
        if (data && Array.isArray(data.translations)) {
          return data.translations;
        }
        return [text];
      }),
    );

    return responses.flat();
  },
};
