import { normalizeToFullLang, normalizeToShortLang } from '@/utils/lang';

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

const getAuthToken = async (): Promise<string> => {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  const response = await fetch('https://edge.microsoft.com/translate/auth');

  if (!response.ok) {
    throw new Error(`Failed to get auth token: ${response.status}`);
  }

  const token = await response.text();
  tokenCache = { token, expiresAt: now + 8 * 60 * 1000 };
  return token;
};

export const azureProvider = {
  name: 'azure',
  label: 'Azure Translator',

  async translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    if (!texts.length) return [];

    const token = await getAuthToken();

    const results: string[] = [];
    const translationPromises = texts.map(async (line, index) => {
      if (!line?.trim().length) {
        results[index] = line;
        return;
      }

      const msSourceLang = sourceLang ? normalizeToShortLang(sourceLang) : '';
      const msTargetLang = normalizeToFullLang(targetLang);

      const url = 'https://api-edge.cognitive.microsofttranslator.com/translate';
      const params = new URLSearchParams({
        to: msTargetLang,
        'api-version': '3.0',
      });
      if (msSourceLang && msSourceLang.toLowerCase() !== 'auto') {
        params.append('from', msSourceLang);
      }

      const response = await fetch(`${url}?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([{ Text: line }]),
      });

      if (!response.ok) {
        throw new Error(`Translation failed with status ${response.status}`);
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0 && data[0].translations) {
        results[index] = data[0].translations[0].text || line;
      } else {
        results[index] = line;
      }
    });

    await Promise.all(translationPromises);
    return results;
  },
};
