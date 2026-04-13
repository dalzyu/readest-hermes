import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteFile } from '@/utils/file';
import { getOSPlatform } from '@/utils/misc';

vi.mock('@/utils/misc', () => ({
  getOSPlatform: vi.fn(),
}));

describe('RemoteFile.open', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(getOSPlatform).mockReset();
  });

  it('uses a range request on Android', async () => {
    vi.mocked(getOSPlatform).mockReturnValue('android');
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '2048',
          'content-range': 'bytes 0-1023/2048',
          'content-type': 'application/epub+zip',
        },
      }),
    );

    const file = new RemoteFile('https://example.com/book.epub');
    const opened = await file.open();

    expect(opened).toBe(file);
    expect(fetch).toHaveBeenCalledWith('https://example.com/book.epub', {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(file.size).toBe(2048);
    expect(file.type).toBe('application/epub+zip');
  });

  it('uses a HEAD request on other platforms', async () => {
    vi.mocked(getOSPlatform).mockReturnValue('windows');
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: {
          'content-length': '2048',
          'content-type': 'application/epub+zip',
        },
      }),
    );

    const file = new RemoteFile('https://example.com/book.epub');
    const opened = await file.open();

    expect(opened).toBe(file);
    expect(fetch).toHaveBeenCalledWith('https://example.com/book.epub', { method: 'HEAD' });
    expect(file.size).toBe(2048);
    expect(file.type).toBe('application/epub+zip');
  });
});
