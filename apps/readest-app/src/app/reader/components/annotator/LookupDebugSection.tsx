import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import type { LookupDebugInfo } from '@/hooks/useLookupPipeline';

interface LookupDebugSectionProps {
  debugInfo: LookupDebugInfo;
}

const DebugBlock: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className='space-y-1'>
    <h4 className='text-[11px] font-semibold uppercase tracking-wide text-gray-400'>{label}</h4>
    <pre className='whitespace-pre-wrap rounded-md bg-black/20 p-2 text-[11px] leading-relaxed text-gray-200'>
      {value || '—'}
    </pre>
  </div>
);

const LookupDebugSection: React.FC<LookupDebugSectionProps> = ({ debugInfo }) => {
  const _ = useTranslation();

  return (
    <details
      className='mt-2 rounded-md border border-amber-400/20 bg-amber-400/5 p-3'
      data-testid='lookup-debug-section'
    >
      <summary className='cursor-pointer text-xs font-medium uppercase tracking-wide text-amber-200'>
        {_('Debug')}
      </summary>
      <div className='mt-3 space-y-3'>
        <DebugBlock label={_('System Prompt')} value={debugInfo.systemPrompt} />
        <DebugBlock label={_('User Prompt')} value={debugInfo.userPrompt} />
        <DebugBlock label={_('Raw Output')} value={debugInfo.rawStream} />
        <DebugBlock
          label={_('Parsed Result')}
          value={JSON.stringify(debugInfo.parsedResult ?? {}, null, 2)}
        />
      </div>
    </details>
  );
};

export default LookupDebugSection;
