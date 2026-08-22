import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const errors = [];

if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3");
const requiredHosts = ["http://127.0.0.1:4096/*", "http://*/*", "https://*/*"];
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(requiredHosts)) {
  errors.push("host_permissions must contain only local OpenCode plus ordinary http/https pages");
}
if (manifest.permissions?.includes("<all_urls>")) errors.push("permanent all_urls permission is forbidden");

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".playwright-cli", "node_modules", "output"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /Bearer\s+[A-Za-z0-9._-]{12,}/i,
  /api[_-]?key\s*[:=]\s*["'][^"']{8,}/i,
];

for (const file of await walk(root)) {
  if (!/\.(?:js|mjs|json|html|css|md)$/.test(file)) continue;
  const text = await readFile(file, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) errors.push(`${relative(root, file)} matches forbidden secret pattern ${pattern}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Extension manifest and secret scan passed.");
}
