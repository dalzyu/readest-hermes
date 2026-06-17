import React from 'react';
import QuizPanel from '@/app/reader/components/notebook/QuizPanel';
import { useBookDataStore } from '@/store/bookDataStore';

const ComprehensionView: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const { getBookData } = useBookDataStore();
  const bookHash = getBookData(bookKey)?.book?.hash ?? '';
  return <QuizPanel bookKey={bookKey} bookHash={bookHash} initialMode='comprehension' />;
};

export default ComprehensionView;
