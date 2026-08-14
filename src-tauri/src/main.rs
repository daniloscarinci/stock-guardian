// Hides the console window that would otherwise appear behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Stored in the OS application-data directory, so the database
            // survives an app update and sits where a backup tool would look.
            let directory = app
                .path()
                .app_data_dir()
                .expect("no application data directory");
            let path = directory.join("stock-guardian.sqlite3");

            let connection = db::open(&path).expect("could not open the database");
            app.manage(db::Database(std::sync::Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::db_select,
            db::db_exec,
            db::db_exec_script,
            db::db_batch,
            db::db_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stock Guardian");
}
