import React, { useState } from 'react';

const ChatInput: React.FC<{
  disabled?: boolean;
  onSend: (content: string) => void | Promise<void>;
}> = ({ disabled, onSend }) => {
  const [value, setValue] = useState('');
  const submit = async () => {
    const content = value.trim();
    if (!content) return;
    setValue('');
    await onSend(content);
  };
  return (
    <div className='border-base-300 flex gap-2 border-t p-3'>
      <textarea
        className='textarea textarea-bordered min-h-12 flex-1'
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <button
        type='button'
        className='btn btn-primary'
        disabled={disabled}
        onClick={() => void submit()}
      >
        Send
      </button>
    </div>
  );
};

export default ChatInput;
