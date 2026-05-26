fn main() {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let bin_dir = manifest_dir.join("bundle-extra").join("bin");
    let ffmpeg = if cfg!(windows) {
        bin_dir.join("ffmpeg.exe")
    } else {
        bin_dir.join("ffmpeg")
    };
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        if !ffmpeg.is_file() {
            println!(
                "cargo:warning=Релиз: нет {:?}. Скопируйте ffmpeg/ffprobe в bundle-extra/bin. Запуск: npm run release:win",
                ffmpeg
            );
        }
        let ml = manifest_dir.join("bundle-extra").join("runtime").join("ml");
        let venv_py = ml.join(".venv").join("Scripts").join("python.exe");
        let hf_hub = ml.join("hf-cache").join("hub");
        if !venv_py.is_file() {
            println!(
                "cargo:warning=Релиз: нет .venv в bundle-extra/runtime/ml. Сначала: npm run release:win"
            );
        }
        if !hf_hub.is_dir() {
            println!(
                "cargo:warning=Релиз: нет hf-cache/hub (модель пола). Сначала: npm run release:win"
            );
        }
    }
    tauri_build::build()
}
