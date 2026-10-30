const { spawnSync } = require('child_process');
const { ROOT, venvBin, path } = require('./common');
const r = spawnSync(venvBin('python'), ['-m', 'tests.test_ml'], { cwd: path.join(ROOT, 'ml-service'), stdio: 'inherit' });
process.exit(r.status ?? 1);
