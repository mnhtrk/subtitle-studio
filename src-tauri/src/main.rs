#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod commands;
mod project;
mod types;
mod subtitle_parser; 
mod postprocessing;
mod agent;
mod gender_detection;
mod speaker_gender_rules;
mod ml_sidecar;
mod vad;

use tauri_plugin_sql::{Migration, MigrationKind};

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:projects.db",
                    vec![
                        Migration {
                            version: 20240601,
                            description: "Initial schema for projects",
                            sql: include_str!("../migrations/20240601_init.sql"),
                            kind: MigrationKind::Up,
                        }
                    ],
                )
                .build()
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        
				.plugin(tauri_plugin_dialog::init())

        .invoke_handler(tauri::generate_handler![
            commands::files::open_project,
            commands::files::save_project,
            commands::files::import_media,
            commands::files::export_subtitles,
            commands::files::list_recent_projects,
            commands::ai::save_api_key,
            commands::ai::get_api_key_status,
            commands::ai::transcribe_audio,
            commands::ai::translate_batch,
            commands::project::create_project,
            commands::project::get_project_structure,
            commands::project::get_glossary,
            commands::project::update_glossary,
            commands::project::add_glossary_entry,
            commands::project::update_subtitle_segment,
            commands::media::extract_audio_from_video,
            commands::media::extract_audio_range,
            commands::media::get_media_info,
            commands::files::remove_file_from_project,
            commands::project::create_empty_segments,
            commands::project::insert_subtitle_segment,
            commands::project::delete_subtitle_segment,
            commands::project::get_project_statistics,
            commands::project::find_and_replace_in_subtitles,
            commands::audio::generate_waveform,
            commands::audio::generate_waveform_png,
            commands::audio::probe_media_duration,
            commands::audio::extract_video_preview_frame,
            commands::audio::ensure_faststart_playback_proxy,
            commands::files::list_project_directory_files,
            commands::files::import_existing_subtitles,
            commands::files::parse_subtitle_file,
            commands::files::delete_episode_from_project,
            commands::files::delete_project_file_artifact,
            commands::sync::sync_subtitles_with_video,
            commands::quality::check_translation_quality,
            commands::ai::auto_generate_glossary,
            commands::files::backup_project,
            commands::notifications::show_notification,
            commands::notifications::log_message,
            commands::ai::validate_api_key,
            commands::agent::chat_with_agent,
        ])
        
        .setup(|app| {
            use tauri::Manager;
            // таскбар icon.ico
            if let Ok(icon) =
                tauri::image::Image::from_bytes(include_bytes!("../icons/icon.ico"))
            {
                let icon = icon.to_owned();
                for window in app.webview_windows().values() {
                    let _ = window.set_icon(icon.clone());
                }
            }
            println!("Subtitle Studio запущен");
            Ok(())
        })
        
        .run(tauri::generate_context!())
        .expect("Ошибка запуска приложения");
}