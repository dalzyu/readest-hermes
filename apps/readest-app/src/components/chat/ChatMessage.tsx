import React from 'react';
import type { AIMessage } from '@/services/ai/types';
import MarkdownText from './MarkdownText';

const ChatMessage: React.FC<{ message: AIMessage }> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <article className={`chat ${isUser ? 'chat-end' : 'chat-start'}`}>
      <div className={`chat-bubble ${isUser ? 'chat-bubble-primary' : ''}`}>
        <MarkdownText content={message.content} />
      </div>
    </article>
  );
};

export default ChatMessage;
