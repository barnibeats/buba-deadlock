const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const { start, hooks } = require('./server');

const PREFERRED_PORT = 47831;

app.setAppUserModelId('Soulsmith');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function acquireLock() {
  const relaunched = process.argv.includes('--relaunched');
  for (let i = 0; i < (relaunched ? 25 : 1); i++) {
    if (app.requestSingleInstanceLock()) return true;
    await sleep(300);
  }
  return false;
}

let win;
async function createWindow() {
  const port = await start(PREFERRED_PORT).catch(() => start(0));
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1480, height: 960, minWidth: 900, minHeight: 600,
    backgroundColor: '#eef1f4', title: 'Soulsmith', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) e.preventDefault();
  });

  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Закрыть без сохранения', 'Остаться'], defaultId: 1, cancelId: 1,
      title: 'Несохранённые изменения', message: 'В редакторе есть несохранённые изменения.', detail: 'Закрыть приложение без сохранения?',
    });
    if (choice === 0) e.preventDefault(); 
  });

  win.on('closed', () => { win = null; });
  win.loadURL(`http://127.0.0.1:${port}`);
}

hooks.restart = () => {
  app.relaunch({ args: process.argv.slice(1).filter(a => a !== '--relaunched').concat('--relaunched') });
  app.exit(0);
};

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.on('window-all-closed', () => {
  app.quit();
  setTimeout(() => app.exit(0), 1500).unref();
});

(async () => {
  if (!(await acquireLock())) return app.exit(0);
  await app.whenReady();
  try {
    await createWindow();
  } catch (e) {
    dialog.showErrorBox('Soulsmith не запустился', String(e && e.message || e));
    app.exit(1);
  }
})();
