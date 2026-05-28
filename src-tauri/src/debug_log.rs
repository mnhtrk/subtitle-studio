// логи vad/gender/ffmpeg/перевод дублируем в файл проекта
// чтобы видно было что и как распозналось
// active project ставим в open/create, log_line пишет в config/debug.log

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Local;
use once_cell::sync::Lazy;

static ACTIVE_PROJECT: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));
const LOG_FILE_REL: &str = "config/debug.log";
const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn set_active_project(path: &Path) {
    if let Ok(mut guard) = ACTIVE_PROJECT.lock() {
        *guard = Some(path.to_path_buf());
    }
    log_line(&format!("=== активный проект: {} ===", path.display()));
}

pub fn clear_active_project() {
    if let Ok(mut guard) = ACTIVE_PROJECT.lock() {
        *guard = None;
    }
}

fn current_log_path() -> Option<PathBuf> {
    let guard = ACTIVE_PROJECT.lock().ok()?;
    let project = guard.as_ref()?.clone();
    Some(project.join(LOG_FILE_REL))
}

fn ensure_parent(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn rotate_if_needed(path: &Path) {
    let too_big = std::fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false);
    if too_big {
        let backup = path.with_extension("log.1");
        let _ = std::fs::remove_file(&backup);
        let _ = std::fs::rename(path, &backup);
    }
}

fn write_to_log(path: &Path, line: &str) {
    if ensure_parent(path).is_err() {
        return;
    }
    rotate_if_needed(path);
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", line);
    }
}

pub fn log_line(message: &str) {
    let stamped = format!("[{}] {}", Local::now().format("%Y-%m-%d %H:%M:%S%.3f"), message);
    println!("{}", stamped);
    if let Some(path) = current_log_path() {
        write_to_log(&path, &stamped);
    }
}

pub fn log_block(label: &str, body: &str) {
    let header = format!(
        "[{}] === {} ===",
        Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        label
    );
    println!("{}\n{}\n=== /{} ===", header, body, label);
    if let Some(path) = current_log_path() {
        if ensure_parent(&path).is_err() {
            return;
        }
        rotate_if_needed(&path);
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{}", header);
            let _ = writeln!(file, "{}", body);
            let _ = writeln!(file, "=== /{} ===", label);
        }
    }
}
