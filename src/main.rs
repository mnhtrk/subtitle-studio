#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod commands;
mod cache;
mod project;
mod types;  // ← Добавлен импорт модуля типов

use tauri::Manager;
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
        ])
        
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().unwrap();
            let cache_dir = app_data_dir.join("cache");
            std::fs::create_dir_all(&cache_dir).ok();
            
            let cache = cache::Cache::new(cache_dir);
            app.manage(cache);
            
            println!("✅ Subtitle Studio запущен");
            Ok(())
        })
        
        .run(tauri::generate_context!())
        .expect("Ошибка запуска приложения");
}