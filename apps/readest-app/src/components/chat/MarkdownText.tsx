import React from 'react';

const MarkdownText: React.FC<{ content: string }> = ({ content }) => {
  return <div className='prose prose-sm max-w-none whitespace-pre-wrap'>{content}</div>;
};

export default MarkdownText;
