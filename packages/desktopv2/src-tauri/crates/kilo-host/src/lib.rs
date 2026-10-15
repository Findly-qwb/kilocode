//! Kilo Desktop v2 宿主逻辑（PLAN §15）。
//!
//! 这个 crate 只放纯逻辑：不依赖 Tauri、不依赖 WebView、不依赖 GUI。
//! 目的是 `cargo test -p kilo-host` 几秒内就能跑到我们的逻辑本身，
//! 而不是先编译整个 tauri 构建图（PLAN §3.3 的崩溃域与并发约束都要靠测试钉住）。
//!
//! rpi 只允许出现在 `adapt` / 工具缝这一层（PLAN §14「把 rpi 用法收敛在适配层」），
//! 其余模块对上游 0.x 的快速迭代不敏感。

pub mod approval;
pub mod checkpoint;
pub mod error;
pub mod gitx;
pub mod glob;
pub mod ipc;
pub mod perms;
pub mod proc;
pub mod secret;
pub mod store;
pub mod task;


/// 协议版本：`ready` 事件下发，前端不匹配时提示重启应用（PLAN §9.2 末段）。
pub const SCHEMA_VERSION: u32 = 1;
pub const RUNTIME_VERSION: &str = "rpi-0.3.24";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
