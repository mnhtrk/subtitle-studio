// ищем ffmpeg/ffprobe сначала в bin рядом с exe (релиз), потом из PATH (разработка)

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

// CREATE_NO_WINDOW для ffmpeg/ffprobe/python чтобы на винде не мигало пустое cmd окно
pub fn hide_console_window(cmd: &mut tokio::process::Command) -> &mut tokio::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // tokio command -> std command -> creation_flags
        cmd.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

#[allow(dead_code)]
pub fn hide_console_window_std(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

static FFMPEG: OnceLock<PathBuf> = OnceLock::new();
static FFPROBE: OnceLock<PathBuf> = OnceLock::new();

fn tool_file_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

// где ищем bundled ffmpeg, порядок важен
fn bin_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("bin"));
            dirs.push(parent.join("resources").join("bin"));
            dirs.push(parent.to_path_buf());
        }
    }
    dirs.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundle-extra").join("bin"),
    );
    dirs
}

fn resolve_tool(base: &str) -> PathBuf {
    let file_name = tool_file_name(base);
    for dir in bin_search_dirs() {
        let candidate = dir.join(&file_name);
        if candidate.is_file() {
            println!("[ffmpeg] bundled {} → {}", base, candidate.display());
            return candidate;
        }
    }
    println!(
        "[ffmpeg] {} не найден в bin/ рядом с приложением, используем PATH",
        base
    );
    PathBuf::from(base)
}

pub fn ffmpeg_program() -> &'static Path {
    FFMPEG.get_or_init(|| resolve_tool("ffmpeg"))
}

pub fn ffprobe_program() -> &'static Path {
    FFPROBE.get_or_init(|| resolve_tool("ffprobe"))
}

pub fn ffmpeg_missing_message() -> String {
    "FFmpeg не найден. Положите ffmpeg.exe и ffprobe.exe в папку bin рядом с приложением \
     (см. src-tauri/bundle-extra/bin в репозитории) или установите FFmpeg в систему."
        .to_string()
}

pub async fn is_ffmpeg_available() -> bool {
    use std::process::Stdio;
    use tokio::process::Command;

    let mut cmd = Command::new(ffmpeg_program());
    cmd.arg("-version").stdout(Stdio::null()).stderr(Stdio::null());
    hide_console_window(&mut cmd);
    match cmd.output().await {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

pub async fn is_ffprobe_available() -> bool {
    use std::process::Stdio;
    use tokio::process::Command;

    let mut cmd = Command::new(ffprobe_program());
    cmd.arg("-version").stdout(Stdio::null()).stderr(Stdio::null());
    hide_console_window(&mut cmd);
    match cmd.output().await {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}
