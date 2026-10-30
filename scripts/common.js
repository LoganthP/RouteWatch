const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WIN = process.platform === 'win32';
const VENV = path.join(ROOT, 'ml-service', '.venv');
const venvBin = (name) => path.join(VENV, WIN ? 'Scripts' : 'bin', WIN ? `${name}.exe` : name);

/** Find a Python 3.10–3.13 interpreter. Returns [cmd, ...args] or null. */
function findPython() {
  const tries = WIN ? [['py', '-3.12'], ['py', '-3.11'], ['py', '-3.13'], ['py', '-3.10'], ['py', '-3'], ['python'], ['python3']]
    : [['python3.12'], ['python3.11'], ['python3.13'], ['python3.10'], ['python3'], ['python']];
  for (const t of tries) {
    const r = spawnSync(t[0], [...t.slice(1), '-c', 'import sys;print(sys.version_info[0],sys.version_info[1])'], { encoding: 'utf8', shell: false });
    if (r.status === 0) {
      const [maj, min] = r.stdout.trim().split(' ').map(Number);
      if (maj === 3 && min >= 10 && min <= 13) return t;
    }
  }
  return null;
}

module.exports = { ROOT, WIN, VENV, venvBin, findPython, fs, path };
