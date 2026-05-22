// где sidecar/ml и venv

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct SidecarPaths {
    pub python_exe: PathBuf,
    pub script_path: PathBuf,
    pub work_dir: PathBuf,
}

pub fn ml_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("sidecar").join("ml"));
            dirs.push(parent.join("resources").join("sidecar").join("ml"));
        }
    }
    dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("sidecar")
            .join("ml"),
    );
    dirs
}

fn venv_python(dir: &Path) -> Option<PathBuf> {
    let win = dir.join(".venv").join("Scripts").join("python.exe");
    if win.exists() {
        return Some(win);
    }
    let unix = dir.join(".venv").join("bin").join("python");
    if unix.exists() {
        return Some(unix);
    }
    None
}

pub fn resolve_script(script_name: &str) -> Result<SidecarPaths, String> {
    let dirs = ml_search_dirs();

    let script_path = dirs
        .iter()
        .map(|d| d.join(script_name))
        .find(|p| p.exists())
        .ok_or_else(|| {
            format!(
                "sidecar/ml не найден (нет {}). Установка: cd src-tauri/sidecar/ml && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt",
                script_name
            )
        })?;

    let python_exe = dirs
        .iter()
        .find_map(|d| venv_python(d.as_path()))
        .ok_or_else(|| {
            "sidecar/ml: .venv не найден. Создайте окружение: cd src-tauri/sidecar/ml && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt".to_string()
        })?;

    let work_dir = script_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    Ok(SidecarPaths {
        python_exe,
        script_path,
        work_dir,
    })
}
