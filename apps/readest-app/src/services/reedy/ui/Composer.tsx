import React, { Dispatch, SetStateAction } from 'react';

export interface ComposerProps {
  isRunning: boolean;
  onSend: (text: string) => void;
  onAbort?: () => void;
  skills?: Array<{ id: string; name: string; description: string }>;
  activeSkillId?: string | null;
  onSkillSelect?: Dispatch<SetStateAction<string | null>>;
}

export const Composer: React.FC<ComposerProps> = () => {
  return null;
};
