import { describe, expect, it } from 'vitest';
import { renderNoteTemplate } from '@/utils/note';
import { DEFAULT_NOTE_EXPORT_TEMPLATE, NOTE_EXPORT_PRESETS } from '@/utils/noteExportTemplates';

const sampleData = {
  title: 'Book Title',
  author: 'Author Name',
  exportDate: '2026-04-11',
  chapters: [
    {
      title: 'Chapter 1',
      annotations: [
        {
          text: 'Important highlight',
          note: 'Remember this',
          page: 12,
          timestamp: 1712831400000,
        },
      ],
    },
  ],
};

describe('note export presets', () => {
  it('exposes bundled preset templates', () => {
    expect(NOTE_EXPORT_PRESETS).toHaveLength(3);
    expect(NOTE_EXPORT_PRESETS.map((preset) => preset.id)).toEqual([
      'obsidian',
      'notion',
      'study-notes',
    ]);
    expect(DEFAULT_NOTE_EXPORT_TEMPLATE).toBe(NOTE_EXPORT_PRESETS[0]?.template);
  });

  it('renders the Obsidian preset with chapter headings and metadata', () => {
    const output = renderNoteTemplate(NOTE_EXPORT_PRESETS[0]!.template, sampleData);

    expect(output).toContain('## Book Title');
    expect(output).toContain('**Author**: Author Name');
    expect(output).toContain('#### Chapter 1');
    expect(output).toContain('Important highlight');
  });

  it('renders the Notion preset as nested bullet lists', () => {
    const output = renderNoteTemplate(NOTE_EXPORT_PRESETS[1]!.template, sampleData);

    expect(output).toContain('# Book Title');
    expect(output).toContain('## Chapter 1');
    expect(output).toContain('- Important highlight');
    expect(output).toContain('Page: 12');
  });

  it('renders the study notes preset with memory hooks', () => {
    const output = renderNoteTemplate(NOTE_EXPORT_PRESETS[2]!.template, sampleData);

    expect(output).toContain('# Book Title');
    expect(output).toContain('Memory hook: Remember this');
    expect(output).toContain('Reviewed:');
  });
});
