//! Tauri 宿主：只做「事件外发 + 命令转发」，逻辑一律下沉到 kilo-host（PLAN §3.2 设计原则 1）。
//!
//! 这里刻意不包含任何业务判断：权限解析、SQLite、git、checkpoint 都在 kilo-host 里，
//! 因此本文件可以独立演进成多窗口/托盘/菜单的宿主层，而不牵动协议实现。
use kilo_host::{ipc, store, APP_VERSION, RUNTIME_VERSION, SCHEMA_VERSION};
use tauri::{Emitter, Manager, State};

/// 宿主共享态：一个 SQLite 句柄 + 事件发送器。
struct Host {
    db: store::Store,
}

impl Host {
    fn emit(&self, app: &tauri::AppHandle, name: &str, payload: &ipc::Event) {
        if let Ok(json) = serde_json::to_string(payload) {
            let _ = app.emit(name, json);
        }
    }
}

#[tauri::command]
fn ready(app: tauri::AppHandle, state: State<'_, Host>) -> ipc::Ready {
    let info = ipc::Ready {
        app_version: APP_VERSION.into(),
        runtime_version: RUNTIME_VERSION.into(),
        schema_version: SCHEMA_VERSION,
    };
    state.emit(&app, "ready", &ipc::Event::Ready(info.clone()));
    info
}

#[tauri::command]
fn permission_effective(
    session_id: String,
    mode: String,
    state: State<'_, Host>,
) -> Result<Vec<ipc::Effective>, String> {
    // 分层取最严（global→project→session→mode）由 kilo-host 判定，UI 只显示结果
    state.db.effective(&session_id, &mode).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let db = store::Store::open(&dir.join("kilo-desktop.db")).map_err(|e| e.to_string())?;
            app.manage(Host { db });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ready, permission_effective])
        .run(tauri::generate_context!())
        .expect("Kilo Desktop 启动失败");
}
