use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::TryStreamExt;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager};

/// Manifest URL pattern for the audio sync helper bundles.
/// Fetches from GitHub Releases at the given tag.
const MANIFEST_BASE_URL: &str = "https://github.com/dalzyu/readest-hermes/releases/latest/download";
const SIGNING_PUBLIC_KEY_B64: &str = "RWRRs1SOFlsNvjDiaLOW+DZDWeNG462IqhW43Ttr/qcg5lCWKLa3Tu/k";
const MANIFEST_FETCH_RETRIES: usize = 3;
const DOWNLOAD_RETRIES: usize = 3;
const NETWORK_RETRY_BASE_DELAY_MS: u64 = 500;
const DOWNLOAD_CHUNK_STALL_TIMEOUT: Duration = Duration::from_secs(30);
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HelperInstallEvent {
    phase: &'static str,
    progress: f32,
    detail: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperManifest {
    /// Must match `HELPER_RUNTIME_VERSION` for this install to succeed.
    helper_runtime_version: String,
    /// Platform identifier matching `platform_label()`.
    platform: String,
    /// HTTPS URL for the helper executable (PyInstaller single-file).
    helper_url: String,
    /// HTTPS URL for the helper minisign signature.
    helper_signature_url: String,
    /// Expected byte size of the helper executable.
    helper_size: u64,
    /// Expected lowercase hex SHA-256 of the helper executable.
    helper_sha256: String,
}

/// Current runtime version string — bumped when the helper format or protocol changes.
pub const HELPER_RUNTIME_VERSION: &str = "1";

/// Platform-architecture label, e.g. "windows-x86_64", "macos-aarch64".
pub fn platform_label() -> String {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "unknown"
    };
    format!("{os}-{arch}")
}

/// Canonical app-managed directory for the helper runtime.
/// Layout: `{AppData}/Hermes/AudioSync/runtime/{platform}-{arch}/{version}/`
pub fn helper_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| {
        dir.join("AudioSync")
            .join("runtime")
            .join(platform_label())
            .join(HELPER_RUNTIME_VERSION)
    })
}

/// Canonical helper executable path within the app-managed runtime dir.
pub fn helper_executable_path(dir: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        dir.join("audio-sync-helper.exe")
    } else {
        dir.join("audio-sync-helper")
    }
}

/// Returns a Python interpreter from the local dev venv.
/// Only available in debug builds — release builds use the app-managed helper.
#[cfg(debug_assertions)]
pub fn discover_venv_python() -> Option<PathBuf> {
    if let Ok(python) = std::env::var("HERMES_AUDIO_SYNC_PYTHON") {
        let p = PathBuf::from(python);
        if p.exists() {
            return Some(p);
        }
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let venv_win = manifest.join("../.venv-whisperx/Scripts/python.exe");
    if venv_win.exists() {
        return Some(venv_win);
    }
    let venv_unix = manifest.join("../.venv-whisperx/bin/python3");
    if venv_unix.exists() {
        return Some(venv_unix);
    }
    None
}

/// Returns the app-managed frozen helper executable if installed.
pub fn managed_helper_exe(app: &AppHandle) -> Option<PathBuf> {
    let dir = helper_runtime_dir(app)?;
    let exe = helper_executable_path(&dir);
    if exe.exists() {
        Some(exe)
    } else {
        None
    }
}

/// Helper install/detection state returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum AudioSyncHelperState {
    /// No helper installed and no dev-mode fallback available.
    NotInstalled,
    /// Repo-local venv or HERMES_AUDIO_SYNC_PYTHON override (script-mode).
    DevMode { python_path: String },
    /// App-managed verified helper is ready at the given directory.
    Ready { helper_dir: String, version: String },
    /// Helper directory exists but is not usable (corrupted / wrong version).
    Failed { reason: String },
}

/// Full helper status record returned by `get_audio_sync_helper_status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSyncHelperStatus {
    pub state: AudioSyncHelperState,
    pub platform: String,
    pub app_managed_dir: Option<String>,
}

/// Returns the current helper installation state without performing any I/O
/// beyond filesystem existence checks.
#[command]
pub async fn get_audio_sync_helper_status(app: AppHandle) -> Result<AudioSyncHelperStatus, String> {
    let platform = platform_label();
    let app_managed_dir = helper_runtime_dir(&app);
    let app_managed_dir_str = app_managed_dir
        .as_ref()
        .map(|p| p.to_string_lossy().to_string());

    // Debug only: check for dev venv before the managed helper.
    #[cfg(debug_assertions)]
    if let Some(dev_python) = discover_venv_python() {
        return Ok(AudioSyncHelperStatus {
            state: AudioSyncHelperState::DevMode {
                python_path: dev_python.to_string_lossy().to_string(),
            },
            platform,
            app_managed_dir: app_managed_dir_str,
        });
    }

    // Check app-managed path.
    if let Some(ref dir) = app_managed_dir {
        let launcher = helper_executable_path(dir);
        if launcher.exists() {
            return Ok(AudioSyncHelperStatus {
                state: AudioSyncHelperState::Ready {
                    helper_dir: dir.to_string_lossy().to_string(),
                    version: HELPER_RUNTIME_VERSION.to_string(),
                },
                platform,
                app_managed_dir: app_managed_dir_str,
            });
        }
    }

    Ok(AudioSyncHelperStatus {
        state: AudioSyncHelperState::NotInstalled,
        platform,
        app_managed_dir: app_managed_dir_str,
    })
}

/// Installs the audio sync helper runtime from a platform-specific manifest.
///
/// The helper is fetched from GitHub Releases, verified with SHA-256,
/// then activated atomically into the app-managed runtime directory.
#[command]
pub async fn install_audio_sync_helper(app: AppHandle) -> Result<(), String> {
    let platform = platform_label();
    let manifest_url = format!("{MANIFEST_BASE_URL}/audio-sync-helper-manifest-{platform}.json");
    let client = build_http_client()?;

    let manifest = fetch_helper_manifest(&client, &manifest_url).await?;
    let _ = app.emit(
        "audio-sync:helper-install",
        &HelperInstallEvent {
            phase: "fetching",
            progress: 0.02,
            detail: "Manifest fetched — starting download".to_string(),
        },
    );

    if manifest.platform != platform {
        return Err(format!(
            "Manifest platform '{}' does not match expected '{}'",
            manifest.platform, platform
        ));
    }
    if manifest.helper_runtime_version != HELPER_RUNTIME_VERSION {
        return Err(format!(
            "Manifest helper runtime version '{}' is not compatible with '{}'",
            manifest.helper_runtime_version, HELPER_RUNTIME_VERSION
        ));
    }
    if manifest.helper_signature_url.trim().is_empty() {
        return Err("Manifest missing helperSignatureUrl".to_string());
    }

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Unable to resolve app cache dir: {e}"))?;
    let staging_dir = cache_dir.join("AudioSync").join("downloads");
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create download staging dir: {e}"))?;

    let exe_filename = if cfg!(target_os = "windows") {
        format!("audio-sync-helper-{platform}.exe.staging")
    } else {
        format!("audio-sync-helper-{platform}.staging")
    };
    let staging_path = staging_dir.join(&exe_filename);

    struct CleanupGuard {
        path: PathBuf,
        active: bool,
    }
    impl Drop for CleanupGuard {
        fn drop(&mut self) {
            if self.active {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }
    let mut cleanup = CleanupGuard {
        path: staging_path.clone(),
        active: true,
    };

    download_to_path(
        &client,
        &manifest.helper_url,
        &staging_path,
        manifest.helper_size,
        &app,
    )
    .await?;

    let _ = app.emit(
        "audio-sync:helper-install",
        &HelperInstallEvent {
            phase: "verifying",
            progress: 0.94,
            detail: "Verifying download integrity".to_string(),
        },
    );
    verify_sha256(&staging_path, &manifest.helper_sha256)?;

    let sig_text = fetch_text_with_retry(
        &client,
        &manifest.helper_signature_url,
        MANIFEST_FETCH_RETRIES,
        "helper signature",
    )
    .await?;
    verify_minisig_path(&staging_path, &sig_text)?;

    let _ = app.emit(
        "audio-sync:helper-install",
        &HelperInstallEvent {
            phase: "installing",
            progress: 0.98,
            detail: "Installing helper".to_string(),
        },
    );

    let runtime_dir = helper_runtime_dir(&app)
        .ok_or_else(|| "Unable to resolve helper runtime directory".to_string())?;
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("Failed to create runtime dir: {e}"))?;
    let final_path = helper_executable_path(&runtime_dir);
    let temp_final_path = final_path.with_extension("tmp");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staging_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set executable permission: {e}"))?;
    }

    std::fs::copy(&staging_path, &temp_final_path).map_err(|e| {
        format!(
            "Failed to copy helper into runtime directory ({} → {}): {e}",
            staging_path.display(),
            temp_final_path.display()
        )
    })?;

    let mut tmp = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&temp_final_path)
        .map_err(|e| format!("Failed to open temporary runtime helper for sync: {e}"))?;
    tmp.flush()
        .map_err(|e| format!("Failed to flush temporary runtime helper: {e}"))?;
    tmp.sync_all()
        .map_err(|e| format!("Failed to sync temporary runtime helper: {e}"))?;

    std::fs::rename(&temp_final_path, &final_path).map_err(|e| {
        format!(
            "Failed to atomically activate helper ({} → {}): {e}",
            temp_final_path.display(),
            final_path.display()
        )
    })?;

    sync_parent_dir(&final_path)?;
    verify_sha256(&final_path, &manifest.helper_sha256)?;

    cleanup.active = false;
    Ok(())
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))
}

async fn fetch_helper_manifest(
    client: &reqwest::Client,
    url: &str,
) -> Result<HelperManifest, String> {
    let body =
        fetch_text_with_retry(client, url, MANIFEST_FETCH_RETRIES, "helper manifest").await?;
    serde_json::from_str::<HelperManifest>(&body)
        .map_err(|e| format!("Failed to parse helper manifest from {url}: {e}"))
}

async fn fetch_text_with_retry(
    client: &reqwest::Client,
    url: &str,
    attempts: usize,
    label: &str,
) -> Result<String, String> {
    let mut last_err = String::new();
    for attempt in 1..=attempts {
        match client.get(url).send().await {
            Ok(response) => {
                if !response.status().is_success() {
                    last_err = format!(
                        "{label} request to {url} returned HTTP {}",
                        response.status()
                    );
                } else {
                    match response.text().await {
                        Ok(text) => return Ok(text),
                        Err(e) => {
                            last_err = format!("Failed to read {label} response from {url}: {e}")
                        }
                    }
                }
            }
            Err(e) => {
                last_err = format!("Failed to fetch {label} from {url}: {e}");
            }
        }
        if attempt < attempts {
            tokio::time::sleep(Duration::from_millis(
                NETWORK_RETRY_BASE_DELAY_MS * (1_u64 << (attempt - 1)),
            ))
            .await;
        }
    }
    Err(last_err)
}

async fn download_to_path(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_size: u64,
    app: &AppHandle,
) -> Result<(), String> {
    let mut last_err = String::new();
    for attempt in 1..=DOWNLOAD_RETRIES {
        let result = download_to_path_once(client, url, dest, expected_size, app).await;
        match result {
            Ok(()) => return Ok(()),
            Err(err) => {
                last_err = err;
                let _ = std::fs::remove_file(dest);
                if attempt < DOWNLOAD_RETRIES {
                    tokio::time::sleep(Duration::from_millis(
                        NETWORK_RETRY_BASE_DELAY_MS * (1_u64 << (attempt - 1)),
                    ))
                    .await;
                }
            }
        }
    }
    Err(last_err)
}

async fn download_to_path_once(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_size: u64,
    app: &AppHandle,
) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to start download from {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Download from {url} returned HTTP {}",
            response.status()
        ));
    }

    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("Failed to create staging file at {}: {e}", dest.display()))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    loop {
        let chunk = tokio::time::timeout(DOWNLOAD_CHUNK_STALL_TIMEOUT, stream.try_next())
            .await
            .map_err(|_| {
                format!(
                    "Download stalled for more than {:?} from {url}",
                    DOWNLOAD_CHUNK_STALL_TIMEOUT
                )
            })?
            .map_err(|e| format!("Download stream error from {url}: {e}"))?;
        let Some(chunk) = chunk else { break };

        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write download chunk: {e}"))?;
        downloaded += chunk.len() as u64;
        if expected_size > 0 {
            let progress = (downloaded as f32 / expected_size as f32).min(0.93);
            let dl_mb = downloaded / 1_048_576;
            let total_mb = expected_size / 1_048_576;
            let _ = app.emit(
                "audio-sync:helper-install",
                &HelperInstallEvent {
                    phase: "downloading",
                    progress,
                    detail: format!("{dl_mb} MB / {total_mb} MB"),
                },
            );
        }
    }
    file.flush()
        .map_err(|e| format!("Failed to flush download file: {e}"))?;
    file.sync_all()
        .map_err(|e| format!("Failed to sync download file: {e}"))?;
    Ok(())
}

fn verify_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};

    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open file for SHA-256 check: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Failed to read file for SHA-256 check: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }

    let computed = hex::encode(hasher.finalize());
    if computed.eq_ignore_ascii_case(expected_hex) {
        Ok(())
    } else {
        Err(format!(
            "SHA-256 mismatch: expected {expected_hex}, computed {computed}"
        ))
    }
}

fn verify_minisig_path(path: &Path, sig_text: &str) -> Result<(), String> {
    let public_key = PublicKey::from_base64(SIGNING_PUBLIC_KEY_B64)
        .map_err(|e| format!("Failed to decode helper signing public key: {e}"))?;
    verify_minisig_with_key(path, sig_text, &public_key)
}

fn verify_minisig_with_key(
    path: &Path,
    sig_text: &str,
    public_key: &PublicKey,
) -> Result<(), String> {
    let signature = Signature::decode(sig_text)
        .map_err(|e| format!("Failed to decode minisign signature: {e}"))?;
    let mut verifier = public_key
        .verify_stream(&signature)
        .map_err(|e| format!("Failed to initialize minisign verification: {e}"))?;
    let mut file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open helper for minisign verification: {e}"))?;
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read helper for minisign verification: {e}"))?;
        if n == 0 {
            break;
        }
        verifier.update(&buffer[..n]);
    }
    verifier
        .finalize()
        .map_err(|e| format!("Minisign verification failed: {e}"))
}

fn sync_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Missing parent directory for {}", path.display()))?;
    let dir = std::fs::OpenOptions::new()
        .read(true)
        .open(parent)
        .map_err(|e| format!("Failed to open runtime directory for sync: {e}"))?;
    dir.sync_all()
        .map_err(|e| format!("Failed to sync runtime directory: {e}"))
}

/// Removes the app-managed helper runtime directory.
/// The dev-mode Python venv is not affected.
#[command]
pub async fn remove_audio_sync_helper(app: AppHandle) -> Result<(), String> {
    let dir = helper_runtime_dir(&app)
        .ok_or_else(|| "Unable to resolve helper runtime directory".to_string())?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Failed to remove helper runtime directory: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_label_is_non_empty_and_has_separator() {
        let label = platform_label();
        assert!(!label.is_empty());
        assert!(
            label.contains('-'),
            "expected platform-arch format, got {label}"
        );
    }

    #[test]
    fn helper_state_serializes_round_trip() {
        for state in [
            AudioSyncHelperState::NotInstalled,
            AudioSyncHelperState::DevMode {
                python_path: "/usr/bin/python3".to_string(),
            },
            AudioSyncHelperState::Ready {
                helper_dir: "/data/audio-sync/runtime/linux-x86_64/1".to_string(),
                version: "1".to_string(),
            },
            AudioSyncHelperState::Failed {
                reason: "corrupted binary".to_string(),
            },
        ] {
            let json = serde_json::to_string(&state).unwrap();
            let round: AudioSyncHelperState = serde_json::from_str(&json).unwrap();
            assert_eq!(state, round, "round-trip failed for {json}");
        }
    }

    #[test]
    fn verify_sha256_rejects_wrong_hash() {
        let dir = std::env::temp_dir();
        let path = dir.join("hermes-test-sha256-check.bin");
        std::fs::write(&path, b"hello world").unwrap();
        let correct = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        let wrong = "0000000000000000000000000000000000000000000000000000000000000000";
        assert!(verify_sha256(&path, correct).is_ok());
        assert!(verify_sha256(&path, wrong).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn verify_minisig_accepts_valid_signature() {
        let public_key =
            PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3")
                .unwrap();
        let signature = "untrusted comment: signature from minisign secret key
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=
trusted comment: timestamp:1633700835\tfile:test\tprehashed
wLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==";

        let dir = std::env::temp_dir();
        let path = dir.join("hermes-test-minisig-valid.bin");
        std::fs::write(&path, b"test").unwrap();
        let result = verify_minisig_with_key(&path, signature, &public_key);
        assert!(result.is_ok());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn verify_minisig_rejects_tampered_bytes() {
        let public_key =
            PublicKey::from_base64("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3")
                .unwrap();
        let signature = "untrusted comment: signature from minisign secret key
RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=
trusted comment: timestamp:1633700835\tfile:test\tprehashed
wLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==";

        let dir = std::env::temp_dir();
        let path = dir.join("hermes-test-minisig-check.bin");
        std::fs::write(&path, b"test!").unwrap();
        let result = verify_minisig_with_key(&path, signature, &public_key);
        assert!(result.is_err());
        let _ = std::fs::remove_file(&path);
    }
}
