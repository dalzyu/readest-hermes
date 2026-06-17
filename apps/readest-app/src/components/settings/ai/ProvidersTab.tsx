import React from 'react';
import { useSettingsStore } from '@/store/settingsStore';

const ProvidersTab: React.FC = () => {
  const aiSettings = useSettingsStore((state) => state.settings.aiSettings);
  return (
    <section className='space-y-3'>
      <h3 className='font-semibold'>Providers</h3>
      <p className='text-base-content/60 text-sm'>Configure model providers and task routing.</p>
      <div className='space-y-2'>
        {(aiSettings?.providers ?? []).map((provider) => (
          <div key={provider.id} className='border-base-300 rounded-md border p-3'>
            <div className='font-medium'>{provider.name}</div>
            <div className='text-base-content/60 text-xs'>{provider.providerType}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

export default ProvidersTab;
