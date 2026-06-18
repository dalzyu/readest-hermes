export interface AzureTranslatorConfig {
  apiKey: string;
  region?: string;
}

export class AzureTranslator {
  private config: AzureTranslatorConfig;

  constructor(config: AzureTranslatorConfig) {
    this.config = config;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    return text;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }
}
