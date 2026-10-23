#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io::Write, process::Stdio, time::Duration};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::Mutex,
    time::timeout,
};

struct Backend {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    next_id: u64,
}
#[derive(Default)]
struct Runtime(Mutex<Option<Backend>>);
#[derive(Deserialize)]
struct Request {
    method: String,
    path: String,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    body: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct Reply {
    id: u64,
    status: u16,
    headers: BTreeMap<String, String>,
    body: String,
}
const PATHS: &[&str] = &[
    "/graphql",
    "/auth/status",
    "/auth/setup",
    "/auth/open",
    "/auth/unlock",
    "/auth/lock",
    "/auth/pin",
    "/auth/disable-pin",
    "/auth/recover",
    "/databases",
    "/databases/create",
    "/databases/rename",
    "/databases/select",
    "/healthz",
];

async fn stop(backend: &mut Option<Backend>) {
    if let Some(mut process) = backend.take() {
        let _ = process.input.shutdown().await;
        drop(process.input);
        if timeout(Duration::from_secs(10), process.child.wait())
            .await
            .is_err()
        {
            let _ = process.child.kill().await;
            let _ = process.child.wait().await;
        }
    }
}

#[tauri::command]
async fn backend_start(app: tauri::AppHandle, state: State<'_, Runtime>) -> Result<(), String> {
    let mut slot = state.0.lock().await;
    if let Some(process) = slot.as_mut() {
        if process
            .child
            .try_wait()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Ok(());
        }
        stop(&mut slot).await;
    }
    let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data)
        .map_err(|_| "Your local data folder could not be opened.".to_string())?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let name = if cfg!(windows) {
        "gentum-backend.exe"
    } else {
        "gentum-backend"
    };
    let binary = executable
        .parent()
        .ok_or("Application folder is unavailable")?
        .join(name);
    let binary = if binary.exists() {
        binary
    } else {
        resources.join(name)
    };
    let mut command = Command::new(binary);
    command
        .arg("--data-dir")
        .arg(&data)
        .arg("--postgres-dir")
        .arg(resources.join("postgres"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| {
        "The local finance service could not start. Please reinstall the application.".to_string()
    })?;
    let input = child.stdin.take().ok_or("Service input is unavailable")?;
    let mut output = BufReader::new(child.stdout.take().ok_or("Service output is unavailable")?);
    let mut line = String::new();
    let ready = timeout(Duration::from_secs(65), output.read_line(&mut line)).await;
    let valid = matches!(ready, Ok(Ok(n)) if n > 0)
        && serde_json::from_str::<serde_json::Value>(&line)
            .ok()
            .and_then(|v| v.get("ready").and_then(|r| r.as_bool()))
            == Some(true);
    if !valid {
        drop(input);
        if timeout(Duration::from_secs(10), child.wait())
            .await
            .is_err()
        {
            let _ = child.kill().await;
        }
        return Err("Your local database could not start. Close Gentum Finance and try again. Your data has been kept.".into());
    }
    *slot = Some(Backend {
        child,
        input,
        output,
        next_id: 1,
    });
    Ok(())
}

#[tauri::command]
async fn backend_request(request: Request, state: State<'_, Runtime>) -> Result<Reply, String> {
    if !PATHS.contains(&request.path.as_str())
        || !["GET", "POST"].contains(&request.method.as_str())
        || request
            .body
            .as_ref()
            .is_some_and(|b| b.len() > 4 * 1024 * 1024)
    {
        return Err("This request is not supported.".into());
    }
    if request
        .headers
        .keys()
        .any(|h| !["content-type", "x-gentum-database"].contains(&h.to_ascii_lowercase().as_str()))
    {
        return Err("Unsupported request header".into());
    }
    let mut slot = timeout(Duration::from_secs(60), state.0.lock())
        .await
        .map_err(|_| "The local service is busy. Please try again.")?;
    let process = slot
        .as_mut()
        .ok_or("The local service is not ready. Restart Gentum Finance.")?;
    let id = process.next_id;
    process.next_id += 1;
    let mut packet = serde_json::to_vec(&serde_json::json!({"id":id,"method":request.method,"path":request.path,"headers":request.headers,"body":request.body})).map_err(|e| e.to_string())?;
    packet.push(b'\n');
    let result = timeout(Duration::from_secs(60), async {
        process
            .input
            .write_all(&packet)
            .await
            .map_err(|e| e.to_string())?;
        process.input.flush().await.map_err(|e| e.to_string())?;
        let mut line = String::new();
        if process
            .output
            .read_line(&mut line)
            .await
            .map_err(|e| e.to_string())?
            == 0
        {
            return Err("The local service stopped.".to_string());
        }
        let mut reply: Reply = serde_json::from_str(&line)
            .map_err(|_| "Invalid local service response".to_string())?;
        if reply.id != id {
            return Err("Invalid local service response identifier".to_string());
        }
        reply.headers.retain(|key, _| {
            !["set-cookie", "cookie"].contains(&key.to_ascii_lowercase().as_str())
        });
        Ok(reply)
    })
    .await;
    match result {
        Ok(Ok(reply)) => Ok(reply),
        _ => {
            stop(&mut slot).await;
            Err("The local service did not respond. Restart Gentum Finance to continue.".into())
        }
    }
}

#[tauri::command]
async fn save_export(app: tauri::AppHandle, filename: String, data: String) -> Result<(), String> {
    if !["gentum-transactions.zip", "gentum-recovery-code.txt"].contains(&filename.as_str()) {
        return Err("Unsupported export".into());
    }
    if data.len() > 100 * 1024 * 1024 {
        return Err("The export is too large.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "Invalid export data")?;
    let path = app
        .dialog()
        .file()
        .set_file_name(&filename)
        .blocking_save_file();
    if let Some(path) = path {
        let path = path.into_path().map_err(|_| "Choose a local file")?;
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(path)
            .map_err(|_| "The file could not be saved. Choose another location.".to_string())?;
        file.write_all(&bytes)
            .map_err(|_| "The file could not be saved. Please try again.".to_string())?;
    }
    Ok(())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("local-navigation")
                .on_navigation(|webview, url| {
                    webview.label() == "main"
                        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                            || (["http", "https"].contains(&url.scheme())
                                && url.host_str() == Some("tauri.localhost")
                                && url.port().is_none())
                            || (cfg!(debug_assertions)
                                && url.scheme() == "http"
                                && url.host_str() == Some("127.0.0.1")
                                && url.port() == Some(5173)))
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Runtime::default())
        .invoke_handler(tauri::generate_handler![
            backend_start,
            backend_request,
            save_export
        ])
        .build(tauri::generate_context!())
        .expect("Unable to open Gentum Finance");
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            tauri::async_runtime::block_on(async {
                let state = app.state::<Runtime>();
                let mut backend = state.0.lock().await;
                stop(&mut backend).await;
            });
        }
    });
}
