import React from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { normalizeLookupSettings } from '@/services/learning/settings';

const LookupTab: React.FC = () => {
  const { settings, setSettings } = useSettingsStore();
  const lookup = normalizeLookupSettings(settings.globalReadSettings?.lookup);
  const update = (patch: Partial<typeof lookup>) => {
    setSettings({
      ...settings,
      globalReadSettings: {
        ...settings.globalReadSettings,
        lookup: { ...lookup, ...patch },
      },
    });
  };
  return (
    <section className='space-y-3'>
      <h3 className='font-semibold'>Lookup</h3>
      <label className='flex items-center justify-between gap-3'>
        <span>Enable contextual lookup</span>
        <input
          type='checkbox'
          className='toggle'
          checked={lookup.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
      </label>
      <label className='form-control'>
        <span className='label-text'>Target language</span>
        <input
          className='input input-bordered'
          value={lookup.targetLanguage}
          onChange={(event) => update({ targetLanguage: event.target.value })}
        />
      </label>
      {(
        [
          'aiPreferred',
          'showExamples',
          'showGrammarHints',
          'showFrequencyBadges',
          'autoExpandSelection',
        ] as const
      ).map((key) => (
        <label key={key} className='flex items-center justify-between gap-3'>
          <span>{key}</span>
          <input
            type='checkbox'
            className='toggle'
            checked={lookup[key]}
            onChange={(event) => update({ [key]: event.target.checked })}
          />
        </label>
      ))}
    </section>
  );
};

export default LookupTab;
