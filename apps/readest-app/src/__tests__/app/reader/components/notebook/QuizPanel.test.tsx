import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import QuizPanel from '@/app/reader/components/notebook/QuizPanel';

vi.mock('@/services/learning/vocabularyService', () => ({
  getDueVocabularyForBook: vi.fn(async () => []),
  getVocabularyForBook: vi.fn(async () => []),
  markVocabularyEntryReviewed: vi.fn(),
}));

describe('QuizPanel', () => {
  test('renders vocabulary and comprehension modes', () => {
    render(<QuizPanel bookKey='book' bookHash='hash' />);
    expect(screen.getByText('Vocabulary')).toBeTruthy();
    expect(screen.getByText('Comprehension')).toBeTruthy();
  });
});
