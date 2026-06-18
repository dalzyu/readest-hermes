export interface YandexTranslatorConfig {
  apiKey: string;
}

export class YandexTranslator {
  private config: YandexTranslatorConfig;

  constructor(config: YandexTranslatorConfig) {
    this.config = config;
  }

  async translate(text: string, _from: string, _to: string): Promise<string> {
    return text;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }
}
