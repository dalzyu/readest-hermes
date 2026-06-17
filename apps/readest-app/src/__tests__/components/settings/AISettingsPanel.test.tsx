import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import AISettingsPanel from '@/components/settings/AISettingsPanel';

describe('AISettingsPanel', () => {
  test('renders the three settings tabs', () => {
    render(<AISettingsPanel />);
    expect(screen.getAllByText('Providers').length).toBeGreaterThan(0);
    expect(screen.getByText('Lookup')).toBeTruthy();
    expect(screen.getByText('Dictionaries')).toBeTruthy();
  });
});
