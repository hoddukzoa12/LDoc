//! The desktop shell. Each command hands one call of the domain core to the
//! frontend and adds nothing of its own.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod assist;

use ldoc_core::{Answers, DocSummary, Document, Draft, DraftError, Form};
use std::{fs, path::PathBuf};

#[tauri::command]
fn catalog() -> Vec<DocSummary> {
    ldoc_core::catalog()
}

#[tauri::command]
fn form(id: String) -> Option<Form> {
    ldoc_core::form(&id)
}

#[tauri::command]
fn draft(id: String, answers: Answers) -> Result<Draft, DraftError> {
    ldoc_core::draft(&id, &answers)
}

#[tauri::command]
fn export_docx(document: Document, path: PathBuf) -> Result<(), String> {
    ldoc_core::to_docx(&document)
        .and_then(|bytes| fs::write(&path, bytes))
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(assist::Assist::default())
        .invoke_handler(tauri::generate_handler![
            catalog,
            form,
            draft,
            export_docx,
            assist::assist_status,
            assist::assist_preview,
            assist::assist_run,
            assist::assist_sent,
        ])
        .run(tauri::generate_context!())
        .expect("the LDoc window to run");
}
