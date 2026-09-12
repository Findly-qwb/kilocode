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

// 自定义附加启动参数/环境变量：设置页保存后由 restart_backend 写入，重拉时生效。
#[derive(Default)]
struct Opts(Mutex<Option<(Vec<String>, Vec<(String, String)>)>>);

static CHILD_ID: Mutex<Option<u32>> = Mutex::new(None);

// 退出时不显式 kill：CLI 侧的 KILO_PARENT_PID 看门狗会回收孤儿子进程。
static STOPPED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn server_info(shared: State<Shared>) -> Option<ServerInfo> {
    shared.0.lock().unwrap().clone()
}

#[tauri::command]
fn restart_backend(app: AppHandle, args: Option<String>, envs: Option<Vec<String>>) -> Result<(), String> {
    let parsed: Vec<String> = args
        .unwrap_or_default()
        .split_ascii_whitespace()
        .map(str::to_string)
        .collect();
    let env_pairs: Vec<(String, String)> = envs
        .unwrap_or_default()
        .iter()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect();
    *app.state::<Opts>().0.lock().unwrap() = Some((parsed, env_pairs));
    let pid = *CHILD_ID.lock().unwrap();
    if let Some(pid) = pid {
        kill(pid);
    }
    Ok(())
}

fn kill(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
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
    check_name(&name)?;
    // 后端扫描 pattern 是 {skill,skills}/**/SKILL.md，单文件 <name>.md 不会被识别。
    let root = std::path::Path::new(&dir).join(".kilo").join("skills").join(&name);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let body = format!("---\nname: {name}\ndescription: {desc}\n---\n\n# {name}\n\n{desc}\n");
    std::fs::write(root.join("SKILL.md"), body).map_err(|e| e.to_string())
}

// 启停 = 在 skill 目录与同级 .disabled/ 间搬移（dot 目录不被 glob 扫描）。
#[tauri::command]
fn toggle_skill(path: String, on: bool) -> Result<(), String> {
    let md = std::path::Path::new(&path);
    let dir = md.parent().ok_or("bad skill path")?;
    let name = dir.file_name().ok_or("bad skill name")?.to_string_lossy().into_owned();
    check_name(&name)?;
    if !dir.exists() {
        return Err(if on { "已禁用副本缺失".into() } else { "技能目录不存在".into() });
    }
    let parent = dir.parent().ok_or("bad skill root")?;
    let off = parent.join(".disabled");
    if on {
        std::fs::rename(off.join(&name), dir).map_err(|e| e.to_string())?;
    } else {
        std::fs::create_dir_all(&off).map_err(|e| e.to_string())?;
        std::fs::rename(dir, off.join(&name)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn write_agent(dir: String, name: String, desc: String, body: String) -> Result<(), String> {
    check_name(&name)?;
    let root = std::path::Path::new(&dir).join(".kilo").join("agent");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let text = format!("---\ndescription: {desc}\nmode: primary\n---\n\n{body}\n");
    std::fs::write(root.join(format!("{name}.md")), text).map_err(|e| e.to_string())
}

// 删除项目 MCP：只改 <dir>/.kilo/config.json 的 mcp 字段；全局配置里的条目不在范围。
#[tauri::command]
fn remove_mcp(dir: String, name: String) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') {
        return Err("MCP 名称不合法".into());
    }
    let path = std::path::Path::new(&dir).join(".kilo").join("config.json");
    if !path.exists() {
        return Err("项目没有 .kilo/config.json".into());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let hit = match v.get_mut("mcp").and_then(|m| m.as_object_mut()) {
        Some(mcp) => mcp.remove(&name).is_some(),
        None => false,
    };
    if !hit {
        return Err(format!("项目配置中没有 MCP「{name}」（可能在全局配置）"));
    }
    let text = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    std::fs::write(&path, format!("{text}\n")).map_err(|e| e.to_string())
}

// Git 写操作后端无 API（/vcs 只读），桌面端直接跑 git CLI。program 固定，args 由前端给。
#[tauri::command]
async fn git_cmd(dir: String, args: Vec<String>) -> Result<String, String> {
    // ponytail: std 阻塞跑在 tauri async 命令的 worker 线程上，git 操作短平，不占主线程
    let out = Command::new("git")
        .arg("-C")
        .arg(&dir)
        .args(&args)
        .output()
        .map_err(|e| format!("git 不可用：{e}"))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    Err(String::from_utf8_lossy(&out.stderr).trim().into())
}

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return Err("名称只允许字母数字与 -_.".into());
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(Shared::default());
            app.manage(Opts::default());
            let handle = app.handle().clone();
            std::thread::spawn(move || supervise(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            server_info, pick_dir, open_url, write_skill, toggle_skill, write_agent, remove_mcp,
            restart_backend, git_cmd
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
    let (program, mut args): (String, Vec<String>) = match std::env::var("KILO_DESKTOP_BACKEND_CMD") {
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

    let (extra_args, extra_env) = app.state::<Opts>().0.lock().unwrap().clone().unwrap_or_default();
    args.extend(extra_args);

    let mut cmd = Command::new(program);
    cmd.args(&args)
        .env("KILO_SERVER_PASSWORD", &password)
        .env("KILO_PARENT_PID", std::process::id().to_string());
    for (k, v) in extra_env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn backend failed: {e}"))?;
    *CHILD_ID.lock().unwrap() = Some(child.id());

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
    *CHILD_ID.lock().unwrap() = None;
    Err(format!("backend exited: {status}"))
}
