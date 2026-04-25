use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use mp4ameta::Tag;
use serde::{Deserialize, Serialize};
use tauri::command;

use super::types::{
    AudioAlignmentJobHandle, AudioAlignmentJobState, AudioAlignmentJobStatus,
    AudioChapterSummary, AudioMetadataImportResult, AudioMetadataSummary,
    CancelAlignmentJobRequest, CancelAlignmentJobResult, ImportAudioMetadataRequest,
    InspectAudioMetadataRequest, ReadAlignmentJobStatusRequest, StartAlignmentJobRequest,
};

static JOBS: OnceLock<Mutex<HashMap<String, JobRecord>>> = OnceLock::new();
static NEXT_JOB_ID: AtomicU64 = AtomicU64::new(1);

struct JobRecord {
    status: AudioAlignmentJobStatus,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentInput {
    version: u8,
    language: Option<String>,
    toc: Vec<AlignmentInputTocItem>,
    sections: Vec<AlignmentInputSection>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentInputTocItem {
    label: String,
    href: Option<String>,
    section_index: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentInputSection {
    section_index: usize,
    section_href: String,
    normalized_text: String,
    #[serde(default)]
    anchors: Vec<AlignmentInputAnchor>,
    #[serde(default)]
    tokens: Vec<AlignmentInputToken>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentInputAnchor {
    cfi_start: String,
    cfi_end: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlignmentInputToken {
    cfi_start: String,
    cfi_end: String,
}

#[derive(Debug, Clone)]
struct ChapterMatch {
    audio: AudioChapterSummary,
    start_section: usize,
    end_section: usize,
    confidence: f32,
    label: String,
}

#[derive(Debug, Clone)]
struct TocPoint {
    label: String,
    section_index: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSyncCoverageOut {
    matched_chars: usize,
    total_chars: usize,
    matched_ratio: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSyncConfidenceOut {
    overall: f32,
    by_chapter: HashMap<String, f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSyncSegmentOut {
    id: String,
    section_href: String,
    cfi_start: String,
    cfi_end: String,
    text: String,
    audio_start_ms: u64,
    audio_end_ms: u64,
    confidence: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioSyncMapOut {
    id: String,
    version: u8,
    book_hash: String,
    audio_hash: String,
    language: Option<String>,
    granularity: &'static str,
    status: &'static str,
    coverage: AudioSyncCoverageOut,
    confidence: AudioSyncConfidenceOut,
    segments: Vec<AudioSyncSegmentOut>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioAlignmentReportOut {
    book_hash: String,
    audio_hash: String,
    run_id: String,
    phase: &'static str,
    coverage: AudioSyncCoverageOut,
    confidence: AudioSyncConfidenceOut,
    warnings: Vec<String>,
    errors: Vec<String>,
    created_at: u64,
    updated_at: u64,
}

fn jobs() -> &'static Mutex<HashMap<String, JobRecord>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_millis() as u64
}

fn next_job_id() -> String {
    format!("audio-sync-{}", NEXT_JOB_ID.fetch_add(1, Ordering::Relaxed))
}

fn clone_job_status(job_id: &str) -> Option<AudioAlignmentJobStatus> {
    jobs()
        .lock()
        .ok()
        .and_then(|jobs| jobs.get(job_id).map(|record| record.status.clone()))
}

fn create_job(job_id: &str) -> Arc<AtomicBool> {
    let cancel = Arc::new(AtomicBool::new(false));
    let status = AudioAlignmentJobStatus {
        job_id: job_id.to_string(),
        state: AudioAlignmentJobState::Queued,
        phase: Some("pending".to_string()),
        progress: Some(0.0),
        detail: Some("Queued alignment job".to_string()),
    };
    jobs().lock().expect("jobs lock poisoned").insert(
        job_id.to_string(),
        JobRecord {
            status,
            cancel: cancel.clone(),
        },
    );
    cancel
}

fn update_job(job_id: &str, state: AudioAlignmentJobState, phase: &str, progress: f32, detail: &str) {
    if let Ok(mut jobs) = jobs().lock() {
        if let Some(record) = jobs.get_mut(job_id) {
            record.status.state = state;
            record.status.phase = Some(phase.to_string());
            record.status.progress = Some(progress.clamp(0.0, 1.0));
            record.status.detail = Some(detail.to_string());
        }
    }
}

fn fail_job(job_id: &str, detail: impl Into<String>) {
    let detail = detail.into();
    if let Ok(mut jobs) = jobs().lock() {
        if let Some(record) = jobs.get_mut(job_id) {
            record.status.state = AudioAlignmentJobState::Failed;
            record.status.phase = Some("failed".to_string());
            record.status.progress = Some(1.0);
            record.status.detail = Some(detail);
        }
    }
}

fn is_cancelled(cancel: &Arc<AtomicBool>) -> bool {
    cancel.load(Ordering::Relaxed)
}

fn require_not_cancelled(cancel: &Arc<AtomicBool>) -> Result<(), String> {
    if is_cancelled(cancel) {
        Err("Audio sync job was cancelled".to_string())
    } else {
        Ok(())
    }
}

fn normalize_title(input: &str) -> Vec<String> {
    let cleaned = input
        .chars()
        .map(|ch| if ch.is_alphanumeric() { ch.to_ascii_lowercase() } else { ' ' })
        .collect::<String>();

    cleaned
        .split_whitespace()
        .filter(|token| {
            !matches!(
                *token,
                "chapter"
                    | "track"
                    | "part"
                    | "book"
                    | "volume"
                    | "vol"
                    | "the"
                    | "a"
                    | "an"
            )
        })
        .map(ToOwned::to_owned)
        .collect()
}

fn similarity_score(left: &str, right: &str) -> f32 {
    let left_tokens = normalize_title(left);
    let right_tokens = normalize_title(right);

    if left_tokens.is_empty() || right_tokens.is_empty() {
        return 0.0;
    }

    let left_joined = left_tokens.join(" ");
    let right_joined = right_tokens.join(" ");
    if left_joined == right_joined || left_joined.contains(&right_joined) || right_joined.contains(&left_joined) {
        return 1.0;
    }

    let left_set = left_tokens.iter().collect::<HashSet<_>>();
    let right_set = right_tokens.iter().collect::<HashSet<_>>();
    let intersection = left_set.intersection(&right_set).count() as f32;
    let union = left_set.union(&right_set).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn normalize_href(href: &str) -> &str {
    href.split('#').next().unwrap_or(href)
}

fn toc_points(input: &AlignmentInput) -> Vec<TocPoint> {
    let mut points = input
        .toc
        .iter()
        .filter_map(|item| {
            let section_index = item.section_index.or_else(|| {
                let href = item.href.as_deref()?;
                let normalized = normalize_href(href);
                input
                    .sections
                    .iter()
                    .find(|section| normalize_href(&section.section_href) == normalized)
                    .map(|section| section.section_index)
            })?;
            Some(TocPoint {
                label: item.label.clone(),
                section_index,
            })
        })
        .collect::<Vec<_>>();

    points.sort_by_key(|item| item.section_index);
    points.dedup_by_key(|item| item.section_index);
    points
}

fn chapter_end_ms(chapters: &[AudioChapterSummary], index: usize, duration_ms: u64) -> u64 {
    chapters
        .get(index)
        .and_then(|chapter| chapter.end_ms)
        .or_else(|| chapters.get(index + 1).map(|chapter| chapter.start_ms))
        .unwrap_or(duration_ms)
}

fn resolve_cfi_range(section: &AlignmentInputSection) -> Result<(String, String), String> {
    if let (Some(first), Some(last)) = (section.tokens.first(), section.tokens.last()) {
        return Ok((first.cfi_start.clone(), last.cfi_end.clone()));
    }

    let first = section
        .anchors
        .first()
        .ok_or_else(|| format!("Section {} has no anchors or tokens", section.section_index))?;
    let last = section
        .anchors
        .last()
        .ok_or_else(|| format!("Section {} has no anchors or tokens", section.section_index))?;
    Ok((first.cfi_start.clone(), last.cfi_end.clone()))
}

fn match_audio_chapters(
    input: &AlignmentInput,
    audio_chapters: &[AudioChapterSummary],
    duration_ms: u64,
) -> Result<Vec<ChapterMatch>, String> {
    if input.sections.is_empty() {
        return Err("Alignment input has no sections".to_string());
    }

    if audio_chapters.is_empty() {
        let (cfi_start, _) = resolve_cfi_range(input.sections.first().unwrap())?;
        let last_section = input.sections.last().unwrap();
        let (_, final_cfi_end) = resolve_cfi_range(last_section)?;
        return Ok(vec![ChapterMatch {
            audio: AudioChapterSummary {
                index: 0,
                title: Some("Whole Book".to_string()),
                start_ms: 0,
                end_ms: Some(duration_ms),
            },
            start_section: 0,
            end_section: last_section.section_index,
            confidence: 0.2,
            label: format!("{} → {}", cfi_start, final_cfi_end),
        }]);
    }

    let points = toc_points(input);
    let ordered_starts = if points.is_empty() {
        audio_chapters
            .iter()
            .enumerate()
            .map(|(idx, _)| {
                ((idx * input.sections.len()) / audio_chapters.len())
                    .min(input.sections.len().saturating_sub(1))
            })
            .collect::<Vec<_>>()
    } else {
        let mut cursor = 0usize;
        let mut starts = Vec::with_capacity(audio_chapters.len());
        for (chapter_index, chapter) in audio_chapters.iter().enumerate() {
            let mut chosen_index = None;
            let mut chosen_score = 0.0f32;
            let title = chapter.title.as_deref().unwrap_or("");
            for (point_idx, point) in points.iter().enumerate().skip(cursor) {
                let score = similarity_score(title, &point.label);
                if score > chosen_score {
                    chosen_score = score;
                    chosen_index = Some(point_idx);
                }
            }

            if let Some(point_idx) = chosen_index.filter(|_| chosen_score >= 0.5) {
                cursor = point_idx;
                starts.push(points[point_idx].section_index);
            } else {
                let fallback_point = points
                    .get(chapter_index.min(points.len().saturating_sub(1)))
                    .map(|point| point.section_index)
                    .unwrap_or_else(|| {
                        ((chapter_index * input.sections.len()) / audio_chapters.len())
                            .min(input.sections.len().saturating_sub(1))
                    });
                cursor = points
                    .iter()
                    .position(|point| point.section_index >= fallback_point)
                    .unwrap_or(points.len().saturating_sub(1));
                starts.push(fallback_point);
            }
        }
        starts
    };

    let mut monotonic_starts: Vec<usize> = Vec::with_capacity(ordered_starts.len());
    for start in ordered_starts {
        let next = monotonic_starts
            .last()
            .copied()
            .map(|prev: usize| prev.max(start))
            .unwrap_or(start);
        monotonic_starts.push(next);
    }

    let mut matches = Vec::with_capacity(audio_chapters.len());
    for (idx, chapter) in audio_chapters.iter().enumerate() {
        let start_section = monotonic_starts[idx];
        let next_start = monotonic_starts.get(idx + 1).copied().unwrap_or(input.sections.len());
        let end_section = next_start
            .saturating_sub(1)
            .max(start_section)
            .min(input.sections.len().saturating_sub(1));
        let confidence = points
            .iter()
            .find(|point| point.section_index == start_section)
            .map(|point| similarity_score(chapter.title.as_deref().unwrap_or(""), &point.label))
            .filter(|score| *score > 0.0)
            .unwrap_or(0.35);
        let label = chapter
            .title
            .clone()
            .or_else(|| points.iter().find(|point| point.section_index == start_section).map(|point| point.label.clone()))
            .unwrap_or_else(|| format!("Chapter {}", idx + 1));

        matches.push(ChapterMatch {
            audio: AudioChapterSummary {
                index: chapter.index,
                title: chapter.title.clone(),
                start_ms: chapter.start_ms,
                end_ms: Some(chapter_end_ms(audio_chapters, idx, duration_ms)),
            },
            start_section,
            end_section,
            confidence,
            label,
        });
    }

    Ok(matches)
}

fn build_outputs(
    request: &StartAlignmentJobRequest,
    input: &AlignmentInput,
    metadata: &AudioMetadataSummary,
    chapter_matches: &[ChapterMatch],
    run_id: &str,
) -> Result<(AudioSyncMapOut, AudioAlignmentReportOut), String> {
    let created_at = now_ms();
    let mut segments = Vec::with_capacity(chapter_matches.len());
    let mut by_chapter = HashMap::new();
    let mut covered_sections = HashSet::new();

    for chapter in chapter_matches {
        let start_section = input
            .sections
            .get(chapter.start_section)
            .ok_or_else(|| format!("Invalid start section index {}", chapter.start_section))?;
        let end_section = input
            .sections
            .get(chapter.end_section)
            .ok_or_else(|| format!("Invalid end section index {}", chapter.end_section))?;
        let (cfi_start, _) = resolve_cfi_range(start_section)?;
        let (_, cfi_end) = resolve_cfi_range(end_section)?;
        let text = chapter.label.clone();
        let id = format!("chapter-{}", chapter.audio.index + 1);

        for section_index in chapter.start_section..=chapter.end_section {
            covered_sections.insert(section_index);
        }
        by_chapter.insert(id.clone(), chapter.confidence);

        segments.push(AudioSyncSegmentOut {
            id,
            section_href: start_section.section_href.clone(),
            cfi_start,
            cfi_end,
            text,
            audio_start_ms: chapter.audio.start_ms,
            audio_end_ms: chapter.audio.end_ms.unwrap_or(metadata.duration_ms.unwrap_or(0)),
            confidence: chapter.confidence,
        });
    }

    let total_chars = input
        .sections
        .iter()
        .map(|section| section.normalized_text.len())
        .sum::<usize>();
    let matched_chars = input
        .sections
        .iter()
        .enumerate()
        .filter(|(idx, _)| covered_sections.contains(idx))
        .map(|(_, section)| section.normalized_text.len())
        .sum::<usize>();
    let matched_ratio = if total_chars == 0 {
        0.0
    } else {
        matched_chars as f32 / total_chars as f32
    };
    let overall_confidence = if by_chapter.is_empty() {
        0.0
    } else {
        by_chapter.values().copied().sum::<f32>() / by_chapter.len() as f32
    };

    let coverage = AudioSyncCoverageOut {
        matched_chars,
        total_chars,
        matched_ratio,
    };
    let confidence = AudioSyncConfidenceOut {
        overall: overall_confidence,
        by_chapter,
    };

    let map = AudioSyncMapOut {
        id: format!("map-{run_id}"),
        version: 2,
        book_hash: request.book_hash.clone(),
        audio_hash: request.audio_hash.clone(),
        language: input.language.clone(),
        granularity: "chapter",
        status: "partial",
        coverage: AudioSyncCoverageOut {
            matched_chars: coverage.matched_chars,
            total_chars: coverage.total_chars,
            matched_ratio: coverage.matched_ratio,
        },
        confidence: AudioSyncConfidenceOut {
            overall: confidence.overall,
            by_chapter: confidence.by_chapter.clone(),
        },
        segments,
        created_at,
        updated_at: created_at,
    };

    let report = AudioAlignmentReportOut {
        book_hash: request.book_hash.clone(),
        audio_hash: request.audio_hash.clone(),
        run_id: run_id.to_string(),
        phase: "ready",
        coverage,
        confidence,
        warnings: vec![
            "Generated chapter-level fallback sync from audiobook chapter metadata.".to_string(),
            "Sentence-level alignment is not available in this build yet.".to_string(),
        ],
        errors: Vec::new(),
        created_at,
        updated_at: created_at,
    };

    Ok((map, report))
}

fn inspect_mp4_audio(audio_path: &str) -> Result<AudioMetadataSummary, String> {
    let tag = Tag::read_from_path(audio_path)
        .map_err(|error| format!("Failed to read MP4 metadata from {audio_path}: {error}"))?;
    let duration_ms = tag.duration().as_millis() as u64;
    let chapters = tag
        .chapters()
        .iter()
        .enumerate()
        .map(|(index, chapter)| AudioChapterSummary {
            index,
            title: if chapter.title.trim().is_empty() {
                None
            } else {
                Some(chapter.title.clone())
            },
            start_ms: chapter.start.as_millis() as u64,
            end_ms: None,
        })
        .collect::<Vec<_>>();

    let chapters = chapters
        .iter()
        .enumerate()
        .map(|(index, chapter)| AudioChapterSummary {
            index: chapter.index,
            title: chapter.title.clone(),
            start_ms: chapter.start_ms,
            end_ms: Some(chapter_end_ms(&chapters, index, duration_ms)),
        })
        .collect::<Vec<_>>();

    Ok(AudioMetadataSummary {
        audio_path: audio_path.to_string(),
        title: tag.title().map(ToOwned::to_owned),
        duration_ms: Some(duration_ms),
        sample_rate_hz: tag.sample_rate().map(|rate| rate.hz()),
        channels: tag.channel_config().map(|config| config.channel_count()),
        bitrate_kbps: tag.avg_bitrate().map(|bitrate| bitrate / 1024),
        chapter_count: Some(chapters.len()),
        chapters,
    })
}

fn inspect_mp3_audio(audio_path: &str) -> Result<AudioMetadataSummary, String> {
    use lofty::prelude::*;
    use lofty::read_from_path;

    let tagged_file = read_from_path(audio_path)
        .map_err(|e| format!("Failed to read MP3 metadata from {audio_path}: {e}"))?;
    let properties = tagged_file.properties();
    let duration_ms = properties.duration().as_millis() as u64;
    let title = tagged_file
        .primary_tag()
        .and_then(|tag| tag.title().map(|t| t.to_string()));
    let sample_rate_hz = properties.sample_rate();
    let channels = properties.channels().map(|c| c as u8);
    let bitrate_kbps = properties.audio_bitrate().map(|b| b as u32);

    Ok(AudioMetadataSummary {
        audio_path: audio_path.to_string(),
        title,
        duration_ms: Some(duration_ms),
        sample_rate_hz,
        channels,
        bitrate_kbps,
        // MP3 has no standard chapter format; report zero chapters so callers
        // know alignment will use full-audio mode
        chapter_count: Some(0),
        chapters: vec![],
    })
}

fn inspect_audio(audio_path: &str) -> Result<AudioMetadataSummary, String> {
    let extension = Path::new(audio_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "m4a" | "m4b" => inspect_mp4_audio(audio_path),
        "mp3" => inspect_mp3_audio(audio_path),
        _ => Err(format!("Audio inspection for .{extension} is not supported")),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperEvent {
    event: String,
    phase: Option<String>,
    progress: Option<f32>,
    detail: Option<String>,
}

enum HelperMessage {
    Stdout(String),
    Stderr(String),
}

fn helper_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("audio_sync_helper/whisperx_word_align.py")
}

/// How to launch the WhisperX helper.
enum HelperLaunch {
    /// Repo dev venv: `python whisperx_word_align.py [args]`
    Script { python: String },
    /// App-managed PyInstaller binary: `audio-sync-helper.exe [args]`
    FrozenExe { exe: String },
}

fn resolve_helper(app: &tauri::AppHandle) -> Option<HelperLaunch> {
    // 1. Venv / script mode.
    if let Some(python) = super::runtime_manager::discover_venv_python() {
        return Some(HelperLaunch::Script {
            python: python.to_string_lossy().to_string(),
        });
    }
    // 2. App-managed frozen exe.
    if let Some(exe) = super::runtime_manager::managed_helper_exe(app) {
        return Some(HelperLaunch::FrozenExe {
            exe: exe.to_string_lossy().to_string(),
        });
    }
    None
}

fn drain_helper_messages(
    run_id: &str,
    receiver: &mpsc::Receiver<HelperMessage>,
    stderr: &mut String,
    helper_error: &mut Option<String>,
) {
    while let Ok(message) = receiver.try_recv() {
        match message {
            HelperMessage::Stdout(line) => {
                if let Ok(event) = serde_json::from_str::<HelperEvent>(&line) {
                    match event.event.as_str() {
                        "progress" => {
                            if let Some(phase) = event.phase.as_deref() {
                                update_job(
                                    run_id,
                                    AudioAlignmentJobState::Running,
                                    phase,
                                    event.progress.unwrap_or(0.0),
                                    event.detail.as_deref().unwrap_or("Running WhisperX helper"),
                                );
                            }
                        }
                        "error" => {
                            *helper_error = Some(
                                event
                                    .detail
                                    .unwrap_or_else(|| "WhisperX helper failed without detail".to_string()),
                            );
                        }
                        _ => {}
                    }
                }
            }
            HelperMessage::Stderr(output) => {
                if !output.trim().is_empty() {
                    if !stderr.is_empty() {
                        stderr.push('\n');
                    }
                    stderr.push_str(output.trim());
                }
            }
        }
    }
}

fn try_run_whisperx_helper(
    request: &StartAlignmentJobRequest,
    run_id: &str,
    cancel: &Arc<AtomicBool>,
    app: &tauri::AppHandle,
) -> Result<bool, String> {
    let launch = match resolve_helper(app) {
        Some(l) => l,
        None => return Ok(false),
    };

    let transcript_path = request
        .transcript_path
        .as_ref()
        .ok_or_else(|| "Missing alignment input path".to_string())?;
    let output_path = request
        .output_path
        .as_ref()
        .ok_or_else(|| "Missing sync-map output path".to_string())?;
    let report_path = request
        .report_path
        .as_ref()
        .ok_or_else(|| "Missing alignment report output path".to_string())?;

    let mut command = match &launch {
        HelperLaunch::Script { python } => {
            let script = helper_script_path();
            if !script.exists() {
                return Ok(false);
            }
            let mut cmd = Command::new(python);
            cmd.arg(script);
            cmd
        }
        HelperLaunch::FrozenExe { exe } => Command::new(exe),
    };
    command
        .arg("--input")
        .arg(transcript_path)
        .arg("--audio")
        .arg(&request.audio_path)
        .arg("--output")
        .arg(output_path)
        .arg("--report")
        .arg(report_path)
        .arg("--book-hash")
        .arg(&request.book_hash)
        .arg("--audio-hash")
        .arg(&request.audio_hash)
        .arg("--run-id")
        .arg(run_id);
    if let Some(model) = &request.model {
        command.arg("--model").arg(model);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return Ok(false),
    };

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture WhisperX helper stdout".to_string())?;
    let stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture WhisperX helper stderr".to_string())?;

    let (sender, receiver) = mpsc::channel::<HelperMessage>();
    let stdout_sender = sender.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = stdout_sender.send(HelperMessage::Stdout(line));
        }
    });
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr_pipe);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        let _ = sender.send(HelperMessage::Stderr(output));
    });

    let mut stderr_output = String::new();
    let mut helper_error = None;

    loop {
        require_not_cancelled(cancel)?;
        drain_helper_messages(run_id, &receiver, &mut stderr_output, &mut helper_error);
        match child.try_wait() {
            Ok(Some(status)) => {
                drain_helper_messages(run_id, &receiver, &mut stderr_output, &mut helper_error);
                if status.success() {
                    update_job(
                        run_id,
                        AudioAlignmentJobState::Succeeded,
                        "ready",
                        1.0,
                        "Generated WhisperX audiobook sync",
                    );
                    return Ok(true);
                }
                let detail = helper_error
                    .or_else(|| (!stderr_output.is_empty()).then_some(stderr_output))
                    .unwrap_or_else(|| format!("WhisperX helper exited with status {status}"));
                return Err(detail);
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(error) => return Err(format!("Failed while waiting for WhisperX helper: {error}")),
        }
    }
}


fn run_alignment_job(
    request: StartAlignmentJobRequest,
    run_id: String,
    cancel: Arc<AtomicBool>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    update_job(
        &run_id,
        AudioAlignmentJobState::Running,
        "importing",
        0.1,
        "Loading alignment input",
    );
    require_not_cancelled(&cancel)?;
    let transcript_path = request
        .transcript_path
        .as_ref()
        .ok_or_else(|| "Missing alignment input path".to_string())?;
    let input_text = fs::read_to_string(transcript_path)
        .map_err(|error| format!("Failed to read alignment input {transcript_path}: {error}"))?;
    let input: AlignmentInput = serde_json::from_str(&input_text)
        .map_err(|error| format!("Failed to parse alignment input {transcript_path}: {error}"))?;
    if input.version != 3 {
        return Err(format!("Unsupported alignment input version {}", input.version));
    }

    if try_run_whisperx_helper(&request, &run_id, &cancel, &app)? {
        return Ok(());
    }

    update_job(
        &run_id,
        AudioAlignmentJobState::Running,
        "importing",
        0.25,
        "Inspecting audiobook metadata",
    );
    require_not_cancelled(&cancel)?;
    let metadata = inspect_audio(&request.audio_path)?;

    update_job(
        &run_id,
        AudioAlignmentJobState::Running,
        "matching",
        0.7,
        "Matching audiobook chapters to book sections",
    );
    require_not_cancelled(&cancel)?;
    let chapter_matches = match_audio_chapters(&input, &metadata.chapters, metadata.duration_ms.unwrap_or(0))?;

    update_job(
        &run_id,
        AudioAlignmentJobState::Running,
        "compacting",
        0.9,
        "Writing sync artifacts",
    );
    require_not_cancelled(&cancel)?;
    let (map, report) = build_outputs(&request, &input, &metadata, &chapter_matches, &run_id)?;

    let output_path = request
        .output_path
        .as_ref()
        .ok_or_else(|| "Missing sync-map output path".to_string())?;
    if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create sync-map output directory {}: {error}",
                parent.display()
            )
        })?;
    }
    fs::write(
        output_path,
        serde_json::to_string_pretty(&map).map_err(|error| format!("Failed to serialize sync map: {error}"))?,
    )
    .map_err(|error| format!("Failed to write sync map {output_path}: {error}"))?;

    if let Some(report_path) = request.report_path.as_ref() {
        if let Some(parent) = Path::new(report_path).parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Failed to create alignment report directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        fs::write(
            report_path,
            serde_json::to_string_pretty(&report)
                .map_err(|error| format!("Failed to serialize alignment report: {error}"))?,
        )
        .map_err(|error| format!("Failed to write alignment report {report_path}: {error}"))?;
    }

    require_not_cancelled(&cancel)?;
    update_job(
        &run_id,
        AudioAlignmentJobState::Succeeded,
        "ready",
        1.0,
        "Generated chapter-level audiobook sync",
    );
    Ok(())
}

#[command]
pub async fn inspect_audio_metadata(
    request: InspectAudioMetadataRequest,
) -> Result<AudioMetadataSummary, String> {
    inspect_audio(&request.audio_path)
}

#[command]
pub async fn import_audio_metadata(
    request: ImportAudioMetadataRequest,
) -> Result<AudioMetadataImportResult, String> {
    let summary = inspect_audio(&request.audio_path)?;
    let metadata_json = serde_json::to_string_pretty(&summary)
        .map_err(|error| format!("Failed to serialize audio metadata: {error}"))?;
    if let Some(parent) = Path::new(&request.metadata_path).parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create metadata output directory {}: {error}",
                parent.display()
            )
        })?;
    }
    fs::write(&request.metadata_path, metadata_json)
        .map_err(|error| format!("Failed to write audio metadata {}: {error}", request.metadata_path))?;

    Ok(AudioMetadataImportResult {
        audio_path: request.audio_path,
        metadata_path: request.metadata_path,
        imported_fields: vec![
            "title".to_string(),
            "durationMs".to_string(),
            "sampleRateHz".to_string(),
            "channels".to_string(),
            "bitrateKbps".to_string(),
            "chapterCount".to_string(),
            "chapters".to_string(),
        ],
    })
}

#[command]
pub async fn start_alignment_job(
    app: tauri::AppHandle,
    request: StartAlignmentJobRequest,
) -> Result<AudioAlignmentJobHandle, String> {
    let job_id = next_job_id();
    let cancel = create_job(&job_id);
    let run_id = job_id.clone();
    thread::spawn(move || {
        if let Err(error) = run_alignment_job(request, run_id.clone(), cancel.clone(), app) {
            if is_cancelled(&cancel) {
                update_job(
                    &run_id,
                    AudioAlignmentJobState::Cancelled,
                    "cancelled",
                    1.0,
                    "Audio sync job was cancelled",
                );
            } else {
                fail_job(&run_id, error);
            }
        }
    });

    Ok(AudioAlignmentJobHandle { job_id })
}

#[command]
pub async fn read_alignment_job_status(
    request: ReadAlignmentJobStatusRequest,
) -> Result<AudioAlignmentJobStatus, String> {
    clone_job_status(&request.job_id)
        .ok_or_else(|| format!("Unknown audio sync job {}", request.job_id))
}

#[command]
pub async fn cancel_alignment_job(
    request: CancelAlignmentJobRequest,
) -> Result<CancelAlignmentJobResult, String> {
    let mut jobs = jobs().lock().map_err(|_| "Audio sync job lock poisoned".to_string())?;
    let Some(record) = jobs.get_mut(&request.job_id) else {
        return Ok(CancelAlignmentJobResult {
            job_id: request.job_id,
            cancelled: false,
        });
    };

    record.cancel.store(true, Ordering::Relaxed);
    record.status.state = AudioAlignmentJobState::Cancelled;
    record.status.phase = Some("cancelled".to_string());
    record.status.progress = Some(1.0);
    record.status.detail = Some("Audio sync job cancellation requested".to_string());

    Ok(CancelAlignmentJobResult {
        job_id: request.job_id,
        cancelled: true,
    })
}


#[cfg(test)]
mod tests {
    use super::*;

    fn make_anchor(id: &str) -> AlignmentInputAnchor {
        AlignmentInputAnchor {
            cfi_start: format!("{id}-start"),
            cfi_end: format!("{id}-end"),
        }
    }

    fn make_section(index: usize, href: &str, text: &str) -> AlignmentInputSection {
        AlignmentInputSection {
            section_index: index,
            section_href: href.to_string(),
            normalized_text: text.to_string(),
            anchors: vec![make_anchor(&format!("section-{index}"))],
            tokens: Vec::new(),
        }
    }

    #[test]
    fn matches_audio_chapters_to_toc_sections() {
        let input = AlignmentInput {
            version: 3,
            language: Some("en".to_string()),
            toc: vec![
                AlignmentInputTocItem {
                    label: "Prologue".to_string(),
                    href: Some("prologue.xhtml".to_string()),
                    section_index: Some(0),
                },
                AlignmentInputTocItem {
                    label: "Chapter 1".to_string(),
                    href: Some("chapter1.xhtml".to_string()),
                    section_index: Some(1),
                },
            ],
            sections: vec![
                make_section(0, "prologue.xhtml", "Welcome"),
                make_section(1, "chapter1.xhtml", "Classroom"),
                make_section(2, "chapter1b.xhtml", "Elite"),
            ],
        };
        let chapters = vec![
            AudioChapterSummary {
                index: 0,
                title: Some("Prologue".to_string()),
                start_ms: 0,
                end_ms: Some(60_000),
            },
            AudioChapterSummary {
                index: 1,
                title: Some("Chapter 1".to_string()),
                start_ms: 60_000,
                end_ms: Some(120_000),
            },
        ];

        let matches = match_audio_chapters(&input, &chapters, 120_000).expect("chapter matching succeeds");

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].start_section, 0);
        assert_eq!(matches[0].end_section, 0);
        assert_eq!(matches[1].start_section, 1);
        assert_eq!(matches[1].end_section, 2);
        assert!(matches[0].confidence >= 0.5);
        assert!(matches[1].confidence >= 0.5);
    }

    #[test]
    fn inspect_audio_rejects_unknown_extensions() {
        let result = inspect_audio("sample.flac");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not supported"));
    }

    #[test]
    fn builds_partial_chapter_map_outputs() {
        let input = AlignmentInput {
            version: 3,
            language: Some("en".to_string()),
            toc: Vec::new(),
            sections: vec![
                make_section(0, "s1.xhtml", "One"),
                make_section(1, "s2.xhtml", "Two"),
            ],
        };
        let metadata = AudioMetadataSummary {
            audio_path: "sample.m4b".to_string(),
            title: Some("Sample".to_string()),
            duration_ms: Some(120_000),
            sample_rate_hz: Some(44_100),
            channels: Some(2),
            bitrate_kbps: Some(64),
            chapter_count: Some(2),
            chapters: vec![],
        };
        let matches = vec![
            ChapterMatch {
                audio: AudioChapterSummary {
                    index: 0,
                    title: Some("First".to_string()),
                    start_ms: 0,
                    end_ms: Some(60_000),
                },
                start_section: 0,
                end_section: 0,
                confidence: 0.6,
                label: "First".to_string(),
            },
            ChapterMatch {
                audio: AudioChapterSummary {
                    index: 1,
                    title: Some("Second".to_string()),
                    start_ms: 60_000,
                    end_ms: Some(120_000),
                },
                start_section: 1,
                end_section: 1,
                confidence: 0.7,
                label: "Second".to_string(),
            },
        ];
        let request = StartAlignmentJobRequest {
            book_hash: "book-1".to_string(),
            audio_hash: "audio-1".to_string(),
            audio_path: "sample.m4b".to_string(),
            transcript_path: Some("input.json".to_string()),
            output_path: Some("map.json".to_string()),
            report_path: Some("report.json".to_string()),
            model: None,
        };

        let (map, report) = build_outputs(&request, &input, &metadata, &matches, "run-1")
            .expect("output generation succeeds");

        assert_eq!(map.granularity, "chapter");
        assert_eq!(map.status, "partial");
        assert_eq!(map.segments.len(), 2);
        assert_eq!(map.coverage.matched_chars, 6);
        assert_eq!(map.coverage.total_chars, 6);
        assert_eq!(report.warnings.len(), 2);
        assert_eq!(report.phase, "ready");
    }

    #[test]
    #[ignore = "requires HERMES_AUDIO_SYNC_SAMPLE_M4B"]
    fn inspects_real_sample_m4b_metadata() {
        let path = std::env::var("HERMES_AUDIO_SYNC_SAMPLE_M4B")
            .expect("set HERMES_AUDIO_SYNC_SAMPLE_M4B to a real audiobook path");
        let summary = inspect_audio(&path).expect("real sample metadata inspection succeeds");

        assert!(summary.duration_ms.unwrap_or_default() > 0);
        assert!(summary.chapter_count.unwrap_or_default() > 0);
        assert!(!summary.chapters.is_empty());
    }

    #[test]
    #[ignore = "requires HERMES_AUDIO_SYNC_SAMPLE_M4B and HERMES_AUDIO_SYNC_SAMPLE_INPUT"]
    fn runs_real_sample_alignment_job() {
        let audio_path = std::env::var("HERMES_AUDIO_SYNC_SAMPLE_M4B")
            .expect("set HERMES_AUDIO_SYNC_SAMPLE_M4B to a real audiobook path");
        let input_path = std::env::var("HERMES_AUDIO_SYNC_SAMPLE_INPUT")
            .expect("set HERMES_AUDIO_SYNC_SAMPLE_INPUT to a generated alignment input path");
        let temp_dir = std::env::temp_dir().join(format!("hermes-audio-sync-{}", now_ms()));
        fs::create_dir_all(&temp_dir).expect("create temp output dir");
        let metadata = inspect_audio(&audio_path).expect("inspect real audiobook metadata");
        let mut input_json: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&input_path).expect("read generated alignment input"),
        )
        .expect("alignment input JSON parses");
        input_json["audio"] = serde_json::json!({
            "title": metadata.title,
            "durationMs": metadata.duration_ms,
            "chapters": metadata.chapters,
        });
        let prepared_input_path = temp_dir.join("alignment-input.v3.json");
        fs::write(
            &prepared_input_path,
            serde_json::to_string_pretty(&input_json).expect("serialize prepared alignment input"),
        )
        .expect("write prepared alignment input");

        let output_path = temp_dir.join("sync-map.v2.json");
        let report_path = temp_dir.join("alignment-report.json");
        let request = StartAlignmentJobRequest {
            book_hash: "real-sample-book".to_string(),
            audio_hash: "real-sample-audio".to_string(),
            audio_path,
            transcript_path: Some(prepared_input_path.to_string_lossy().to_string()),
            output_path: Some(output_path.to_string_lossy().to_string()),
            report_path: Some(report_path.to_string_lossy().to_string()),
            model: None,
        };

        run_alignment_job(request, "real-run".to_string(), Arc::new(AtomicBool::new(false)))
            .expect("real sample alignment job succeeds");

        let map: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&output_path).expect("sync map written for real sample"),
        )
        .expect("sync map JSON parses");
        let report: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&report_path).expect("alignment report written for real sample"),
        )
        .expect("alignment report JSON parses");

        assert_eq!(map["granularity"], "word");
        assert!(map["segments"].as_array().is_some_and(|segments| !segments.is_empty()));
        assert!(map["segments"].as_array().is_some_and(|segments| {
            segments.iter().any(|segment| segment["words"].as_array().is_some_and(|words| !words.is_empty()))
        }));
        assert_eq!(report["phase"], "ready");
    }
}