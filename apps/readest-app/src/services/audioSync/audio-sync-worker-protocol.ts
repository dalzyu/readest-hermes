export interface SectionProcessorRequest {
  type: 'process-section';
  payload: {
    sectionPath: string;
    content: string;
    mimeType: string;
    entries: Array<{
      id: string;
      cfiStart: string;
      cfiEnd: string;
      audioStartMs: number;
      audioEndMs: number;
      kind: 'word' | 'segment';
    }>;
  };
}

export interface SectionProcessorSuccess {
  type: 'success';
  payload: {
    sectionPath: string;
    content: string;
    fragmentIds: string[];
  };
}

export interface SectionProcessorError {
  type: 'error';
  payload: {
    sectionPath: string;
    message: string;
  };
}

export type SectionProcessorResponse = SectionProcessorSuccess | SectionProcessorError;
