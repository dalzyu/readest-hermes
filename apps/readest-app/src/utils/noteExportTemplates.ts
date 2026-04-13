export type NoteExportPresetId = 'obsidian' | 'notion' | 'study-notes';

export type NoteExportPreset = {
  id: NoteExportPresetId;
  template: string;
};

const OBSIDIAN_TEMPLATE = `## {{ title }}
**Author**: {{ author }}

**Exported from Hermes**: {{ exportDate | date('%Y-%m-%d') }}

---

### Highlights & Annotations
{% for chapter in chapters %}
#### {{ chapter.title }}
{% for annotation in chapter.annotations %}
{% if annotation.color == 'yellow' %}- {{ annotation.text }}
{% elif annotation.color == 'red' %}- ❗ {{ annotation.text }}
{% elif annotation.color == 'green' %}- ✅ {{ annotation.text }}
{% elif annotation.color == 'blue' %}- 💡 {{ annotation.text }}
{% elif annotation.color == 'violet' %}- ✨ {{ annotation.text }}
{% else %}- {{ annotation.text }}
{% endif %}
{% if annotation.note %}
**Note:** {{ annotation.note }}
{% endif %}
*Page: {{ annotation.page }} · Time: {{ annotation.timestamp | date('%Y-%m-%d %H:%M') }}*
{% endfor %}

---
{% endfor %}`;

const NOTION_TEMPLATE = `# {{ title }}

**Author**: {{ author }}

**Exported from Hermes**: {{ exportDate | date('%Y-%m-%d') }}

{% for chapter in chapters %}
## {{ chapter.title }}
{% for annotation in chapter.annotations %}
- {{ annotation.text }}
{% if annotation.note %}
  - Note: {{ annotation.note }}
{% endif %}
  - Page: {{ annotation.page }}
  - Time: {{ annotation.timestamp | date('%Y-%m-%d %H:%M') }}
{% endfor %}

{% endfor %}`;

const STUDY_NOTES_TEMPLATE = `# {{ title }}

**Author**: {{ author }}

**Exported from Hermes**: {{ exportDate | date('%Y-%m-%d') }}

{% for chapter in chapters %}
## {{ chapter.title }}
{% for annotation in chapter.annotations %}
- {{ annotation.text }}
{% if annotation.note %}
  - Memory hook: {{ annotation.note }}
{% endif %}
  - Page: {{ annotation.page }}
{% if annotation.timestamp %}
  - Reviewed: {{ annotation.timestamp | date('%Y-%m-%d %H:%M') }}
{% endif %}
{% endfor %}

{% endfor %}`;

export const NOTE_EXPORT_PRESETS: NoteExportPreset[] = [
  { id: 'obsidian', template: OBSIDIAN_TEMPLATE },
  { id: 'notion', template: NOTION_TEMPLATE },
  { id: 'study-notes', template: STUDY_NOTES_TEMPLATE },
];

export const DEFAULT_NOTE_EXPORT_TEMPLATE = OBSIDIAN_TEMPLATE;
