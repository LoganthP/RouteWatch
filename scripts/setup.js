/**
 * One-time setup: installs backend + frontend packages, creates the Python
 * virtual environment for the ML service, and creates backend/.env.
 *   npm run setup
 */
const { spawnSync } = require('child_process');
const { ROOT, WIN, VENV, venvBin, findPython, fs, path } = require('./common');

const run = (label, cmd, args, cwd) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) { console.error(`\n✖ ${label} failed. Fix the error above and run "npm run setup" again.`); process.exit(1); }
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) { console.error(`Node.js 18.17 or newer is required (you have ${process.versions.node}).`); process.exit(1); }

run('Installing backend packages', 'npm', ['install'], path.join(ROOT, 'backend'));
run('Installing frontend packages', 'npm', ['install'], path.join(ROOT, 'frontend'));

const py = findPython();
if (!py) {
  console.error('\n✖ Python 3.10–3.13 was not found. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH" on Windows), then run "npm run setup" again.');
  process.exit(1);
}
if (!fs.existsSync(venvBin('python'))) run(`Creating Python virtual environment (${py.join(' ')})`, py[0], [...py.slice(1), '-m', 'venv', VENV], ROOT);
run('Installing ML packages (scikit-learn, statsmodels, FastAPI)', venvBin('python'), ['-m', 'pip', 'install', '--upgrade', 'pip'], ROOT);
run('Installing ML packages (scikit-learn, statsmodels, FastAPI)', venvBin('python'), ['-m', 'pip', 'install', '-r', 'requirements.txt'], path.join(ROOT, 'ml-service'));

const env = path.join(ROOT, 'backend', '.env');
if (!fs.existsSync(env)) {
  let text = fs.readFileSync(path.join(ROOT, 'backend', '.env.example'), 'utf8');
  text = text.replace('JWT_SECRET=change-me-to-a-long-random-string', `JWT_SECRET=${require('crypto').randomBytes(32).toString('hex')}`);
  fs.writeFileSync(env, text);
  console.log('\n✔ Created backend/.env (with a random JWT_SECRET). Put your MongoDB connection string in MONGODB_URI.');
} else {
  console.log('\n✔ backend/.env already exists, left unchanged.');
}
console.log('\n✔ Setup complete.\n  Next: 1) set MONGODB_URI in backend/.env   2) npm run seed   3) npm run dev\n');
