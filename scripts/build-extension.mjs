import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "extension");
const outputDir = path.join(root, "dist", "extension");
const archivePath = path.join(root, "dist", "broadcast-agent-extension.zip");
const apiBaseUrl = String(process.env.API_BASE_URL || "").trim().replace(/\/+$/u, "");
const releaseVersion = String(process.env.RELEASE_VERSION || "1.0.0").trim();

if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/iu.test(apiBaseUrl)) {
  throw new Error(
    "API_BASE_URL 必须是已部署代理的 HTTPS 地址，例如 https://example.vercel.app"
  );
}
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/u.test(releaseVersion)) {
  throw new Error("RELEASE_VERSION 必须符合 Chrome 扩展版本格式，例如 1.0.0");
}

const apiOrigin = new URL(apiBaseUrl).origin;
await fs.rm(outputDir, { recursive: true, force: true });
await fs.rm(archivePath, { force: true });
await fs.mkdir(path.dirname(outputDir), { recursive: true });
await fs.cp(sourceDir, outputDir, { recursive: true });
await fs.rm(path.join(outputDir, "README.md"), { force: true });

const backgroundPath = path.join(outputDir, "background.js");
let background = await fs.readFile(backgroundPath, "utf8");
background = background.replace(
  "http://127.0.0.1:8787/v1/chat/completions",
  `${apiBaseUrl}/v1/chat/completions`
);
if (background.includes("http://127.0.0.1:8787/v1/chat/completions")) {
  throw new Error("生产代理地址替换失败");
}
await fs.writeFile(backgroundPath, background);

const manifestPath = path.join(outputDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.version = releaseVersion;
manifest.host_permissions = manifest.host_permissions
  .filter((value) => value !== "http://127.0.0.1:8787/*");
if (!manifest.host_permissions.includes(`${apiOrigin}/*`)) {
  manifest.host_permissions.push(`${apiOrigin}/*`);
}
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`生产扩展已生成：${outputDir}`);
console.log(`API：${apiBaseUrl}`);
console.log(`版本：${releaseVersion}`);
