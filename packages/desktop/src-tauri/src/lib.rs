use rand::RngCore;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    port: u16,
    password: String,
    base_url: String,
}

#[derive(Default)]
struct Shared(Mutex<Option<ServerInfo>>);

// 退出时不显式 kill：CLI 侧的 KILO_PARENT_PID 看门狗会回收孤儿子进程。
static STOPPED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn server_info(shared: State<Shared>) -> Option<ServerInfo> {
    shared.0.lock().unwrap().clone()
}

#[tauri::command]
async fn pick_dir(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    // 非阻塞回调版：sync 命令在主线程 blocking_pick_folder 会卡死整个窗口。
    let (tx, mut rx) = tauri::async_runtime::channel::<Option<FilePath>>(1);
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.try_send(p);
    });
    rx.recv()
        .await
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(&url, None::<String>).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_skill(dir: String, name: String, desc: String) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("技能名只允许字母数字与 -_.".into());
    }
    let root = std::path::Path::new(&dir).join(".kilo").join("skills");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let body = format!("---\nname: {name}\ndescription: {desc}\n---\n\n# {name}\n\n{desc}\n");
    std::fs::write(root.join(format!("{name}.md")), body).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(Shared::default());
            let handle = app.handle().clone();
            std::thread::spawn(move || supervise(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            server_info, pick_dir, open_url, write_skill
        ])
        .build(tauri::generate_context!())
        .expect("failed to build kilo-desktop")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                STOPPED.store(true, Ordering::Relaxed);
            }
        });
}

fn supervise(app: AppHandle) {
    while !STOPPED.load(Ordering::Relaxed) {
        let reason = match run_backend(&app) {
            Ok(()) => "backend exited".to_string(),
            Err(err) => err,
        };
        app.state::<Shared>().0.lock().unwrap().take();
        let _ = app.emit("backend://exit", reason.clone());
        eprintln!("[desktop] {reason}");
        std::thread::sleep(Duration::from_secs(1));
    }
}

fn run_backend(app: &AppHandle) -> Result<(), String> {
    // dev 由 script/dev.ts 注入仓库 CLI 命令；打包版走 externalBin sidecar（M4）。
    let (program, args): (String, Vec<String>) = match std::env::var("KILO_DESKTOP_BACKEND_CMD") {
        Ok(cmd) => {
            let mut words = cmd.split_ascii_whitespace().map(str::to_string);
            let program = words.next().ok_or("empty KILO_DESKTOP_BACKEND_CMD")?;
            (program, words.collect())
        }
        Err(_) => {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let dir = exe.parent().ok_or("no exe dir")?;
            let triple = env!("TARGET_TRIPLE");
            let exe = if cfg!(windows) { ".exe" } else { "" };
            let sidecar = [format!("kilo{exe}"), format!("kilo-{triple}{exe}")]
                .iter()
                .map(|n| dir.join(n))
                .find(|p| p.exists())
                .ok_or("no backend configured and sidecar binary missing")?;
            (
                sidecar.to_string_lossy().into_owned(),
                ["serve", "--port", "0", "--hostname", "127.0.0.1"].map(str::to_string).to_vec(),
            )
        }
    };

    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let password: String = bytes.iter().map(|b| format!("{b:02x}")).collect();

    let mut child = Command::new(program)
        .args(&args)
        .env("KILO_SERVER_PASSWORD", &password)
        .env("KILO_PARENT_PID", std::process::id().to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn backend failed: {e}"))?;

    let stdout = child.stdout.take().ok_or("backend stdout unavailable")?;
    let re = regex::Regex::new(r"listening on http://[\w.]+:(\d+)").expect("static regex");

    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| format!("stdout read failed: {e}"))?;
        eprintln!("[backend] {line}");
        let Some(caps) = re.captures(&line) else { continue };
        let port: u16 = caps[1].parse().map_err(|e| format!("bad port: {e}"))?;
        let info = ServerInfo {
            port,
            password: password.clone(),
            base_url: format!("http://127.0.0.1:{port}"),
        };
        app.state::<Shared>().0.lock().unwrap().replace(info.clone());
        let _ = app.emit("backend://ready", &info);
    }

    let status = child.wait().map_err(|e| format!("wait failed: {e}"))?;
    Err(format!("backend exited: {status}"))
}
