/**
 * Starts backend, frontend, and (if present) the Python ML service using concurrently.
 * Handles Windows and Linux venv paths, skipping ML service with a friendly warning
 * if ml-service or its virtual environment is not set up.
 */
const path = require('path');
const fs = require('fs');
const concurrently = require('concurrently');

const ROOT = path.resolve(__dirname, '..');
const WIN = process.platform === 'win32';

// Detect venv (either .venv or venv)
const possibleVenvs = [
  path.join(ROOT, 'ml-service', '.venv'),
  path.join(ROOT, 'ml-service', 'venv'),
  path.join(ROOT, 'backend', '.venv'),
];

let pythonExe = null;
for (const v of possibleVenvs) {
  const exe = path.join(v, WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
  if (fs.existsSync(exe)) {
    pythonExe = exe;
    break;
  }
}

const commands = [
  {
    command: 'npm run dev',
    name: 'backend',
    prefixColor: 'cyan',
    cwd: path.join(ROOT, 'backend'),
  },
  {
    command: 'npm run dev',
    name: 'frontend',
    prefixColor: 'yellow',
    cwd: path.join(ROOT, 'frontend'),
  },
];

if (pythonExe) {
  commands.push({
    command: `"${pythonExe}" -m uvicorn app:app --host 127.0.0.1 --port 8000`,
    name: 'ml-service',
    prefixColor: 'magenta',
    cwd: path.join(ROOT, 'ml-service'),
  });
} else {
  console.warn('\x1b[33m[warn] ML service virtual environment not found in ml-service/.venv or ml-service/venv.\x1b[0m');
  console.warn('\x1b[33m[warn] Skipping ML service on port 8000. (To start ML: cd ml-service, create a venv, install requirements.txt)\x1b[0m\n');
}

const { result } = concurrently(commands, {
  killOthers: ['failure', 'success'],
  restartTries: 0,
});

result.catch(() => {
  process.exit(1);
});

