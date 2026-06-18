import React from 'react';
import type { Position } from '@/utils/sel';

export interface TranslatorPopupProps {
  text?: string;
  position?: Position;
  trianglePosition?: Position;
  popupWidth?: number;
  popupHeight?: number;
  onDismiss?: () => void;
}

const TranslatorPopup: React.FC<TranslatorPopupProps> = () => null;

export default TranslatorPopup;
