'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpenIcon, Loader2Icon } from 'lucide-react';
import ChatInput from '@/components/chat/ChatInput';
import ChatThread from '@/components/chat/ChatThread';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { indexBook, isBookIndexed } from '@/services/ai/ragService';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { EmbeddingProgress, IndexResult } from '@/services/ai/types';
import { aiLogger } from '@/services/ai/logger';
import { streamChat } from '@/services/ai/adapters/ChatStreamAdapter';
import type { AIMessage } from '@/services/ai/types';
import { useAIChatStore } from '@/store/aiChatStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { eventDispatcher } from '@/utils/event';

interface AIAssistantProps {
  bookKey: string;
}

const AIAssistant = ({ bookKey }: AIAssistantProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const {
    activeConversationId,
    messages,
    loadConversations,
    setActiveConversation,
    createConversation,
    addMessage,
  } = useAIChatStore();
  const bookData = getBookData(bookKey);

  const [isLoading, setIsLoading] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState<EmbeddingProgress | null>(null);
  const [indexed, setIndexed] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<AIMessage | null>(null);
  const [indexNotice, setIndexNotice] = useState<{
    type: 'warning' | 'error';
    message: string;
  } | null>(null);

  const bookHash = bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const aiSettings = settings?.aiSettings;

  useEffect(() => {
    if (!bookHash) {
      setIsLoading(false);
      return;
    }
    void loadConversations(bookHash);
    isBookIndexed(bookHash).then((result) => {
      setIndexed(result);
      setIsLoading(false);
    });
  }, [bookHash, loadConversations]);

  const handleIndex = useCallback(async () => {
    if (!bookData?.bookDoc || !aiSettings) return;
    setIsIndexing(true);
    setIndexNotice(null);
    try {
      const result: IndexResult = await indexBook(
        bookData.bookDoc as Parameters<typeof indexBook>[0],
        bookHash,
        aiSettings,
        setIndexProgress,
      );
      if (
        result.status === 'complete' ||
        result.status === 'already-indexed' ||
        result.status === 'partial'
      ) {
        setIndexed(true);
      }
      if (result.status === 'partial') {
        void eventDispatcher.dispatch('toast', {
          message: _('Book indexed with warnings. {{count}} section(s) could not be processed.', {
            count: result.errorMessages.length,
          }),
          type: 'warning',
        });
      }
      if (result.status === 'empty') {
        const message = _('No indexable content was found in this book.');
        setIndexNotice({ type: 'warning', message });
        aiLogger.rag.indexError(bookHash, 'No indexable content found');
      }
    } catch (error) {
      const message = (error as Error).message;
      aiLogger.rag.indexError(bookHash, message);
      setIndexNotice({ type: 'error', message });
      void eventDispatcher.dispatch('toast', {
        message: _('Indexing failed: {{message}}', { message }),
        type: 'error',
      });
    } finally {
      setIsIndexing(false);
      setIndexProgress(null);
    }
  }, [bookData?.bookDoc, bookHash, aiSettings, _]);

  const handleResetIndex = useCallback(async () => {
    if (!appService) return;
    if (!(await appService.ask(_('Are you sure you want to re-index this book?')))) return;
    await aiStore.clearBook(bookHash);
    setIndexed(false);
  }, [bookHash, appService, _]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!aiSettings) return;
      let conversationId = activeConversationId;
      if (!conversationId) {
        conversationId = await createConversation(bookHash, content);
        await setActiveConversation(conversationId);
      }
      const userMessage = { conversationId, role: 'user' as const, content };
      await addMessage(userMessage);
      const baseMessages = [
        ...messages,
        { ...userMessage, id: crypto.randomUUID(), createdAt: Date.now() },
      ];
      const draft: AIMessage = {
        id: crypto.randomUUID(),
        conversationId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
      };
      setStreamingMessage(draft);
      const final = await streamChat(
        { messages: baseMessages, bookHash, bookTitle, aiSettings },
        (token) =>
          setStreamingMessage((current) =>
            current ? { ...current, content: current.content + token } : current,
          ),
      );
      await addMessage({ conversationId, role: 'assistant', content: final.content });
      setStreamingMessage(null);
    },
    [
      activeConversationId,
      addMessage,
      aiSettings,
      bookHash,
      bookTitle,
      createConversation,
      messages,
      setActiveConversation,
    ],
  );

  if (!aiSettings?.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4 text-sm'>
        {_('Enable AI in Settings')}
      </div>
    );
  }
  if (isLoading) return null;

  const progressPercent =
    indexProgress?.phase === 'embedding' && indexProgress.total > 0
      ? Math.round((indexProgress.current / indexProgress.total) * 100)
      : 0;

  if (!indexed && !isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <BookOpenIcon className='text-primary size-6' />
        <h3 className='text-sm font-medium'>{_('Index This Book')}</h3>
        <p className='text-xs opacity-70'>{_('Enable AI search and chat for this book')}</p>
        {indexNotice ? <p className='text-error text-xs'>{indexNotice.message}</p> : null}
        <button type='button' className='btn btn-primary btn-sm' onClick={handleIndex}>
          {_('Start Indexing')}
        </button>
      </div>
    );
  }

  if (isIndexing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
        <Loader2Icon className='text-primary size-6 animate-spin' />
        <p className='text-sm'>{_('Indexing book...')}</p>
        <div className='bg-muted h-1.5 w-32 overflow-hidden rounded-full'>
          <div
            className='bg-primary h-full transition-all duration-300'
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='border-base-300 flex justify-end border-b p-2'>
        <button
          type='button'
          className='btn btn-ghost btn-xs'
          onClick={() => void handleResetIndex()}
        >
          {_('Reset index')}
        </button>
      </div>
      <ChatThread messages={messages} streamingMessage={streamingMessage} />
      <ChatInput disabled={Boolean(streamingMessage)} onSend={handleSend} />
    </div>
  );
};

export default AIAssistant;
