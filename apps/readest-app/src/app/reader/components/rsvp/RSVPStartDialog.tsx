import React from 'react';
import type { RsvpStartChoice } from '@/services/rsvp/types';

export interface RSVPStartDialogProps {
  startChoice: RsvpStartChoice;
  onSelect: (option: 'selection' | 'current' | 'beginning' | 'saved') => void;
  onClose: () => void;
}

const RSVPStartDialog: React.FC<RSVPStartDialogProps> = () => null;

export default RSVPStartDialog;
