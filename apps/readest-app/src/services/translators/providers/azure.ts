export interface AzureTranslatorConfig {
  apiKey: string;
  region?: string;
}

export class AzureTranslator {
  private config: AzureTranslatorConfig;

  constructor(config: AzureTranslatorConfig) {
    this.config = config;
  }

  async translate(text: string, _from: string, _to: string): Promise<string> {
    return text;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }
}
