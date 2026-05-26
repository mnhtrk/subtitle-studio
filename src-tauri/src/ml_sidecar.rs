// sidecar/ml - python venv, скрипты, кэш hugging face (в релизе bundle-extra/runtime/ml)

use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub struct SidecarPaths {
    pub python_exe: PathBuf,
    pub script_path: PathBuf,
    pub work_dir: PathBuf,
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn ml_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("sidecar").join("ml"));
            dirs.push(parent.join("resources").join("sidecar").join("ml"));
        }
    }
    dirs.push(manifest_dir().join("bundle-extra").join("runtime").join("ml"));
    dirs.push(manifest_dir().join("sidecar").join("ml"));
    dirs
}

fn hf_cache_search_dirs() -> Vec<PathBuf> {
    ml_search_dirs()
        .into_iter()
        .map(|d| d.join("hf-cache"))
        .collect()
}

fn hf_cache_ready(dir: &Path) -> bool {
    let hub = dir.join("hub");
    if !hub.is_dir() {
        return false;
    }
    std::fs::read_dir(hub)
        .ok()
        .map(|entries| {
            entries.filter_map(|e| e.ok()).any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("models--")
            })
        })
        .unwrap_or(false)
}

/// каталог HF_HOME с моделью пола norwood если есть в сборке
pub fn resolve_hf_home() -> Option<PathBuf> {
    hf_cache_search_dirs()
        .into_iter()
        .find(|d| hf_cache_ready(d.as_path()))
}

// env для python sidecar (vad / gender) + скрытие cmd окна на винде
pub fn apply_python_env(cmd: &mut Command) {
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUNBUFFERED", "1");
    if let Some(hf) = resolve_hf_home() {
        let hf_s = hf.to_string_lossy().into_owned();
        let hub = hf.join("hub");
        cmd.env("HF_HOME", &hf_s);
        cmd.env("TRANSFORMERS_CACHE", &hf_s);
        cmd.env("HUGGINGFACE_HUB_CACHE", hub.to_string_lossy().as_ref());
        println!("[ml] bundled HF cache: {}", hf_s);
    }
    crate::ffmpeg_util::hide_console_window(cmd);
}

fn venv_python(dir: &Path) -> Option<PathBuf> {
    let win = dir.join(".venv").join("Scripts").join("python.exe");
    if win.is_file() {
        return Some(win);
    }
    let unix = dir.join(".venv").join("bin").join("python");
    if unix.is_file() {
        return Some(unix);
    }
    None
}

pub fn resolve_script(script_name: &str) -> Result<SidecarPaths, String> {
    let dirs = ml_search_dirs();

    let script_path = dirs
        .iter()
        .map(|d| d.join(script_name))
        .find(|p| p.is_file())
        .ok_or_else(|| {
            format!(
                "sidecar/ml: нет {}. Для релиза: npm run release:win (или scripts/package-release.ps1)",
                script_name
            )
        })?;

    let work_dir = script_path
        .parent()
        .ok_or_else(|| "sidecar/ml: нет родительской папки у скрипта".to_string())?
        .to_path_buf();

    let python_exe = venv_python(work_dir.as_path()).ok_or_else(|| {
        format!(
            "sidecar/ml: .venv не найден в {}. Сборка установщика: npm run release:win",
            work_dir.display()
        )
    })?;

    Ok(SidecarPaths {
        python_exe,
        script_path,
        work_dir,
    })
}
