import React from 'react';
import { PiQuestion } from 'react-icons/pi';
import * as Tooltip from '@radix-ui/react-tooltip';

interface HelpTipProps {
  tip: string;
}

const HelpTip: React.FC<HelpTipProps> = ({ tip }) => (
  <Tooltip.Provider delayDuration={200}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className='inline-flex cursor-help items-center text-gray-400 hover:text-gray-300'
          aria-label={tip}
        >
          <PiQuestion size={13} />
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side='top'
          className='bg-base-300 text-base-content z-50 max-w-xs rounded px-2 py-1 text-xs shadow-md'
        >
          {tip}
          <Tooltip.Arrow className='fill-base-300' />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

export default HelpTip;
