import fs from 'fs';
import path from 'path';

const assetsDir = path.join(process.cwd(), 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// A simple valid 1x1 transparent PNG base64 to avoid broken image 404s in frontend
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const buffer = Buffer.from(base64Png, 'base64');
fs.writeFileSync(path.join(assetsDir, 'logo.png'), buffer);

console.log('Setup completed: assets/logo.png created successfully!');
