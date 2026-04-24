from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable

LANGUAGES_WITHOUT_SPACES = {"ja", "zh"}
CONTROL_CHARS_RE = re.compile(r"[\u0000-\u001f]+")
WHITESPACE_RE = re.compile(r"[\s\u00A0]+")
TOKEN_RE = re.compile(r"\S+")
CHAPTER_NUMBER_RE = re.compile(r"(\d+(?:[.]\d+)?)")
CHARACTER_NORMALIZATIONS: tuple[tuple[str, str], ...] = (
    ("‘", "'"),
    ("’", "'"),
    ("‛", "'"),
    ('“', '"'),
    ('”', '"'),
    ('„', '"'),
    ('‟', '"'),
    ('–', '-'),
    ('—', '-'),
    ('…', '...'),
)


@dataclass
class BookToken:
    token: str
    global_start: int
    global_end: int
    section_index: int
    section_href: str
    local_start: int
    local_end: int
    cfi_start: str
    cfi_end: str
    text: str


@dataclass
class TranscriptWord:
    id: str
    word: str
    token: str
    start_ms: int
    end_ms: int
    score: float
    segment_index: int


@dataclass
class ChapterContext:
    id: str
    title: str
    section_start: int
    section_end: int
    audio_start_ms: int
    audio_end_ms: int
    combined_text: str
    combined_sections: list[dict[str, Any]]
    book_tokens: list[BookToken]


class HelperError(RuntimeError):
    pass


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def emit_progress(phase: str, progress: float, detail: str) -> None:
    emit({"event": "progress", "phase": phase, "progress": max(0.0, min(progress, 1.0)), "detail": detail})


def normalize_text(text: str) -> str:
    normalized = CONTROL_CHARS_RE.sub(" ", text)
    for source, target in CHARACTER_NORMALIZATIONS:
        normalized = normalized.replace(source, target)
    return WHITESPACE_RE.sub(" ", normalized).strip()


def normalize_token(raw: str, language: str | None) -> str:
    normalized = normalize_text(raw).lower()
    if not normalized:
        return ""
    if language in LANGUAGES_WITHOUT_SPACES:
        return normalized
    normalized = re.sub(r"^[^\w']+|[^\w']+$", "", normalized, flags=re.UNICODE)
    return normalized


def ensure_ffmpeg_on_path() -> str:
    ffmpeg_path = os.environ.get("HERMES_AUDIO_SYNC_FFMPEG")
    if not ffmpeg_path:
        try:
            import imageio_ffmpeg  # type: ignore

            ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception as exc:  # pragma: no cover - surfaced to caller
            raise HelperError(f"Unable to locate ffmpeg executable: {exc}") from exc

    ffmpeg_path = str(Path(ffmpeg_path).resolve())
    ffmpeg_file = Path(ffmpeg_path)
    alias_path = ffmpeg_file.with_name("ffmpeg.exe") if ffmpeg_file.name.lower() != "ffmpeg.exe" else ffmpeg_file
    if alias_path != ffmpeg_file and not alias_path.exists():
        shutil.copy2(ffmpeg_file, alias_path)
    ffmpeg_dir = str(alias_path.parent)
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
    return str(alias_path)


def load_alignment_input(path: str) -> dict[str, Any]:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:
        raise HelperError(f"Failed to read alignment input {path}: {exc}") from exc
    if data.get("version") != 3:
        raise HelperError(f"Unsupported alignment input version {data.get('version')}")
    return data


def extract_number(text: str) -> str | None:
    match = CHAPTER_NUMBER_RE.search(text)
    return match.group(1).lstrip("0") or "0" if match else None


def similarity_score(left: str, right: str) -> float:
    left_normalized = normalize_text(left).lower()
    right_normalized = normalize_text(right).lower()
    if not left_normalized or not right_normalized:
        return 0.0
    left_number = extract_number(left_normalized)
    right_number = extract_number(right_normalized)
    if left_number and right_number and left_number == right_number:
        return 1.0
    return SequenceMatcher(None, left_normalized, right_normalized, autojunk=False).ratio()


def section_index_for_progress(sections: list[dict[str, Any]], ratio: float) -> int:
    total_chars = sum(max(1, len(section.get("normalizedText", ""))) for section in sections)
    if total_chars <= 0:
        return 0
    target = total_chars * max(0.0, min(ratio, 1.0))
    traversed = 0
    for index, section in enumerate(sections):
        traversed += max(1, len(section.get("normalizedText", "")))
        if traversed >= target:
            return index
    return max(0, len(sections) - 1)


def is_numeric_title(title: str) -> bool:
    stripped = normalize_text(title)
    return bool(stripped) and not any(char.isalpha() for char in stripped)


def build_chapter_ranges(payload: dict[str, Any]) -> list[tuple[dict[str, Any], int, int]]:
    sections = payload["sections"]
    toc_with_sections = [item for item in payload.get("toc", []) if item.get("sectionIndex") is not None]
    toc_with_sections.sort(key=lambda item: item["sectionIndex"])
    audio_chapters = payload.get("audio", {}).get("chapters") or []

    if not audio_chapters:
        total_duration = payload.get("audio", {}).get("durationMs") or 0
        return [
            (
                {"index": 0, "title": payload.get("audio", {}).get("title") or "Whole Book", "startMs": 0, "endMs": total_duration},
                0,
                max(0, len(sections) - 1),
            )
        ]

    starts: list[int] = []
    cursor = 0
    total_duration = max(1, int(payload.get("audio", {}).get("durationMs") or audio_chapters[-1].get("endMs") or 1))
    for chapter_idx, chapter in enumerate(audio_chapters):
        title = chapter.get("title") or f"Chapter {chapter_idx + 1}"
        if is_numeric_title(title):
            starts.append(section_index_for_progress(sections, float(chapter.get("startMs") or 0) / total_duration))
            continue

        best_point = None
        best_score = 0.0
        for point_idx, toc_item in enumerate(toc_with_sections[cursor:], start=cursor):
            score = similarity_score(title, toc_item.get("label", ""))
            if score > best_score:
                best_score = score
                best_point = point_idx
        if best_point is not None and best_score >= 0.45:
            cursor = best_point
            starts.append(toc_with_sections[best_point]["sectionIndex"])
        else:
            starts.append(section_index_for_progress(sections, float(chapter.get("startMs") or 0) / total_duration))
            cursor = min(cursor, len(toc_with_sections) - 1) if toc_with_sections else 0

    monotonic_starts: list[int] = []
    for start in starts:
        monotonic_starts.append(max(monotonic_starts[-1], start) if monotonic_starts else start)

    ranges: list[tuple[dict[str, Any], int, int]] = []
    for idx, chapter in enumerate(audio_chapters):
        start = monotonic_starts[idx]
        next_start = monotonic_starts[idx + 1] if idx + 1 < len(monotonic_starts) else len(sections)
        end = min(max(start, next_start - 1), len(sections) - 1)
        ranges.append((chapter, start, end))
    return ranges


def find_anchor_for_offset(section: dict[str, Any], local_offset: int) -> dict[str, Any]:
    anchors = section.get("anchors") or []
    if not anchors:
        raise HelperError(f"Section {section.get('sectionIndex')} has no anchors")
    for anchor in anchors:
        if anchor["normalizedStart"] <= local_offset < anchor["normalizedEnd"]:
            return anchor
    for anchor in anchors:
        if local_offset < anchor["normalizedStart"]:
            return anchor
    return anchors[-1]


def resolve_section_cfi_bounds(section: dict[str, Any]) -> tuple[str, str]:
    tokens = section.get("tokens") or []
    if tokens:
        return tokens[0]["cfiStart"], tokens[-1]["cfiEnd"]

    anchors = section.get("anchors") or []
    if anchors:
        return anchors[0]["cfiStart"], anchors[-1]["cfiEnd"]

    raise HelperError(f"Section {section.get('sectionIndex')} has no token or anchor cfi bounds")


def build_book_tokens(language: str | None, sections: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]], list[BookToken]]:
    combined_text_parts: list[str] = []
    combined_sections: list[dict[str, Any]] = []
    book_tokens: list[BookToken] = []
    global_offset = 0

    for idx, section in enumerate(sections):
        section_text = section["normalizedText"]
        if idx > 0:
            combined_text_parts.append(" ")
            global_offset += 1
        section_offset = global_offset
        combined_text_parts.append(section_text)
        combined_sections.append({**section, "combinedStart": section_offset, "combinedEnd": section_offset + len(section_text)})

        explicit_tokens = section.get("tokens") or []
        if explicit_tokens:
            for token_payload in explicit_tokens:
                token = normalize_token(token_payload.get("text", ""), language)
                if not token:
                    continue
                book_tokens.append(
                    BookToken(
                        token=token,
                        global_start=section_offset + int(token_payload["normalizedStart"]),
                        global_end=section_offset + int(token_payload["normalizedEnd"]),
                        section_index=section["sectionIndex"],
                        section_href=section["sectionHref"],
                        local_start=int(token_payload["normalizedStart"]),
                        local_end=int(token_payload["normalizedEnd"]),
                        cfi_start=token_payload["cfiStart"],
                        cfi_end=token_payload["cfiEnd"],
                        text=token_payload["text"],
                    )
                )

            global_offset += len(section_text)
            continue

        if language in LANGUAGES_WITHOUT_SPACES:
            for char_index, char in enumerate(section_text):
                token = normalize_token(char, language)
                if not token:
                    continue
                anchor = find_anchor_for_offset(section, char_index)
                book_tokens.append(
                    BookToken(
                        token=token,
                        global_start=section_offset + char_index,
                        global_end=section_offset + char_index + 1,
                        section_index=section["sectionIndex"],
                        section_href=section["sectionHref"],
                        local_start=char_index,
                        local_end=char_index + 1,
                        cfi_start=anchor["cfiStart"],
                        cfi_end=anchor["cfiEnd"],
                        text=char,
                    )
                )
        else:
            for match in TOKEN_RE.finditer(section_text):
                token = normalize_token(match.group(0), language)
                if not token:
                    continue
                start = match.start()
                end = match.end()
                start_anchor = find_anchor_for_offset(section, start)
                end_anchor = find_anchor_for_offset(section, max(start, end - 1))
                book_tokens.append(
                    BookToken(
                        token=token,
                        global_start=section_offset + start,
                        global_end=section_offset + end,
                        section_index=section["sectionIndex"],
                        section_href=section["sectionHref"],
                        local_start=start,
                        local_end=end,
                        cfi_start=start_anchor["cfiStart"],
                        cfi_end=end_anchor["cfiEnd"],
                        text=match.group(0),
                    )
                )

        global_offset += len(section_text)

    return "".join(combined_text_parts), combined_sections, book_tokens


def build_chapter_contexts(payload: dict[str, Any]) -> list[ChapterContext]:
    language = payload.get("language")
    sections = payload["sections"]
    contexts: list[ChapterContext] = []

    for chapter, start_section, end_section in build_chapter_ranges(payload):
        chapter_sections = sections[start_section : end_section + 1]
        combined_text, combined_sections, book_tokens = build_book_tokens(language, chapter_sections)
        contexts.append(
            ChapterContext(
                id=f"chapter-{chapter.get('index', len(contexts))}",
                title=chapter.get("title") or f"Chapter {len(contexts) + 1}",
                section_start=start_section,
                section_end=end_section,
                audio_start_ms=int(chapter.get("startMs") or 0),
                audio_end_ms=int(chapter.get("endMs") or payload.get("audio", {}).get("durationMs") or 0),
                combined_text=combined_text,
                combined_sections=combined_sections,
                book_tokens=book_tokens,
            )
        )
    return contexts


def resolve_span_for_token_range(context: ChapterContext, token_start: BookToken, token_end: BookToken) -> tuple[str, str, str, int, int]:
    return (
        token_start.section_href,
        token_start.cfi_start,
        token_end.cfi_end,
        token_start.local_start,
        token_end.local_end,
    )


def transcribe_audio_chunk(
    asr_model: Any,
    audio: Any,
    chapter: ChapterContext,
    language: str | None,
    batch_size: int,
    chunk_size: int,
) -> tuple[Any, dict[str, Any]]:
    sample_rate = 16000
    start_idx = int(chapter.audio_start_ms * sample_rate / 1000)
    end_idx = int(chapter.audio_end_ms * sample_rate / 1000)
    audio_chunk = audio[start_idx:end_idx]
    if len(audio_chunk) == 0:
        return audio_chunk, {"segments": []}

    transcription = asr_model.transcribe(
        audio_chunk,
        batch_size=batch_size,
        chunk_size=chunk_size,
        print_progress=False,
        verbose=False,
        language=language,
    )
    return audio_chunk, transcription


def align_transcription(
    whisperx_module: Any,
    align_model: Any,
    align_metadata: dict[str, Any],
    audio_chunk: Any,
    transcription: dict[str, Any],
    device: str,
) -> dict[str, Any]:
    if not transcription.get("segments"):
        return {"segments": []}
    return whisperx_module.align(
        transcription["segments"],
        align_model,
        align_metadata,
        audio_chunk,
        device,
        return_char_alignments=False,
        print_progress=False,
    )


def flatten_transcript_words(aligned_segments: list[dict[str, Any]], chapter_offset_ms: int, language: str | None) -> tuple[list[TranscriptWord], dict[int, list[int]]]:
    words: list[TranscriptWord] = []
    by_segment: dict[int, list[int]] = {}
    for segment_idx, segment in enumerate(aligned_segments):
        indices: list[int] = []
        for word_idx, word in enumerate(segment.get("words") or []):
            if word.get("start") is None or word.get("end") is None:
                continue
            token = normalize_token(word.get("word", ""), language)
            if not token:
                continue
            transcript_word = TranscriptWord(
                id=f"seg-{segment_idx}-word-{word_idx}",
                word=(word.get("word") or "").strip(),
                token=token,
                start_ms=int(round(float(word["start"]) * 1000)) + chapter_offset_ms,
                end_ms=int(round(float(word["end"]) * 1000)) + chapter_offset_ms,
                score=float(word.get("score") or 0.0),
                segment_index=segment_idx,
            )
            indices.append(len(words))
            words.append(transcript_word)
        by_segment[segment_idx] = indices
    return words, by_segment


def align_transcript_to_book(book_tokens: list[BookToken], transcript_words: list[TranscriptWord]) -> dict[int, BookToken]:
    book_sequence = [token.token for token in book_tokens]
    transcript_sequence = [word.token for word in transcript_words]
    matcher = SequenceMatcher(None, book_sequence, transcript_sequence, autojunk=False)
    mapping: dict[int, BookToken] = {}
    for book_start, transcript_start, size in matcher.get_matching_blocks():
        if size <= 0:
            continue
        for offset in range(size):
            mapping[transcript_start + offset] = book_tokens[book_start + offset]
    return mapping


def build_word_segments(context: ChapterContext, aligned: dict[str, Any], language: str | None) -> tuple[list[dict[str, Any]], float, set[int], int]:
    transcript_words, words_by_segment = flatten_transcript_words(aligned.get("segments") or [], context.audio_start_ms, language)
    if not transcript_words:
        return [], 0.0, set(), 0

    mapping = align_transcript_to_book(context.book_tokens, transcript_words)
    matched_indices = set(mapping.keys())
    unique_book_indices = {context.book_tokens.index(mapping[idx]) for idx in matched_indices}
    total_chars = len(context.combined_text)

    segments: list[dict[str, Any]] = []
    for segment_idx, segment in enumerate(aligned.get("segments") or []):
        transcript_indices = words_by_segment.get(segment_idx, [])
        matched_words = [(index, mapping[index], transcript_words[index]) for index in transcript_indices if index in mapping]
        if not matched_words:
            continue

        first_book = matched_words[0][1]
        last_book = matched_words[-1][1]
        section_href, cfi_start, cfi_end, text_start_offset, text_end_offset = resolve_span_for_token_range(context, first_book, last_book)
        words = [
            {
                "id": transcript_word.id,
                "sectionHref": book_token.section_href,
                "cfiStart": book_token.cfi_start,
                "cfiEnd": book_token.cfi_end,
                "text": transcript_word.word,
                "textStartOffset": book_token.local_start,
                "textEndOffset": book_token.local_end,
                "audioStartMs": transcript_word.start_ms,
                "audioEndMs": transcript_word.end_ms,
                "confidence": min(1.0, max(0.0, transcript_word.score)),
            }
            for _, book_token, transcript_word in matched_words
        ]
        confidence = len(matched_words) / max(1, len(transcript_indices))
        segments.append(
            {
                "id": f"{context.id}-segment-{segment_idx}",
                "sectionHref": section_href,
                "cfiStart": cfi_start,
                "cfiEnd": cfi_end,
                "text": normalize_text(segment.get("text", "")),
                "textStartOffset": text_start_offset,
                "textEndOffset": text_end_offset,
                "audioStartMs": words[0]["audioStartMs"],
                "audioEndMs": words[-1]["audioEndMs"],
                "confidence": confidence,
                "words": words,
            }
        )

    matched_ratio = len(matched_indices) / max(1, len(transcript_words))
    return segments, matched_ratio, unique_book_indices, total_chars


def build_chapter_fallback_segment(context: ChapterContext) -> dict[str, Any]:
    first_section = context.combined_sections[0]
    last_section = context.combined_sections[-1]
    first_cfi_start, _ = resolve_section_cfi_bounds(first_section)
    _, last_cfi_end = resolve_section_cfi_bounds(last_section)
    return {
        "id": f"{context.id}-fallback",
        "sectionHref": first_section["sectionHref"],
        "cfiStart": first_cfi_start,
        "cfiEnd": last_cfi_end,
        "text": context.title,
        "audioStartMs": context.audio_start_ms,
        "audioEndMs": context.audio_end_ms,
        "confidence": 0.0,
        "words": [],
    }


def build_outputs(payload: dict[str, Any], model_name: str, device: str, segments: list[dict[str, Any]], by_chapter: dict[str, float], matched_chars: int, total_chars: int, warnings: list[str]) -> tuple[dict[str, Any], dict[str, Any]]:
    created_at = int(Path(payload["inputPath"]).stat().st_mtime * 1000) if payload.get("inputPath") else 0
    if not created_at:
        from time import time
        created_at = int(time() * 1000)
    coverage_ratio = matched_chars / total_chars if total_chars else 0.0
    overall_confidence = sum(by_chapter.values()) / len(by_chapter) if by_chapter else 0.0
    has_word_data = any(segment.get("words") for segment in segments)
    has_fallback = any(not segment.get("words") for segment in segments)
    map_payload = {
        "id": f"map-{payload['bookHash']}-{payload['audioHash']}",
        "version": 2,
        "bookHash": payload["bookHash"],
        "audioHash": payload["audioHash"],
        "language": payload.get("language"),
        "granularity": "word" if has_word_data else "chapter",
        "status": "partial" if has_fallback else "ready",
        "coverage": {
            "matchedChars": matched_chars,
            "totalChars": total_chars,
            "matchedRatio": coverage_ratio,
        },
        "confidence": {
            "overall": overall_confidence,
            "byChapter": by_chapter,
        },
        "segments": segments,
        "createdAt": created_at,
        "updatedAt": created_at,
    }
    report_payload = {
        "bookHash": payload["bookHash"],
        "audioHash": payload["audioHash"],
        "runId": payload["runId"],
        "phase": "ready",
        "model": model_name,
        "device": device,
        "coverage": map_payload["coverage"],
        "confidence": map_payload["confidence"],
        "warnings": warnings,
        "errors": [],
        "createdAt": created_at,
        "updatedAt": created_at,
    }
    return map_payload, report_payload


def run(args: argparse.Namespace) -> None:
    ensure_ffmpeg_on_path()
    import nltk
    import torch
    import whisperx

    payload = load_alignment_input(args.input)
    payload["bookHash"] = args.book_hash
    payload["audioHash"] = args.audio_hash
    payload["runId"] = args.run_id
    payload["inputPath"] = args.input

    nltk.download("punkt_tab", quiet=True)

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        emit_progress("transcribing", 0.01, "WARNING: Running on CPU — install CUDA PyTorch for GPU acceleration (see docs)")
    compute_type = args.compute_type or ("float16" if device == "cuda" else "int8")
    model_dir = args.model_dir or str((Path.home() / ".cache" / "hermes-audio-sync").resolve())
    Path(model_dir).mkdir(parents=True, exist_ok=True)

    emit_progress("transcribing", 0.02, f"Loading WhisperX model '{args.model}' on {device} ({compute_type})")
    model = whisperx.load_model(args.model, device, compute_type=compute_type, download_root=model_dir, language=payload.get("language"))

    emit_progress("importing", 0.08, "Loading audiobook audio")
    audio = whisperx.load_audio(args.audio)
    chapter_contexts = build_chapter_contexts(payload)
    limit_chapters = args.limit_chapters or 0
    if limit_chapters > 0:
        chapter_contexts = chapter_contexts[:limit_chapters]

    if not chapter_contexts:
        raise HelperError("Alignment input produced no usable chapter contexts")

    align_model = None
    align_metadata = None
    warnings: list[str] = []
    by_chapter: dict[str, float] = {}
    segments: list[dict[str, Any]] = []
    matched_chars = 0
    total_chars = sum(len(context.combined_text) for context in chapter_contexts)

    for index, context in enumerate(chapter_contexts):
        chapter_progress_base = index / len(chapter_contexts);
        emit_progress("transcribing", 0.1 + chapter_progress_base * 0.25, f"Transcribing {context.title}")
        audio_chunk, transcription = transcribe_audio_chunk(
            model,
            audio,
            context,
            payload.get("language"),
            args.batch_size,
            args.chunk_size,
        )
        if align_model is None and transcription.get("segments"):
            emit_progress("aligning", 0.2 + chapter_progress_base * 0.2, "Loading alignment model")
            align_model, align_metadata = whisperx.load_align_model(
                language_code=payload.get("language") or transcription.get("language") or "en",
                device=device,
                model_dir=model_dir,
            )
        if align_model is None:
            warnings.append(f"No transcript produced for {context.title}; using chapter fallback.")
            by_chapter[context.id] = 0.0
            segments.append(build_chapter_fallback_segment(context))
            continue

        emit_progress("aligning", 0.35 + chapter_progress_base * 0.2, f"Aligning words for {context.title}")
        aligned = align_transcription(
            whisperx,
            align_model,
            align_metadata,
            audio_chunk,
            transcription,
            device,
        )

        emit_progress("matching", 0.55 + chapter_progress_base * 0.35, f"Matching transcript to book text for {context.title}")
        chapter_segments, matched_ratio, unique_book_indices, _ = build_word_segments(context, aligned, payload.get("language"))
        if not chapter_segments or matched_ratio < args.min_word_match_ratio:
            warnings.append(f"Low-confidence word alignment for {context.title}; using chapter fallback.")
            by_chapter[context.id] = 0.0
            segments.append(build_chapter_fallback_segment(context))
            continue

        segments.extend(chapter_segments)
        chapter_matched_chars = sum(len(context.book_tokens[i].text) for i in unique_book_indices)
        matched_chars += chapter_matched_chars
        by_chapter[context.id] = matched_ratio

    emit_progress("compacting", 0.96, "Writing sync artifacts")
    map_payload, report_payload = build_outputs(payload, args.model, device, segments, by_chapter, matched_chars, total_chars, warnings)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(map_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    emit_progress("ready", 1.0, "Generated WhisperX audiobook sync")


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--book-hash", required=True)
    parser.add_argument("--audio-hash", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--model", default=os.environ.get("HERMES_AUDIO_SYNC_MODEL", "large-v3"))
    parser.add_argument("--model-dir", default=os.environ.get("HERMES_AUDIO_SYNC_MODEL_DIR"))
    parser.add_argument("--device", default=os.environ.get("HERMES_AUDIO_SYNC_DEVICE", "auto"))
    parser.add_argument("--compute-type", default=os.environ.get("HERMES_AUDIO_SYNC_COMPUTE_TYPE"))
    parser.add_argument("--batch-size", type=int, default=int(os.environ.get("HERMES_AUDIO_SYNC_BATCH_SIZE", "8")))
    parser.add_argument("--chunk-size", type=int, default=int(os.environ.get("HERMES_AUDIO_SYNC_CHUNK_SIZE", "20")))
    parser.add_argument("--limit-chapters", type=int, default=int(os.environ.get("HERMES_AUDIO_SYNC_LIMIT_CHAPTERS", "0")))
    parser.add_argument("--min-word-match-ratio", type=float, default=float(os.environ.get("HERMES_AUDIO_SYNC_MIN_WORD_MATCH_RATIO", "0.35")))
    return parser.parse_args(list(argv))


def main(argv: list[str]) -> int:
    try:
        args = parse_args(argv)
        run(args)
        return 0
    except HelperError as exc:
        emit({"event": "error", "detail": str(exc)})
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - surfaced to caller
        emit({"event": "error", "detail": str(exc)})
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
