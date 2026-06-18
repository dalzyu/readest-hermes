import React from 'react';

export interface ComposerProps {
  isRunning: boolean;
  onSend: (text: string) => void;
  onAbort?: () => void;
  skills?: Array<{ id: string; name: string; description: string }>;
}

export const Composer: React.FC<ComposerProps> = () => {
  return null;
};
