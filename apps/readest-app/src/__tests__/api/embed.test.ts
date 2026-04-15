import { describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'u1' }, token: 't' }),
}));

vi.mock('ai', () => ({
  createGateway: vi.fn(() => ({ embeddingModel: vi.fn(() => ({})) })),
  embedMany: vi.fn().mockResolvedValue({ embeddings: [[0.1]] }),
  embed: vi.fn().mockResolvedValue({ embedding: [0.1] }),
}));

import { POST } from '@/app/api/ai/embed/route';

describe('/api/ai/embed', () => {
  test('rejects unknown embedding model with 400', async () => {
    const req = new NextRequest('http://localhost/api/ai/embed', {
      method: 'POST',
      body: JSON.stringify({
        texts: ['hello'],
        model: 'evil/expensive-model',
        apiKey: 'test-key',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/not allowed/i);
  });

  test('accepts whitelisted embedding model', async () => {
    const req = new NextRequest('http://localhost/api/ai/embed', {
      method: 'POST',
      body: JSON.stringify({
        texts: ['hello'],
        model: 'openai/text-embedding-3-small',
        apiKey: 'test-key',
      }),
    });
    const res = await POST(req);
    expect(res.status).not.toBe(400);
  });
});
