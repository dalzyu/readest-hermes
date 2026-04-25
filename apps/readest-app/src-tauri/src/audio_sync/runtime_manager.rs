use std::io::Write;
use std::path::PathBuf;

use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Manager};

/// Manifest URL pattern for the audio sync helper bundles.
/// Fetches from GitHub Releases at the given tag.
const MANIFEST_BASE_URL: &str =
    "https://github.com/dalzyu/readest-hermes/releases/latest/download";


#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperManifest {
    /// Must match `HELPER_RUNTIME_VERSION` for this install to succeed.
    helper_runtime_version: String,
    /// Platform identifier matching `platform_label()`.
    platform: String,
    /// HTTPS URL for the helper executable (PyInstaller single-file).
    helper_url: String,
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
pub fn helper_executable_path(dir: &PathBuf) -> PathBuf {
    if cfg!(target_os = "windows") {
        dir.join("audio-sync-helper.exe")
    } else {
        dir.join("audio-sync-helper")
    }
}

/// Checked in order:
///   1. `HERMES_AUDIO_SYNC_PYTHON` environment variable (power-user override).
///   2. Repo-local `.venv-whisperx` (path baked in at compile time via `CARGO_MANIFEST_DIR`).
///
/// Available in all build profiles.
pub fn discover_venv_python() -> Option<PathBuf> {
    if let Ok(python) = std::env::var("HERMES_AUDIO_SYNC_PYTHON") {
        let p = PathBuf::from(python);
        if p.exists() {
            return Some(p);
        }
    }
    // Repo-local venv: .venv-whisperx adjacent to src-tauri (path baked in at compile time).
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
    if exe.exists() { Some(exe) } else { None }
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

    // Venv/script-mode check: env var override or repo-local venv.
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

    let manifest = fetch_helper_manifest(&manifest_url).await?;
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

    download_to_path(&manifest.helper_url, &staging_path, manifest.helper_size).await?;
    verify_sha256(&staging_path, &manifest.helper_sha256)?;


    let runtime_dir = helper_runtime_dir(&app)
        .ok_or_else(|| "Unable to resolve helper runtime directory".to_string())?;
    std::fs::create_dir_all(&runtime_dir)
        .map_err(|e| format!("Failed to create runtime dir: {e}"))?;
    let final_path = helper_executable_path(&runtime_dir);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staging_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set executable permission: {e}"))?;
    }

    match std::fs::rename(&staging_path, &final_path) {
        Ok(()) => {
            cleanup.active = false;
            Ok(())
        }
        Err(rename_err) => {
            std::fs::copy(&staging_path, &final_path).map_err(|copy_err| {
                format!(
                    "Failed to activate helper (rename {} → {}: {rename_err}; copy fallback also failed: {copy_err})",
                    staging_path.display(),
                    final_path.display()
                )
            })?;
            std::fs::remove_file(&staging_path).map_err(|e| {
                format!("Failed to remove staging file after copy fallback: {e}")
            })?;
            cleanup.active = false;
            Ok(())
        }
    }
}

async fn fetch_helper_manifest(url: &str) -> Result<HelperManifest, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to fetch helper manifest from {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Helper manifest request to {url} returned HTTP {}",
            response.status()
        ));
    }
    response
        .json::<HelperManifest>()
        .await
        .map_err(|e| format!("Failed to parse helper manifest from {url}: {e}"))
}


async fn download_to_path(url: &str, dest: &PathBuf, _expected_size: u64) -> Result<(), String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to start download from {url}: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download from {url} returned HTTP {}", response.status()));
    }

    let mut file = std::fs::File::create(dest)
        .map_err(|e| format!("Failed to create staging file at {}: {e}", dest.display()))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream
        .try_next()
        .await
        .map_err(|e| format!("Download stream error from {url}: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write download chunk: {e}"))?;
    }
    file.flush()
        .map_err(|e| format!("Failed to flush download file: {e}"))?;
    Ok(())
}

fn verify_sha256(path: &PathBuf, expected_hex: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read file for SHA-256 check: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let computed = hex::encode(hasher.finalize());
    if computed.eq_ignore_ascii_case(expected_hex) {
        Ok(())
    } else {
        Err(format!(
            "SHA-256 mismatch: expected {expected_hex}, computed {computed}"
        ))
    }
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
    fn dev_python_path_is_none_in_release() {
        // In release builds the function must always return None.
        #[cfg(not(debug_assertions))]
        assert!(dev_python_path().is_none());
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
    fn verify_minisig_rejects_tampered_bytes() {
        let result = verify_minisig(b"some data", "not a valid sig");
        assert!(result.is_err());
    }
}
