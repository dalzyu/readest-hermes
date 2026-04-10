import { useCallback } from 'react';
import { useNotebookStore } from '@/store/notebookStore';
import { useAIChatStore } from '@/store/aiChatStore';

// Hook to open the Notebook panel with the AI tab and optionally load a specific conversation

export function useOpenAIInNotebook() {
  const { setNotebookVisible, setNotebookActiveTab } = useNotebookStore();
  const { setActiveConversation, createConversation, createConversationWithFirstMessage } =
    useAIChatStore();

  const openAIInNotebook = useCallback(
    async (options?: {
      conversationId?: string;
      bookHash?: string;
      newConversationTitle?: string;
      firstMessageContent?: string;
    }) => {
      // Open notebook and switch to AI tab
      setNotebookVisible(true);
      setNotebookActiveTab('ai');

      if (options?.conversationId) {
        // Load existing conversation
        await setActiveConversation(options.conversationId);
      } else if (
        options?.bookHash &&
        options?.newConversationTitle &&
        options?.firstMessageContent
      ) {
        await createConversationWithFirstMessage(
          options.bookHash,
          options.newConversationTitle,
          options.firstMessageContent,
        );
      } else if (options?.bookHash && options?.newConversationTitle) {
        await createConversation(options.bookHash, options.newConversationTitle);
      }
    },
    [
      setNotebookVisible,
      setNotebookActiveTab,
      setActiveConversation,
      createConversation,
      createConversationWithFirstMessage,
    ],
  );

  const closeAIInNotebook = useCallback(() => {
    setNotebookActiveTab('notes');
  }, [setNotebookActiveTab]);

  return {
    openAIInNotebook,
    closeAIInNotebook,
  };
}

export default useOpenAIInNotebook;
