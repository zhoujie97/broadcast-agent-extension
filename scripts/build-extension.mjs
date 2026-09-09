import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "extension");
const outputDir = path.join(root, "dist", "extension");
const archivePath = path.join(root, "dist", "broadcast-agent-extension.zip");
const sourceManifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
const releaseVersion = String(process.env.RELEASE_VERSION || sourceManifest.version).trim();

if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/u.test(releaseVersion)) {
  throw new Error("RELEASE_VERSION 必须符合 Chrome 扩展版本格式，例如 1.0.0");
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.rm(archivePath, { force: true });
await fs.mkdir(path.dirname(outputDir), { recursive: true });
await fs.cp(sourceDir, outputDir, { recursive: true });
await fs.rm(path.join(outputDir, "README.md"), { force: true });
await fs.rm(path.join(outputDir, ".DS_Store"), { force: true });

const manifestPath = path.join(outputDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.version = releaseVersion;
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`生产扩展已生成：${outputDir}`);
console.log("API：用户个人 Key 直连 DeepSeek，无需后端");
console.log(`版本：${releaseVersion}`);
