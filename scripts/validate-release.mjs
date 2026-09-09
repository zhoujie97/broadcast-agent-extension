import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(root, "dist", "extension");
const requiredFiles = [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js",
  "select-controls.js",
  "transcript-utils.js",
  "stream-utils.js",
  "person-utils.js",
  "privacy.html",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

for (const file of requiredFiles) {
  await fs.access(path.join(extensionDir, file));
}

const manifest = JSON.parse(
  await fs.readFile(path.join(extensionDir, "manifest.json"), "utf8")
);
if (manifest.manifest_version !== 3) throw new Error("必须使用 Manifest V3");
if (!manifest.icons?.["128"]) throw new Error("缺少商店图标");
if (manifest.name.includes("验证版")) throw new Error("生产包名称仍包含“验证版”");

if (!manifest.host_permissions.includes("https://api.deepseek.com/*")) throw new Error("缺少 DeepSeek 直连权限");
if (manifest.host_permissions.some((value) => /vercel|localhost|127\.0\.0\.1/u.test(value))) throw new Error("安装包仍依赖代理");
const background = await fs.readFile(path.join(extensionDir, "background.js"), "utf8");
if (/getProxySession|X-DeepSeek-API-Key|DEEPSEEK_API_KEY/u.test(background)) throw new Error("后台仍存在旧代理或开发者 Key 逻辑");
const files = await listFiles(extensionDir);
if (files.some((file) => path.basename(file) === ".DS_Store")) {
  throw new Error("生产包不应包含 .DS_Store");
}
for (const file of files) {
  if (!/\.(?:js|json|html|css|md)$/u.test(file)) continue;
  const text = await fs.readFile(file, "utf8");
  if (/http:\/\/127\.0\.0\.1:8787/u.test(text)) {
    throw new Error(`生产包仍包含本地代理地址：${path.relative(extensionDir, file)}`);
  }
  if (/(?:sk-[a-zA-Z0-9_-]{20,}|DEEPSEEK_API_KEY\s*[:=]\s*["'][^"']+)/u.test(text)) {
    throw new Error(`生产包疑似包含密钥：${path.relative(extensionDir, file)}`);
  }
}

console.log(`发布校验通过：${files.length} 个文件`);

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(file) : [file];
  }));
  return nested.flat();
}
