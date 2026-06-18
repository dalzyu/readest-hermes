export interface YandexTranslatorConfig {
  apiKey: string;
}

export class YandexTranslator {
  private config: YandexTranslatorConfig;

  constructor(config: YandexTranslatorConfig) {
    this.config = config;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    return text;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }
}
