// Copy @clinic/shared dist + generated + package.json into client's node_modules
// so electron-builder bundles them into the asar. Cross-platform replacement for
// the old `node -e "..."` which broke under Windows cmd.exe (quote handling).
const fs = require('node:fs');
const path = require('node:path');

const dst = 'node_modules/@clinic/shared';
if (fs.existsSync(dst)) { fs.rmSync(dst, { recursive: true, force: true }); }
fs.mkdirSync(dst, { recursive: true });
fs.cpSync('../shared/dist', path.join(dst, 'dist'), { recursive: true });
fs.cpSync('../shared/generated', path.join(dst, 'generated'), { recursive: true });
fs.cpSync('../shared/package.json', path.join(dst, 'package.json'));
console.log('[dist] @clinic/shared copied into node_modules');
