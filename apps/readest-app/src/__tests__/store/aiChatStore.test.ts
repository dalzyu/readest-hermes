import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockSaveConversation = vi.fn();
const mockGetConversations = vi.fn();
const mockSaveMessage = vi.fn();

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: {
    saveConversation: (...args: unknown[]) => mockSaveConversation(...args),
    getConversations: (...args: unknown[]) => mockGetConversations(...args),
    saveMessage: (...args: unknown[]) => mockSaveMessage(...args),
    getMessages: vi.fn(),
    deleteConversation: vi.fn(),
    updateConversationTitle: vi.fn(),
  },
}));

import { useAIChatStore } from '@/store/aiChatStore';

describe('aiChatStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversations.mockResolvedValue([]);
    useAIChatStore.setState({
      activeConversationId: null,
      conversations: [],
      messages: [],
      isLoadingHistory: false,
      currentBookHash: null,
      pendingSeedMessage: null,
    });
  });

  test('queues a pending seeded prompt instead of pre-saving the first user message', async () => {
    await useAIChatStore
      .getState()
      .createConversationWithFirstMessage('book-1', 'Ask about 身侧', 'Selection:\n身侧');

    const state = useAIChatStore.getState();

    expect(mockSaveConversation).toHaveBeenCalledTimes(1);
    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(state.activeConversationId).toBeTruthy();
    expect(state.messages).toEqual([]);
    expect(state.pendingSeedMessage).toEqual({
      conversationId: state.activeConversationId,
      content: 'Selection:\n身侧',
    });
  });
});
