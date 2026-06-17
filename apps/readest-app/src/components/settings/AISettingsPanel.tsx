import React, { useState } from 'react';
import ProvidersTab from './ai/ProvidersTab';
import LookupTab from './ai/LookupTab';
import DictionariesTab from './ai/DictionariesTab';

type Tab = 'providers' | 'lookup' | 'dictionaries';

const tabs: { id: Tab; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'lookup', label: 'Lookup' },
  { id: 'dictionaries', label: 'Dictionaries' },
];

const AISettingsPanel: React.FC = () => {
  const [active, setActive] = useState<Tab>('providers');
  return (
    <div className='space-y-4 p-4'>
      <div className='tabs tabs-boxed'>
        {tabs.map((tab) => (
          <button
            type='button'
            key={tab.id}
            className={`tab ${active === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active === 'providers' ? <ProvidersTab /> : null}
      {active === 'lookup' ? <LookupTab /> : null}
      {active === 'dictionaries' ? <DictionariesTab /> : null}
    </div>
  );
};

export default AISettingsPanel;
