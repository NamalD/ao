// Builds the listen addon. Tests and the Electron bundle both load native/ao-listen.node.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = join(root, "native/Cargo.toml");

export function buildNative() {
  execFileSync("cargo", ["test", "--release", "--manifest-path", manifest, "-p", "ao-listen-core"], { stdio: "inherit", cwd: root });
  execFileSync("cargo", ["build", "--release", "--manifest-path", manifest, "-p", "ao-listen"], { stdio: "inherit", cwd: root });
  copyFileSync(join(root, "native/target/release/libao_listen.so"), join(root, "native/ao-listen.node"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildNative();
