// Self-contained, JDK-free runtime provisioner.
// On first launch the desktop app downloads the Android emulator + a system image
// directly from Google's repository, lays out the SDK, and writes an AVD by hand —
// no sdkmanager, no Java, no manual steps. Progress is streamed to the webview.

use futures_util::StreamExt;
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

const MAIN_MANIFEST: &str = "https://dl.google.com/android/repository/repository2-3.xml";
const SYSIMG_MANIFEST: &str = "https://dl.google.com/android/repository/sys-img/google_apis/sys-img2-3.xml";
const SYSIMG_PATH: &str = "system-images;android-34;google_apis;x86_64";

#[derive(Clone, Serialize)]
struct Progress {
    phase: String,
    pct: f64,
    msg: String,
}

fn emit(app: &AppHandle, phase: &str, pct: f64, msg: &str) {
    let _ = app.emit(
        "setup-progress",
        Progress { phase: phase.into(), pct, msg: msg.into() },
    );
}

pub fn home() -> PathBuf {
    if let Ok(h) = std::env::var("KRONVOX_HOME") {
        if !h.is_empty() {
            return PathBuf::from(h);
        }
    }
    dirs::home_dir().unwrap_or_default().join(".kronvox")
}
pub fn sdk_root() -> PathBuf {
    home().join("sdk")
}
pub fn avd_home() -> PathBuf {
    home().join("avd")
}

pub fn runtime_ready() -> bool {
    let adb = sdk_root().join("platform-tools").join("adb.exe");
    let emu = sdk_root().join("emulator").join("emulator.exe");
    let sys = sdk_root().join("system-images/android-34/google_apis/x86_64/system.img");
    // accept either our self-contained AVD location or the default ~/.android/avd
    let avd_bundled = avd_home().join("kronvox.avd").join("config.ini");
    let avd_default = dirs::home_dir()
        .unwrap_or_default()
        .join(".android/avd/kronvox.avd/config.ini");
    adb.exists() && emu.exists() && sys.exists() && (avd_bundled.exists() || avd_default.exists())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("kronvox-desktop")
        .build()
        .unwrap_or_default()
}

async fn fetch_text(url: &str) -> Result<String, String> {
    let c = client();
    let r = c.get(url).send().await.map_err(|e| e.to_string())?;
    r.text().await.map_err(|e| e.to_string())
}

/// Resolve a package's archive download URL + size from a Google repo manifest.
/// `want_host_os` = Some("windows") for host tools, None for OS-agnostic packages.
fn resolve_archive(
    manifest_xml: &str,
    manifest_url: &str,
    pkg_path: &str,
    want_host_os: Option<&str>,
) -> Result<(String, u64), String> {
    let doc = roxmltree::Document::parse(manifest_xml).map_err(|e| e.to_string())?;
    let base = {
        let cut = manifest_url.rfind('/').map(|i| i + 1).unwrap_or(0);
        &manifest_url[..cut]
    };
    for pkg in doc
        .descendants()
        .filter(|n| n.tag_name().name() == "remotePackage")
    {
        if pkg.attribute("path") != Some(pkg_path) {
            continue;
        }
        for archive in pkg.descendants().filter(|n| n.tag_name().name() == "archive") {
            // host-os filter
            let host_os = archive
                .children()
                .find(|n| n.tag_name().name() == "host-os")
                .and_then(|n| n.text());
            if let Some(want) = want_host_os {
                if host_os != Some(want) {
                    continue;
                }
            }
            let complete = archive
                .children()
                .find(|n| n.tag_name().name() == "complete")
                .ok_or("no <complete> in archive")?;
            let url = complete
                .children()
                .find(|n| n.tag_name().name() == "url")
                .and_then(|n| n.text())
                .ok_or("no <url> in archive")?;
            let size = complete
                .children()
                .find(|n| n.tag_name().name() == "size")
                .and_then(|n| n.text())
                .and_then(|s| s.trim().parse::<u64>().ok())
                .unwrap_or(0);
            let full = if url.starts_with("http") {
                url.to_string()
            } else {
                format!("{}{}", base, url)
            };
            return Ok((full, size));
        }
    }
    Err(format!("package not found in manifest: {}", pkg_path))
}

async fn download(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    phase: &str,
    label: &str,
) -> Result<(), String> {
    let c = client();
    let resp = c.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download {} -> HTTP {}", url, resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut got: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_emit = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if got - last_emit > 4 * 1024 * 1024 || got == total {
            last_emit = got;
            let pct = if total > 0 { got as f64 / total as f64 * 100.0 } else { 0.0 };
            let mb = got / (1024 * 1024);
            let tmb = total / (1024 * 1024);
            emit(app, phase, pct, &format!("{} … {} / {} MB", label, mb, tmb));
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_zip(app: &AppHandle, zip_path: &Path, dest: &Path, phase: &str, label: &str) -> Result<(), String> {
    let file = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let n = zip.len();
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for i in 0..n {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let rel = match f.enclosed_name() {
            Some(p) => p.to_path_buf(),
            None => continue,
        };
        let out = dest.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = out.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut o = fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut o).map_err(|e| e.to_string())?;
        }
        if i % 50 == 0 || i + 1 == n {
            emit(app, phase, (i + 1) as f64 / n as f64 * 100.0, &format!("{} … entpacke {}/{}", label, i + 1, n));
        }
    }
    Ok(())
}

fn write_avd() -> Result<(), String> {
    let avd_dir = avd_home();
    let data = avd_dir.join("kronvox.avd");
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    let sysdir = "system-images/android-34/google_apis/x86_64/";

    let ini = format!(
        "avd.ini.encoding=UTF-8\npath={}\npath.rel=kronvox.avd\ntarget=android-34\n",
        data.display().to_string().replace('\\', "/")
    );
    fs::write(avd_dir.join("kronvox.ini"), ini).map_err(|e| e.to_string())?;

    let config = format!(
        "avd.ini.encoding=UTF-8\n\
AvdId=kronvox\n\
PlayStore.enabled=false\n\
abi.type=x86_64\n\
hw.cpu.arch=x86_64\n\
hw.cpu.ncore=4\n\
image.sysdir.1={sysdir}\n\
tag.id=google_apis\n\
tag.display=Google APIs\n\
image.androidVersion.api=34\n\
hw.ramSize=2048\n\
vm.heapSize=256\n\
disk.dataPartition.size=6442450944\n\
hw.lcd.density=440\n\
hw.lcd.width=1080\n\
hw.lcd.height=2400\n\
hw.gpu.enabled=yes\n\
hw.gpu.mode=auto\n\
hw.keyboard=yes\n\
hw.audioInput=yes\n\
hw.battery=yes\n\
hw.mainKeys=no\n\
showDeviceFrame=no\n\
skin.dynamic=yes\n",
        sysdir = sysdir
    );
    fs::write(data.join("config.ini"), config).map_err(|e| e.to_string())?;
    Ok(())
}

/// Full provisioning flow. Emits `setup-progress` events and a final `setup-done`.
pub async fn provision(app: AppHandle) -> Result<(), String> {
    let sdk = sdk_root();
    let dl = home().join("dl");
    fs::create_dir_all(&dl).map_err(|e| e.to_string())?;

    // 1) platform-tools (adb)
    if !sdk.join("platform-tools/adb.exe").exists() {
        emit(&app, "tools", 0.0, "Verbinde mit Google…");
        let xml = fetch_text(MAIN_MANIFEST).await?;
        let (url, _) = resolve_archive(&xml, MAIN_MANIFEST, "platform-tools", Some("windows"))?;
        let zipf = dl.join("platform-tools.zip");
        download(&app, &url, &zipf, "tools", "platform-tools").await?;
        extract_zip(&app, &zipf, &sdk, "tools", "platform-tools")?;
        let _ = fs::remove_file(&zipf);
    }

    // 2) emulator
    if !sdk.join("emulator/emulator.exe").exists() {
        emit(&app, "emulator", 0.0, "Lade Emulator…");
        let xml = fetch_text(MAIN_MANIFEST).await?;
        let (url, _) = resolve_archive(&xml, MAIN_MANIFEST, "emulator", Some("windows"))?;
        let zipf = dl.join("emulator.zip");
        download(&app, &url, &zipf, "emulator", "Emulator").await?;
        extract_zip(&app, &zipf, &sdk, "emulator", "Emulator")?;
        let _ = fs::remove_file(&zipf);
    }

    // 3) system image (the big one ~4 GB)
    if !sdk.join("system-images/android-34/google_apis/x86_64/system.img").exists() {
        emit(&app, "image", 0.0, "Lade Android-System…");
        let xml = fetch_text(SYSIMG_MANIFEST).await?;
        let (url, _) = resolve_archive(&xml, SYSIMG_MANIFEST, SYSIMG_PATH, None)?;
        let zipf = dl.join("sysimg.zip");
        download(&app, &url, &zipf, "image", "Android-System").await?;
        // zip root is "x86_64/" -> extract into .../google_apis/
        let target = sdk.join("system-images/android-34/google_apis");
        extract_zip(&app, &zipf, &target, "image", "Android-System")?;
        let _ = fs::remove_file(&zipf);
    }

    // 4) device (AVD)
    emit(&app, "device", 50.0, "Richte dein Handy ein…");
    write_avd()?;
    emit(&app, "device", 100.0, "Fertig.");

    let _ = fs::remove_dir_all(&dl);
    let _ = app.emit("setup-done", true);
    Ok(())
}
