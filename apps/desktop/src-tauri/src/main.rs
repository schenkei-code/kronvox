// KRONVOX desktop — drives the bundled Android runtime via adb, exposed to the
// webview as Tauri commands. No node sidecar: pure Rust + the baked SDK binaries.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod provision;

use base64::{engine::general_purpose, Engine as _};
use std::path::PathBuf;
use std::process::Command;
use tauri::AppHandle;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn home() -> PathBuf {
    PathBuf::from(
        std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default(),
    )
}

fn kronvox_home() -> PathBuf {
    if let Ok(h) = std::env::var("KRONVOX_HOME") {
        if !h.is_empty() {
            return PathBuf::from(h);
        }
    }
    home().join(".kronvox")
}

fn bin(rel: &[&str], win_name: &str, unix_name: &str) -> PathBuf {
    let mut p = kronvox_home().join("sdk");
    for r in rel {
        p = p.join(r);
    }
    p.join(if cfg!(windows) { win_name } else { unix_name })
}

fn adb_path() -> PathBuf {
    if let Ok(a) = std::env::var("KRONVOX_ADB") {
        if !a.is_empty() {
            return PathBuf::from(a);
        }
    }
    bin(&["platform-tools"], "adb.exe", "adb")
}

fn emulator_path() -> PathBuf {
    bin(&["emulator"], "emulator.exe", "emulator")
}

fn cmd(path: PathBuf) -> Command {
    let c = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = c;
        c.creation_flags(CREATE_NO_WINDOW);
        return c;
    }
    #[allow(unreachable_code)]
    c
}

fn serial() -> String {
    if let Ok(s) = std::env::var("KRONVOX_SERIAL") {
        if !s.is_empty() {
            return s;
        }
    }
    if let Ok(out) = cmd(adb_path()).arg("devices").output() {
        let s = String::from_utf8_lossy(&out.stdout);
        for line in s.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 && parts[1] == "device" {
                return parts[0].to_string();
            }
        }
    }
    "emulator-5554".to_string()
}

fn adb(args: &[&str]) -> Result<Vec<u8>, String> {
    let s = serial();
    let mut a: Vec<String> = vec!["-s".into(), s];
    for x in args {
        a.push((*x).into());
    }
    let out = cmd(adb_path())
        .args(&a)
        .output()
        .map_err(|e| format!("adb spawn failed ({}): {}", adb_path().display(), e))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(out.stdout)
}

#[tauri::command]
fn screenshot() -> Result<String, String> {
    let png = adb(&["exec-out", "screencap", "-p"])?;
    Ok(general_purpose::STANDARD.encode(png))
}

#[tauri::command]
fn screen_size() -> Result<serde_json::Value, String> {
    let out = adb(&["shell", "wm", "size"])?;
    let s = String::from_utf8_lossy(&out);
    if let Some(tok) = s.split_whitespace().find(|w| w.contains('x')) {
        let parts: Vec<&str> = tok.split('x').collect();
        if parts.len() == 2 {
            if let (Ok(w), Ok(h)) = (parts[0].trim().parse::<i64>(), parts[1].trim().parse::<i64>()) {
                return Ok(serde_json::json!({ "width": w, "height": h }));
            }
        }
    }
    Err(format!("could not parse size from: {}", s.trim()))
}

#[tauri::command]
fn tap(x: i64, y: i64) -> Result<(), String> {
    adb(&["shell", "input", "tap", &x.to_string(), &y.to_string()])?;
    Ok(())
}

#[tauri::command]
fn swipe(x1: i64, y1: i64, x2: i64, y2: i64, ms: i64) -> Result<(), String> {
    adb(&[
        "shell", "input", "swipe", &x1.to_string(), &y1.to_string(), &x2.to_string(),
        &y2.to_string(), &ms.to_string(),
    ])?;
    Ok(())
}

// A valid Android package name (guards values handed to `adb shell`).
fn valid_package(p: &str) -> bool {
    let segs: Vec<&str> = p.split('.').collect();
    if segs.len() < 2 {
        return false;
    }
    segs.iter().all(|s| {
        let mut chars = s.chars();
        matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
            && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    })
}

#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    // Escape anything the device shell could interpret; space -> %s (input text convention).
    let escaped: String = text
        .chars()
        .map(|c| match c {
            ' ' => "%s".to_string(),
            '\\' | '"' | '\'' | '`' | '$' | '&' | '|' | ';' | '<' | '>' | '(' | ')' | '*' | '?'
            | '~' | '#' | '!' | '\n' | '\r' => format!("\\{}", c),
            other => other.to_string(),
        })
        .collect();
    adb(&["shell", "input", "text", &escaped])?;
    Ok(())
}

#[tauri::command]
fn press_key(key: String) -> Result<(), String> {
    let code = match key.to_lowercase().as_str() {
        "back" => 4,
        "home" => 3,
        "enter" => 66,
        "delete" => 67,
        "tab" => 61,
        "space" => 62,
        "recent" => 187,
        "menu" => 82,
        other => other.parse::<i32>().map_err(|_| format!("unknown key: {}", other))?,
    };
    adb(&["shell", "input", "keyevent", &code.to_string()])?;
    Ok(())
}

#[tauri::command]
fn open_app(package: String) -> Result<(), String> {
    if !valid_package(&package) {
        return Err(format!("invalid package name: {}", package));
    }
    adb(&["shell", "monkey", "-p", &package, "-c", "android.intent.category.LAUNCHER", "1"])?;
    Ok(())
}

#[tauri::command]
fn boot_status() -> Result<String, String> {
    let dev = cmd(adb_path())
        .arg("devices")
        .output()
        .map_err(|e| e.to_string())?;
    let ds = String::from_utf8_lossy(&dev.stdout);
    let online = ds.lines().skip(1).any(|l| {
        let p: Vec<&str> = l.split_whitespace().collect();
        p.len() >= 2 && p[1] == "device"
    });
    if !online {
        return Ok("no_device".into());
    }
    let bc = adb(&["shell", "getprop", "sys.boot_completed"]).unwrap_or_default();
    if String::from_utf8_lossy(&bc).trim() == "1" {
        Ok("ready".into())
    } else {
        Ok("booting".into())
    }
}

#[tauri::command]
fn start_device() -> Result<String, String> {
    // already online?
    if boot_status().unwrap_or_else(|_| "no_device".into()) != "no_device" {
        return Ok("already running".into());
    }
    let avd = std::env::var("KRONVOX_AVD").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "kronvox".into());
    let mut c = cmd(emulator_path());
    c.args(["-avd", &avd, "-netdelay", "none", "-netspeed", "full", "-no-boot-anim", "-no-snapshot"]);
    // point the emulator at our self-contained runtime
    c.env("ANDROID_SDK_ROOT", provision::sdk_root());
    c.env("ANDROID_HOME", provision::sdk_root());
    // use our bundled AVD location if that's where the device lives
    if provision::avd_home().join("kronvox.avd").join("config.ini").exists() {
        c.env("ANDROID_AVD_HOME", provision::avd_home());
    }
    c.spawn().map_err(|e| format!("emulator spawn failed: {}", e))?;
    Ok(format!("booting {}", avd))
}

#[tauri::command]
fn runtime_status() -> String {
    if provision::runtime_ready() {
        "ready".into()
    } else {
        "missing".into()
    }
}

#[tauri::command]
async fn start_setup(app: AppHandle) -> Result<(), String> {
    provision::provision(app).await
}

#[tauri::command]
fn stop_device() -> Result<(), String> {
    let _ = adb(&["emu", "kill"]);
    Ok(())
}

#[tauri::command]
fn mcp_config(client: String) -> String {
    let adb = adb_path().display().to_string().replace('\\', "/");
    let _ = client;
    serde_json::json!({
        "mcpServers": {
            "kronvox": {
                "command": "npx",
                "args": ["-y", "@kronvox/mcp"],
                "env": { "KRONVOX_ADB": adb, "KRONVOX_SERIAL": serial() }
            }
        }
    })
    .to_string()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            screenshot, screen_size, tap, swipe, type_text, press_key, open_app, boot_status,
            start_device, stop_device, mcp_config, runtime_status, start_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running KRONVOX");
}
