// после tauri icon оставить только icon.ico
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'src-tauri', 'icons');
const keepFiles = new Set(['icon.ico']);

if (!fs.existsSync(iconsDir)) {
  console.error('Нет папки src-tauri/icons');
  process.exit(1);
}

for (const name of fs.readdirSync(iconsDir)) {
  const full = path.join(iconsDir, name);
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    fs.rmSync(full, { recursive: true, force: true });
    console.log('удалена папка', name);
  } else if (!keepFiles.has(name)) {
    fs.unlinkSync(full);
    console.log('удалён', name);
  }
}

if (!fs.existsSync(path.join(iconsDir, 'icon.ico'))) {
  console.error('нет icon.ico, кинь branding/icon.png и npm run icons:taskbar');
  process.exit(1);
}

console.log('Готово: только src-tauri/icons/icon.ico');
