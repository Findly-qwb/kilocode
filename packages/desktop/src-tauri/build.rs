fn main() {
    // tauri-build 要求 externalBin 声明的文件存在；dev 用 env 注入真实后端，
    // 缺产物时生成占位 sidecar（不会被执行）。打包跑 script/sidecar.ts 生成真身。
    let triple = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=TARGET_TRIPLE={triple}");
    let exe = if cfg!(windows) { ".exe" } else { "" };
    let sidecar = std::path::Path::new("binaries").join(format!("kilo-{triple}{exe}"));
    if !sidecar.exists() {
        let _ = std::fs::create_dir_all(sidecar.parent().unwrap());
        let _ = std::fs::write(&sidecar, "#!/bin/sh\nexit 1\n");
    }
    // bundle.resources 的 glob 至少匹配一个文件；打包时 script/sidecar.ts 会放入真实资源。
    for dir in ["tree-sitter", "ffmpeg"] {
        let keep = std::path::Path::new("binaries").join(dir).join(".keep");
        let _ = std::fs::create_dir_all(keep.parent().unwrap());
        let _ = std::fs::write(&keep, "");
    }
    let _ = std::fs::write(std::path::Path::new("binaries").join("kilo-sandbox-mutation-worker.js"), "");
    tauri_build::build()
}
