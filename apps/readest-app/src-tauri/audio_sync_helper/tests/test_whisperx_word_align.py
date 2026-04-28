from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from whisperx_word_align import (
    BookToken,
    TranscriptWord,
    align_transcript_to_book,
    apply_bundled_nltk_data,
    chapter_progress,
    write_json_atomic,
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


    def test_apply_bundled_nltk_data_appends_to_existing_paths(self) -> None:
        import os

        original = os.environ.get("NLTK_DATA")
        try:
            os.environ["NLTK_DATA"] = "/user/preferred/nltk_data"
            bundled = Path("/bundled/nltk_data")
            apply_bundled_nltk_data(bundled)
            value = os.environ["NLTK_DATA"]
            self.assertIn("/user/preferred/nltk_data", value)
            self.assertIn(str(bundled), value)
            self.assertTrue(
                value.startswith(str(bundled)),
                f"bundled path must come first, got {value!r}",
            )
        finally:
            if original is None:
                os.environ.pop("NLTK_DATA", None)
            else:
                os.environ["NLTK_DATA"] = original

    def test_apply_bundled_nltk_data_sets_when_unset(self) -> None:
        import os

        original = os.environ.pop("NLTK_DATA", None)
        try:
            apply_bundled_nltk_data(Path("/only/bundled"))
            self.assertEqual(os.environ["NLTK_DATA"], str(Path("/only/bundled")))
        finally:
            os.environ.pop("NLTK_DATA", None)
            if original is not None:
                os.environ["NLTK_DATA"] = original

    def test_write_json_atomic_writes_via_tmp_then_renames(self) -> None:
        import json
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "nested" / "out.json"
            payload = {"hello": "world", "version": 2}
            write_json_atomic(target, payload)
            self.assertTrue(target.exists())
            self.assertFalse(target.with_suffix(target.suffix + ".tmp").exists())
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), payload)

    def test_write_json_atomic_does_not_leave_partial_file_on_failure(self) -> None:
        import tempfile

        class Unserializable:
            pass

        with tempfile.TemporaryDirectory() as tmpdir:
            target = Path(tmpdir) / "out.json"
            with self.assertRaises(TypeError):
                write_json_atomic(target, {"bad": Unserializable()})
            self.assertFalse(target.exists())
            self.assertFalse(target.with_suffix(target.suffix + ".tmp").exists())

if __name__ == "__main__":
    unittest.main()
