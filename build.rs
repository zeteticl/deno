// Copyright 2018 the Deno authors. All rights reserved. MIT license.

// Run "cargo build -vv" if you want to see gn output.

#![allow(unused_imports)]
#![allow(unused_variables)]

use std::env;
use std::path::{self, Path, PathBuf};
use std::process::exit;
use std::process::Command;

fn is_packaged_goods(gn_out_path: &Path) -> bool {
  gn_out_path.join("../../gen.tar.bz2").exists()
    && gn_out_path.join("ninja.build").exists() == false
}

fn main() {
  let gn_mode = if cfg!(target_os = "windows") {
    // On Windows, we need to link with a release build of libdeno, because
    // rust always uses the release CRT.
    // TODO(piscisaureus): make linking with debug libdeno possible.
    String::from("release")
  } else {
    // Cargo sets PROFILE to either "debug" or "release", which conveniently
    // matches the build modes we support.
    env::var("PROFILE").unwrap()
  };

  let cwd = env::current_dir().unwrap();
  let gn_out_path = cwd.join(format!("target/{}", gn_mode));
  let gn_out_dir = normalize_path(&gn_out_path);

  if cfg!(target_os = "windows") {
    println!("cargo:rustc-link-lib=static=libdeno");
  } else {
    println!("cargo:rustc-link-lib=static=deno");
  }

  // Link the system libraries that libdeno and V8 depend on.
  if cfg!(any(target_os = "macos", target_os = "freebsd")) {
    println!("cargo:rustc-link-lib=dylib=c++");
  } else if cfg!(target_os = "windows") {
    for lib in vec!["dbghelp", "shlwapi", "winmm", "ws2_32"] {
      println!("cargo:rustc-link-lib={}", lib);
    }
  }

  /*
  for (key, value) in env::vars_os() {
    println!("{:?}: {:?}", key, value);
  }
  */

  if !is_packaged_goods(&gn_out_path) {
    println!("normal_git_checkout");
    normal_git_checkout(&gn_out_dir, &gn_out_path, &gn_mode)
  } else {
    println!("is_packaged_goods");
    // Building from a package.
    // We load libdeno from the //gen dir created by tools/package.sh
    // TODO create gen.tar.bz2 in gn

    // Must unpack the gen.tar.bz2
    let tarball = gn_out_path.join("gen.tar.bz2");
    if is_packaged_goods(&gn_out_path) {
      cargo_package(&gn_out_dir, &gn_out_path, &gn_mode);
    } else {
      unimplemented!("does this happen?");
    }
  }
}

fn cargo_package(gn_out_dir: &String, gn_out_path: &Path, gn_mode: &String) {
  // Link with libdeno.a/.lib, which includes V8.
  let root = gn_out_path.join("../..").to_owned();
  let gen_dir = (&root).join("gen").to_owned();

  let root_str = &root.as_os_str().to_str().unwrap();
  let gen_dir_str = gen_dir.into_os_string().into_string().unwrap();

  let status = Command::new("tar")
    .arg("xvjf")
    .arg("gen.tar.bz2")
    .status()
    .expect("tar xvjf");
  assert!(root.join("gen").exists());

  // This helps Rust source files locate the snapshot, source map etc.
  println!("cargo:rustc-env=GN_OUT_DIR={}", root_str);

  println!("cargo:rustc-link-search=native={}", gen_dir_str);
}

fn normal_git_checkout(
  gn_out_dir: &String,
  gn_out_path: &Path,
  gn_mode: &String,
) {
  // Tell Cargo when to re-run this file. We do this first, so these directives
  // can take effect even if something goes wrong later in the build process.
  println!("cargo:rerun-if-env-changed=DENO_BUILD_PATH");
  // TODO: this is obviously not appropriate here.
  println!("cargo:rerun-if-env-changed=APPVEYOR_REPO_COMMIT");

  // Link with libdeno.a/.lib, which includes V8.
  println!("cargo:rustc-link-search=native={}/obj/libdeno", gn_out_dir);

  // This helps Rust source files locate the snapshot, source map etc.
  println!("cargo:rustc-env=GN_OUT_DIR={}", gn_out_dir);

  // Detect if we're being invoked by the rust language server (RLS).
  // Unfortunately we can't detect whether we're being run by `cargo check`.
  let check_only = env::var_os("CARGO")
    .map(PathBuf::from)
    .as_ref()
    .and_then(|p| p.file_stem())
    .and_then(|f| f.to_str())
    .map(|s| s.starts_with("rls"))
    .unwrap_or(false);

  let gn_target;

  if check_only {
    // When RLS is running "cargo check" to analyze the source code, we're not
    // trying to build a working executable, rather we're just compiling all
    // rust code. Therefore, make ninja build only 'msg_generated.rs'.
    gn_target = "msg_rs";

    // Enable the 'check_only' feature, which enables some workarounds in the
    // rust source code to compile successfully without a bundle and snapshot
    println!("cargo:rustc-cfg=feature=\"check-only\"");
  } else {
    // "Full" (non-RLS) build.
    gn_target = "deno_deps";
  }

  if !gn_out_path.join("build.ninja").exists() {
    let status = Command::new("python")
      .env("DENO_BUILD_PATH", &gn_out_dir)
      .env("DENO_BUILD_MODE", &gn_mode)
      .arg("./tools/setup.py")
      .status()
      .expect("setup.py failed");
    assert!(status.success());
  }

  let status = Command::new("python")
    .env("DENO_BUILD_PATH", &gn_out_dir)
    .env("DENO_BUILD_MODE", &gn_mode)
    .arg("./tools/build.py")
    .arg(gn_target)
    .arg("-v")
    .status()
    .expect("build.py failed");
  assert!(status.success());

  /*
  should call ninja here.
  mkdir -p gen/bundle
  cp target/release/gen/bundle/main.js gen/bundle/
  cp target/release/gen/bundle/main.js.map gen/bundle/
  cp target/release/gen/msg_generated.rs gen/
  cp target/release/gen/snapshot_deno.bin gen/
  cp target/release/obj/libdeno/libdeno.a gen/
  tar -cf gen.tar gen/
  bzip2 gen.tar
  */
}

// Utility function to make a path absolute, normalizing it to use forward
// slashes only. The returned value is an owned String, otherwise panics.
fn normalize_path<T: AsRef<Path>>(path: T) -> String {
  path
    .as_ref()
    .to_str()
    .unwrap()
    .to_owned()
    .chars()
    .map(|c| if path::is_separator(c) { '/' } else { c })
    .collect()
}
