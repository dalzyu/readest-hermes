import React from 'react';
import type { AIMessage } from '@/services/ai/types';
import ChatMessage from './ChatMessage';

const ChatThread: React.FC<{ messages: AIMessage[]; streamingMessage?: AIMessage | null }> = ({
  messages,
  streamingMessage,
}) => {
  return (
    <div className='flex flex-1 flex-col gap-2 overflow-auto p-3'>
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      {streamingMessage ? <ChatMessage message={streamingMessage} /> : null}
    </div>
  );
};

export default ChatThread;
