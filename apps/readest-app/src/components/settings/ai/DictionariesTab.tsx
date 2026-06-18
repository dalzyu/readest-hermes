import React from 'react';
import { normalizeDictionarySettings } from '@/services/learning/settings';
import { useSettingsStore } from '@/store/settingsStore';

const DictionariesTab: React.FC = () => {
  const { settings, setSettings } = useSettingsStore();
  const dictionary = normalizeDictionarySettings(settings.globalReadSettings?.dictionary);
  const update = (next: typeof dictionary) => {
    setSettings({
      ...settings,
      globalReadSettings: { ...settings.globalReadSettings, dictionary: next },
    });
  };
  return (
    <section className='space-y-3'>
      <h3 className='font-semibold'>Dictionaries</h3>
      <label className='flex items-center justify-between gap-3'>
        <span>Enable dictionaries</span>
        <input
          type='checkbox'
          className='toggle'
          checked={dictionary.enabled}
          onChange={(event) => update({ ...dictionary, enabled: event.target.checked })}
        />
      </label>
      <div className='space-y-2'>
        {dictionary.dictionaries.length === 0 ? (
          <p className='text-base-content/60 text-sm'>No dictionaries installed.</p>
        ) : null}
        {dictionary.dictionaries.map((item) => (
          <div
            key={item.id}
            className='border-base-300 flex items-center justify-between rounded-md border p-2'
          >
            <span>{item.name}</span>
            <input
              type='checkbox'
              className='toggle toggle-sm'
              checked={item.enabled !== false}
              onChange={(event) =>
                update({
                  ...dictionary,
                  dictionaries: dictionary.dictionaries.map((entry) =>
                    entry.id === item.id ? { ...entry, enabled: event.target.checked } : entry,
                  ),
                })
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
};

export default DictionariesTab;
