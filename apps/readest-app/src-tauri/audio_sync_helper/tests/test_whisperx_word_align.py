from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from whisperx_word_align import (
    BookToken,
    TranscriptWord,
    align_transcript_to_book,
    chapter_progress,
)


class WhisperxWordAlignTests(unittest.TestCase):
    def test_chapter_progress_is_strictly_increasing(self) -> None:
        chapter_count = 3
        values: list[float] = []
        for index in range(chapter_count):
            values.append(chapter_progress(index, "transcribing", chapter_count))
            values.append(chapter_progress(index, "aligning", chapter_count))
            values.append(chapter_progress(index, "matching", chapter_count))
        values.append(0.95)
        values.append(1.0)

        self.assertTrue(all(left < right for left, right in zip(values, values[1:])))

    def test_align_transcript_to_book_returns_book_indices(self) -> None:
        book_tokens = [
            BookToken("one", 0, 3, 0, "s0", 0, 3, "cfi0", "cfi1", "one"),
            BookToken("two", 4, 7, 0, "s0", 4, 7, "cfi1", "cfi2", "two"),
            BookToken("three", 8, 13, 0, "s0", 8, 13, "cfi2", "cfi3", "three"),
        ]
        transcript_words = [
            TranscriptWord("w0", "one", "one", 0, 100, 1.0, 0),
            TranscriptWord("w1", "two", "two", 100, 200, 1.0, 0),
            TranscriptWord("w2", "three", "three", 200, 300, 1.0, 0),
        ]

        mapping = align_transcript_to_book(book_tokens, transcript_words)

        self.assertEqual(set(mapping.keys()), {0, 1, 2})
        self.assertEqual(mapping[0][0], 0)
        self.assertEqual(mapping[1][0], 1)
        self.assertEqual(mapping[2][0], 2)
        self.assertIs(mapping[0][1], book_tokens[0])
        self.assertIs(mapping[1][1], book_tokens[1])
        self.assertIs(mapping[2][1], book_tokens[2])


if __name__ == "__main__":
    unittest.main()
