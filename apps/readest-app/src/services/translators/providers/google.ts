export interface GoogleTranslatorConfig {
  apiKey: string;
  projectId?: string;
}

export class GoogleTranslator {
  private config: GoogleTranslatorConfig;

  constructor(config: GoogleTranslatorConfig) {
    this.config = config;
  }

  async translate(text: string, _from: string, _to: string): Promise<string> {
    return text;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }
}
