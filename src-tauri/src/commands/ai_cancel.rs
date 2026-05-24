use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tokio::io::BufReader;
use tokio::process::{Child, ChildStdout};
use tokio::sync::watch;

pub const AI_OPERATION_CANCELLED: &str = "AI_OPERATION_CANCELLED";

static AI_OPERATION_CANCEL: AtomicBool = AtomicBool::new(false);
static SIDECAR_PIDS: Mutex<Vec<u32>> = Mutex::new(Vec::new());

fn cancel_tx() -> watch::Sender<bool> {
    static TX: OnceLock<watch::Sender<bool>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, _) = watch::channel(false);
        tx
    })
    .clone()
}

pub fn reset_ai_operation_cancel() {
    AI_OPERATION_CANCEL.store(false, Ordering::SeqCst);
    let _ = cancel_tx().send(false);
}

pub fn request_ai_operation_cancel() {
    AI_OPERATION_CANCEL.store(true, Ordering::SeqCst);
    let _ = cancel_tx().send(true);
    kill_registered_sidecars();
    println!("[ai] запрошена отмена операции (VAD/Whisper/постобработка/пол)");
}

pub fn check_ai_operation_cancelled() -> Result<(), String> {
    if AI_OPERATION_CANCEL.load(Ordering::SeqCst) {
        Err(AI_OPERATION_CANCELLED.to_string())
    } else {
        Ok(())
    }
}

pub fn is_ai_operation_cancelled() -> bool {
    AI_OPERATION_CANCEL.load(Ordering::SeqCst)
}

pub fn is_cancelled_error(err: &str) -> bool {
    err == AI_OPERATION_CANCELLED || err.contains(AI_OPERATION_CANCELLED)
}

pub async fn wait_until_cancelled() {
    if AI_OPERATION_CANCEL.load(Ordering::SeqCst) {
        return;
    }
    let mut rx = cancel_tx().subscribe();
    if *rx.borrow_and_update() {
        return;
    }
    let _ = rx.changed().await;
}

pub fn register_sidecar_pid(pid: u32) {
    if let Ok(mut pids) = SIDECAR_PIDS.lock() {
        pids.push(pid);
    }
}

pub fn unregister_sidecar_pid(pid: u32) {
    if let Ok(mut pids) = SIDECAR_PIDS.lock() {
        pids.retain(|p| *p != pid);
    }
}

fn kill_registered_sidecars() {
    if let Ok(mut pids) = SIDECAR_PIDS.lock() {
        for pid in pids.drain(..) {
            kill_pid(pid);
        }
    }
}

fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
    println!("[ai] sidecar pid {} завершён", pid);
}

pub async fn read_sidecar_line(
    lines: &mut tokio::io::Lines<BufReader<ChildStdout>>,
    child: &mut Child,
) -> Result<String, String> {
    tokio::select! {
        biased;
        () = wait_until_cancelled() => {
            let _ = child.kill().await;
            if let Some(pid) = child.id() {
                unregister_sidecar_pid(pid);
            }
            Err(AI_OPERATION_CANCELLED.to_string())
        }
        line = lines.next_line() => match line {
            Ok(Some(l)) => Ok(l),
            Ok(None) => Err("sidecar закрыл stdout".to_string()),
            Err(e) => Err(format!("ошибка чтения sidecar: {}", e)),
        },
    }
}

pub struct SidecarPidGuard {
    pid: u32,
}

impl SidecarPidGuard {
    pub fn new(child: &Child) -> Option<Self> {
        child.id().map(|pid| {
            register_sidecar_pid(pid);
            Self { pid }
        })
    }
}

impl Drop for SidecarPidGuard {
    fn drop(&mut self) {
        unregister_sidecar_pid(self.pid);
    }
}
