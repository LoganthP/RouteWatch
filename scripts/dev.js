/**
 * Starts all three services with coloured, prefixed logs:
 *   ML service  → http://127.0.0.1:8000
 *   API         → http://localhost:5000
 *   Frontend    → http://localhost:5173
 * Press Ctrl+C to stop everything.
 */
const { spawn } = require('child_process');
const { ROOT, WIN, venvBin, fs, path } = require('./common');

if (!fs.existsSync(path.join(ROOT, 'backend', 'node_modules')) || !fs.existsSync(venvBin('python'))) {
  console.error('Run "npm run setup" first.'); process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, 'backend', '.env'))) { console.error('backend/.env is missing. Run "npm run setup".'); process.exit(1); }

const services = [
  { name: 'ml ', color: 35, cmd: venvBin('python'), args: ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8000'], cwd: path.join(ROOT, 'ml-service') },
  { name: 'api', color: 36, cmd: 'npm', args: ['run', 'dev'], cwd: path.join(ROOT, 'backend') },
  { name: 'web', color: 33, cmd: 'npm', args: ['run', 'dev'], cwd: path.join(ROOT, 'frontend') },
];
const kids = services.map((s) => {
  const p = spawn(s.cmd, s.args, { cwd: s.cwd, shell: WIN && s.cmd === 'npm', env: { ...process.env, FORCE_COLOR: '1' } });
  const tag = `\x1b[${s.color}m[${s.name}]\x1b[0m `;
  const pipe = (stream, out) => { let buf = ''; stream.on('data', (d) => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach((l) => out.write(tag + l + '\n')); }); };
  pipe(p.stdout, process.stdout); pipe(p.stderr, process.stderr);
  p.on('exit', (code) => console.log(`${tag}stopped${code ? ` (exit code ${code})` : ''}`));
  return p;
});
console.log('\nRouteWatch starting… open http://localhost:5173 when the [web] line shows "ready".\n');
const stop = () => { kids.forEach((k) => { try { WIN ? spawn('taskkill', ['/pid', String(k.pid), '/T', '/F']) : k.kill('SIGTERM'); } catch { /* ignore */ } }); setTimeout(() => process.exit(0), 500); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
