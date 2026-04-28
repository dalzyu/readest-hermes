#[cfg(debug_assertions)]
use std::path::PathBuf;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use mp4ameta::Tag;
use serde::Deserialize;
use tauri::{command, AppHandle, Emitter, Manager};

use super::{
    helper_process::HelperProcess,
    types::{
        AudioAlignmentJobHandle, AudioAlignmentJobState, AudioAlignmentJobStatus,
        AudioChapterSummary, AudioMetadataImportResult, AudioMetadataSummary,
        CancelAlignmentJobRequest, CancelAlignmentJobResult, ImportAudioMetadataRequest,
        InspectAudioMetadataRequest, ReadAlignmentJobStatusRequest, StartAlignmentJobRequest,
    },
};

const JOB_TTL_MS: u64 = 5 * 60 * 1_000;
const MAX_JOBS: usize = 50;
const AUDIO_SYNC_JOB_STATUS_EVENT: &str = "audio-sync:job-status";

static JOBS: OnceLock<Mutex<HashMap<String, JobRecord>>> = OnceLock::new();
static NEXT_JOB_ID: AtomicU64 = AtomicU64::new(1);

struct JobRecord {
    status: AudioAlignmentJobStatus,
    cancel: Arc<AtomicBool>,
    helper_process: Arc<Mutex<Option<HelperProcess>>>,
    updated_at_ms: u64,
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

fn is_terminal(state: &AudioAlignmentJobState) -> bool {
    matches!(
        state,
        AudioAlignmentJobState::Succeeded
            | AudioAlignmentJobState::Failed
            | AudioAlignmentJobState::Cancelled
    )
}

fn cleanup_terminal_jobs_locked(jobs: &mut HashMap<String, JobRecord>, now: u64) {
    jobs.retain(|_, record| {
        !(is_terminal(&record.status.state)
            && now.saturating_sub(record.updated_at_ms) > JOB_TTL_MS)
    });

    if jobs.len() <= MAX_JOBS {
        return;
    }

    let mut terminal = jobs
        .iter()
        .filter(|(_, record)| is_terminal(&record.status.state))
        .map(|(job_id, record)| (job_id.clone(), record.updated_at_ms))
        .collect::<Vec<_>>();
    terminal.sort_by_key(|(_, updated_at)| *updated_at);

    for (job_id, _) in terminal {
        if jobs.len() <= MAX_JOBS {
            break;
        }
        jobs.remove(&job_id);
    }
}

fn clone_job_status(job_id: &str) -> Option<AudioAlignmentJobStatus> {
    let now = now_ms();
    jobs().lock().ok().and_then(|mut jobs| {
        cleanup_terminal_jobs_locked(&mut jobs, now);
        jobs.get(job_id).map(|record| record.status.clone())
    })
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
    let now = now_ms();
    jobs().lock().expect("jobs lock poisoned").insert(
        job_id.to_string(),
        JobRecord {
            status,
            cancel: cancel.clone(),
            helper_process: Arc::new(Mutex::new(None)),
            updated_at_ms: now,
        },
    );
    cancel
}

fn helper_process_slot(job_id: &str) -> Option<Arc<Mutex<Option<HelperProcess>>>> {
    jobs()
        .lock()
        .ok()
        .and_then(|jobs| jobs.get(job_id).map(|record| record.helper_process.clone()))
}

fn update_job_status(
    job_id: &str,
    state: AudioAlignmentJobState,
    phase: &str,
    progress: f32,
    detail: &str,
    force: bool,
) -> Option<AudioAlignmentJobStatus> {
    if let Ok(mut jobs) = jobs().lock() {
        if let Some(record) = jobs.get_mut(job_id) {
            let is_current_terminal = is_terminal(&record.status.state);
            let same_state =
                std::mem::discriminant(&record.status.state) == std::mem::discriminant(&state);
            if is_current_terminal && !force && !same_state {
                return None;
            }

            record.status.state = state;
            record.status.phase = Some(phase.to_string());
            record.status.progress = Some(progress.clamp(0.0, 1.0));
            record.status.detail = Some(detail.to_string());
            record.updated_at_ms = now_ms();
            return Some(record.status.clone());
        }
    }
    None
}

fn update_job_and_emit(
    app: &AppHandle,
    job_id: &str,
    state: AudioAlignmentJobState,
    phase: &str,
    progress: f32,
    detail: &str,
    force: bool,
) {
    if let Some(status) = update_job_status(job_id, state, phase, progress, detail, force) {
        let _ = app.emit(AUDIO_SYNC_JOB_STATUS_EVENT, &status);
    }
}

fn fail_job_and_emit(app: &AppHandle, job_id: &str, detail: impl Into<String>) {
    let detail = detail.into();
    update_job_and_emit(
        app,
        job_id,
        AudioAlignmentJobState::Failed,
        "failed",
        1.0,
        &detail,
        true,
    );
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

fn chapter_end_ms(chapters: &[AudioChapterSummary], index: usize, duration_ms: u64) -> u64 {
    chapters
        .get(index)
        .and_then(|chapter| chapter.end_ms)
        .or_else(|| chapters.get(index + 1).map(|chapter| chapter.start_ms))
        .unwrap_or(duration_ms)
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
    let channels = properties.channels();
    let bitrate_kbps = properties.audio_bitrate();

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
        _ => Err(format!(
            "Audio inspection for .{extension} is not supported"
        )),
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

#[cfg(debug_assertions)]
fn helper_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("audio_sync_helper/whisperx_word_align.py")
}

/// How to launch the WhisperX helper.
enum HelperLaunch {
    #[cfg(debug_assertions)]
    /// Repo dev venv: `python whisperx_word_align.py [args]`
    Script { python: String },
    /// App-managed PyInstaller binary: `audio-sync-helper.exe [args]`
    FrozenExe { exe: String },
}

fn resolve_helper(app: &tauri::AppHandle) -> Option<HelperLaunch> {
    // Debug only: use repo dev venv if present.
    #[cfg(debug_assertions)]
    if let Some(python) = super::runtime_manager::discover_venv_python() {
        return Some(HelperLaunch::Script {
            python: python.to_string_lossy().to_string(),
        });
    }
    // Release (and debug fallback): app-managed frozen exe.
    super::runtime_manager::managed_helper_exe(app).map(|exe| HelperLaunch::FrozenExe {
        exe: exe.to_string_lossy().to_string(),
    })
}

fn drain_helper_messages(
    app: &AppHandle,
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
                                update_job_and_emit(
                                    app,
                                    run_id,
                                    AudioAlignmentJobState::Running,
                                    phase,
                                    event.progress.unwrap_or(0.0),
                                    event.detail.as_deref().unwrap_or("Running WhisperX helper"),
                                    false,
                                );
                            }
                        }
                        "error" => {
                            *helper_error = Some(event.detail.unwrap_or_else(|| {
                                "WhisperX helper failed without detail".to_string()
                            }));
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

fn join_reader_handles(mut handles: Vec<JoinHandle<()>>) {
    for handle in handles.drain(..) {
        let _ = handle.join();
    }
}

fn try_run_whisperx_helper(
    request: &StartAlignmentJobRequest,
    run_id: &str,
    cancel: &Arc<AtomicBool>,
    app: &AppHandle,
    helper_slot: Arc<Mutex<Option<HelperProcess>>>,
) -> Result<(), String> {
    let launch =
        resolve_helper(app).ok_or_else(|| "Audio sync helper not installed".to_string())?;

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
        #[cfg(debug_assertions)]
        HelperLaunch::Script { python } => {
            let script = helper_script_path();
            if !script.exists() {
                return Err("Audio sync helper not installed".to_string());
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
    if let Ok(model_dir) = app.path().app_cache_dir() {
        command
            .arg("--model-dir")
            .arg(model_dir.join("AudioSync").join("models"));
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut helper = HelperProcess::spawn(command)
        .map_err(|error| format!("Failed to start audio sync helper: {error}"))?;
    {
        let mut slot = helper_slot
            .lock()
            .map_err(|_| "Audio sync helper process lock poisoned".to_string())?;
        *slot = Some(helper.try_clone_for_kill());
    }

    let stdout = helper
        .child_mut()
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture WhisperX helper stdout".to_string())?;
    let stderr_pipe = helper
        .child_mut()
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture WhisperX helper stderr".to_string())?;

    let (sender, receiver) = mpsc::channel::<HelperMessage>();
    let stdout_sender = sender.clone();
    let mut reader_handles = Vec::with_capacity(2);
    reader_handles.push(thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = stdout_sender.send(HelperMessage::Stdout(line));
        }
    }));
    reader_handles.push(thread::spawn(move || {
        let mut reader = BufReader::new(stderr_pipe);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        let _ = sender.send(HelperMessage::Stderr(output));
    }));

    let mut stderr_output = String::new();
    let mut helper_error = None;

    let result = loop {
        if is_cancelled(cancel) {
            let _ = helper.kill_tree();
            break Err("Audio sync job was cancelled".to_string());
        }
        drain_helper_messages(
            app,
            run_id,
            &receiver,
            &mut stderr_output,
            &mut helper_error,
        );
        match helper.child_mut().try_wait() {
            Ok(Some(status)) => {
                drain_helper_messages(
                    app,
                    run_id,
                    &receiver,
                    &mut stderr_output,
                    &mut helper_error,
                );
                if status.success() {
                    update_job_and_emit(
                        app,
                        run_id,
                        AudioAlignmentJobState::Succeeded,
                        "ready",
                        1.0,
                        "Generated WhisperX audiobook sync",
                        false,
                    );
                    break Ok(());
                }
                let detail = helper_error
                    .or_else(|| (!stderr_output.is_empty()).then_some(stderr_output))
                    .unwrap_or_else(|| format!("WhisperX helper exited with status {status}"));
                break Err(detail);
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(error) => break Err(format!("Failed while waiting for WhisperX helper: {error}")),
        }
    };

    {
        let mut slot = helper_slot
            .lock()
            .map_err(|_| "Audio sync helper process lock poisoned".to_string())?;
        slot.take();
    }
    join_reader_handles(reader_handles);
    result
}

fn run_alignment_job(
    request: StartAlignmentJobRequest,
    run_id: String,
    cancel: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<(), String> {
    update_job_and_emit(
        &app,
        &run_id,
        AudioAlignmentJobState::Running,
        "importing",
        0.1,
        "Loading alignment input",
        false,
    );
    require_not_cancelled(&cancel)?;
    let transcript_path = request
        .transcript_path
        .as_ref()
        .ok_or_else(|| "Missing alignment input path".to_string())?;
    let _input_text = fs::read_to_string(transcript_path)
        .map_err(|error| format!("Failed to read alignment input {transcript_path}: {error}"))?;

    let helper_slot =
        helper_process_slot(&run_id).ok_or_else(|| format!("Unknown audio sync job {run_id}"))?;
    try_run_whisperx_helper(&request, &run_id, &cancel, &app, helper_slot)
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
    fs::write(&request.metadata_path, metadata_json).map_err(|error| {
        format!(
            "Failed to write audio metadata {}: {error}",
            request.metadata_path
        )
    })?;

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
    let now = now_ms();
    if let Ok(mut job_map) = jobs().lock() {
        cleanup_terminal_jobs_locked(&mut job_map, now);
    }

    let job_id = next_job_id();
    let cancel = create_job(&job_id);
    let run_id = job_id.clone();
    thread::spawn(move || {
        if let Err(error) = run_alignment_job(request, run_id.clone(), cancel.clone(), app.clone())
        {
            if is_cancelled(&cancel) {
                update_job_and_emit(
                    &app,
                    &run_id,
                    AudioAlignmentJobState::Cancelled,
                    "cancelled",
                    1.0,
                    "Audio sync job was cancelled",
                    true,
                );
            } else {
                fail_job_and_emit(&app, &run_id, error);
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
    app: tauri::AppHandle,
    request: CancelAlignmentJobRequest,
) -> Result<CancelAlignmentJobResult, String> {
    let helper = {
        let mut jobs = jobs()
            .lock()
            .map_err(|_| "Audio sync job lock poisoned".to_string())?;
        let Some(record) = jobs.get_mut(&request.job_id) else {
            return Ok(CancelAlignmentJobResult {
                job_id: request.job_id,
                cancelled: false,
            });
        };

        record.cancel.store(true, Ordering::Relaxed);
        record.helper_process.clone()
    };

    if let Ok(mut process) = helper.lock() {
        if let Some(proc_handle) = process.as_mut() {
            let _ = proc_handle.kill_tree();
        }
    }

    update_job_and_emit(
        &app,
        &request.job_id,
        AudioAlignmentJobState::Cancelled,
        "cancelled",
        1.0,
        "Audio sync job cancellation requested",
        true,
    );

    Ok(CancelAlignmentJobResult {
        job_id: request.job_id,
        cancelled: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset_jobs() {
        if let Ok(mut jobs) = jobs().lock() {
            jobs.clear();
        }
    }

    #[test]
    fn inspect_audio_rejects_unknown_extensions() {
        let result = inspect_audio("sample.flac");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not supported"));
    }

    #[test]
    fn update_job_refuses_to_overwrite_terminal_state() {
        reset_jobs();
        let job_id = "job-terminal";
        create_job(job_id);

        let _ = update_job_status(
            job_id,
            AudioAlignmentJobState::Cancelled,
            "cancelled",
            1.0,
            "cancelled",
            true,
        );
        let _ = update_job_status(
            job_id,
            AudioAlignmentJobState::Running,
            "matching",
            0.5,
            "should be ignored",
            false,
        );

        let status = clone_job_status(job_id).expect("status exists");
        assert!(matches!(status.state, AudioAlignmentJobState::Cancelled));
        assert_eq!(status.phase.as_deref(), Some("cancelled"));
    }
}
