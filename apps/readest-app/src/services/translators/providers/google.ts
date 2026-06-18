export interface GoogleTranslatorConfig {
  apiKey: string;
  projectId?: string;
}

export class GoogleTranslator {
  private config: GoogleTranslatorConfig;

  constructor(config: GoogleTranslatorConfig) {
    this.config = config;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    return text;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }
}
