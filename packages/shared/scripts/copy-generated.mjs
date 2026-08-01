// Copy Prisma generated client into dist (cross-platform, no shell quoting issues).
// Replaces the old `node -e "require('node:fs').cpSync(...)"` which broke under
// Windows cmd.exe due to quote handling (especially in non-ASCII paths like the
// Desktop build folder). Using a real script file avoids all shell escaping.
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
cpSync(path.join(root, 'generated'), path.join(root, 'dist', 'generated'), { recursive: true });
console.log('[shared] copied generated -> dist/generated');
