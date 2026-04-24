import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import LegalLinks from '@/components/LegalLinks';

let mockAppService: { isIOSApp: boolean; isMacOSApp: boolean } | null = null;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: mockAppService }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
}));

afterEach(() => {
  cleanup();
  mockAppService = null;
});

describe('LegalLinks', () => {
  it('renders nothing until an Apple platform is known', () => {
    mockAppService = null;

    const { container } = render(<LegalLinks />);

    expect(container.firstChild).toBeNull();
  });

  it('renders only the Apple EULA link on Apple platforms', () => {
    mockAppService = { isIOSApp: false, isMacOSApp: true };

    render(<LegalLinks />);

    const termsLink = screen.getByRole('link', { name: 'Terms of Service' });
    expect(termsLink.getAttribute('href')).toBe(
      'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
    );
    expect(screen.getAllByRole('link').length).toBe(1);
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).toBeNull();
  });
});
