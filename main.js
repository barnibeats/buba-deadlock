const fs = require('fs');
const os = require('os');
const path = require('path');

const num = v => String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => {
  const x = num(a), y = num(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

const updateBase = path.join(process.env.SOULSMITH_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Soulsmith'), 'update');
const marker = path.join(updateBase, 'current.json');

function updatedRoot() {
  try {
    const cur = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const dir = path.join(updateBase, path.basename(String(cur.dir)));
    if (newer(cur.version, require('./package.json').version) && fs.existsSync(path.join(dir, 'desktop.js'))) return dir;
  } catch {}
  return null;
}

const root = updatedRoot();
if (root) {
  try { require(path.join(root, 'desktop.js')); }
  catch (e) {
    console.error('Обновление не запустилось, возвращаюсь к встроенной версии:', e.message);
    try { fs.rmSync(marker, { force: true }); } catch {}
    require('./desktop.js');
  }
} else {
  require('./desktop.js');
}
