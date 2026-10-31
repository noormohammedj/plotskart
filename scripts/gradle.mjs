// Runs the Android Gradle wrapper on Windows (gradlew.bat) or macOS/Linux (./gradlew): node scripts/gradle.mjs assembleDebug
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../android/', import.meta.url));
const win = process.platform === 'win32';
// full path: some Windows setups don't run a .bat from the current folder by bare name
const r = spawnSync(join(dir, win ? 'gradlew.bat' : 'gradlew'), process.argv.slice(2), { cwd: dir, stdio: 'inherit', shell: win });
process.exit(r.status ?? 1);
