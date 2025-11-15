/**
 * @author Luuxis
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */

const { app, ipcMain, nativeTheme } = require('electron');
const { Microsoft } = require('minecraft-java-core');
const { autoUpdater } = require('electron-updater')
const path = require('path');
const fs = require('fs');
const RPC = require('discord-rpc');

const UpdateWindow = require("./assets/js/windows/updateWindow.js");
const MainWindow = require("./assets/js/windows/mainWindow.js");

const CLIENT_ID = '1438603630818234568';
RPC.register(CLIENT_ID);

const rpc = new RPC.Client({ transport: 'ipc' });

let currentInstance = 'Sin seleccionar';
let currentPanel = 'home';

async function setActivity(instanceName = currentInstance, panelName = currentPanel) {
    if (!rpc) return;

    let details = 'En el menú principal';
    if (panelName === 'settings') {
        details = 'Configurando Launcher';
    } else if (panelName === 'login') {
        details = 'En el login';
    }

    rpc.setActivity({
        startTimestamp: new Date(),
        largeImageKey: 'launcher_logo',
        largeImageText: 'Bridge Client',
        smallImageKey: 'icon',
        smallImageText: 'Preparándome para jugar',
        details: details,
        state: `Jugando: ${instanceName}`,
        instance: true,
    });
}

rpc.on('ready', () => {
    console.log('Rich Presence conectado.');
    setActivity();
});

rpc.login({ clientId: CLIENT_ID }).catch(console.error);

let dev = process.env.NODE_ENV === 'dev';

if (dev) {
    let appPath = path.resolve('./data/Launcher').replace(/\\/g, '/');
    let appdata = path.resolve('./data').replace(/\\/g, '/');
    if (!fs.existsSync(appPath)) fs.mkdirSync(appPath, { recursive: true });
    if (!fs.existsSync(appdata)) fs.mkdirSync(appdata, { recursive: true });
    app.setPath('userData', appPath);
    app.setPath('appData', appdata)
}

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(() => {
    if (dev) return MainWindow.createWindow()
    UpdateWindow.createWindow()
});

ipcMain.on('main-window-open', () => MainWindow.createWindow())
ipcMain.on('main-window-dev-tools', () => {
    const window = MainWindow.getWindow();
    if (window) window.webContents.openDevTools({ mode: 'detach' })
})
ipcMain.on('main-window-dev-tools-close', () => {
    const window = MainWindow.getWindow();
    if (window) window.webContents.closeDevTools()
})
ipcMain.on('main-window-close', () => {
    console.log('main-window-close requested, behavior=', closeBehavior);
    const window = MainWindow.getWindow();

    if (closeBehavior === 'close-all') {
        // close everything (existing behavior)
        MainWindow.destroyWindow();
        return;
    }

    if (!window) return;

    if (closeBehavior === 'close-launcher') {
        // hide the main window so the app stays running in background
        try {
            window.hide();
            console.log('Main window hidden (close-launcher)');
        } catch (e) {
            console.warn('Failed to hide window, falling back to close:', e);
            MainWindow.destroyWindow();
        }
        return;
    }

    if (closeBehavior === 'close-none') {
        // do not close: minimize to taskbar/tray as a friendly fallback
        try {
            window.minimize();
            console.log('Main window minimized (close-none)');
        } catch (e) {
            console.warn('Failed to minimize window, ignoring close:', e);
        }
        return;
    }

    // fallback: destroy
    MainWindow.destroyWindow();
})
ipcMain.on('main-window-reload', () => {
    const window = MainWindow.getWindow();
    if (window) window.reload()
})
ipcMain.on('main-window-progress', (event, options) => {
    const window = MainWindow.getWindow();
    if (window) window.setProgressBar(options.progress / options.size)
})
ipcMain.on('main-window-progress-reset', () => {
    const window = MainWindow.getWindow();
    if (window) window.setProgressBar(-1)
})
ipcMain.on('main-window-progress-load', () => {
    const window = MainWindow.getWindow();
    if (window) window.setProgressBar(2)
})
ipcMain.on('main-window-minimize', () => {
    const window = MainWindow.getWindow();
    if (window) window.minimize()
})

ipcMain.on('update-window-close', () => UpdateWindow.destroyWindow())
ipcMain.on('update-window-dev-tools', () => {
    const window = UpdateWindow.getWindow();
    if (window) window.webContents.openDevTools({ mode: 'detach' })
})
ipcMain.on('update-window-progress', (event, options) => {
    const window = UpdateWindow.getWindow();
    if (window) window.setProgressBar(options.progress / options.size)
})
ipcMain.on('update-window-progress-reset', () => {
    const window = UpdateWindow.getWindow();
    if (window) window.setProgressBar(-1)
})
ipcMain.on('update-window-progress-load', () => {
    const window = UpdateWindow.getWindow();
    if (window) window.setProgressBar(2)
})

ipcMain.handle('path-user-data', () => app.getPath('userData'))
ipcMain.handle('appData', e => app.getPath('appData'))

ipcMain.on('main-window-maximize', () => {
    const window = MainWindow.getWindow();
    if (window) {
        if (window.isMaximized()) {
            window.unmaximize();
        } else {
            window.maximize();
        }
    }
})

ipcMain.on('main-window-hide', () => {
    const window = MainWindow.getWindow();
    if (window) window.hide()
})
ipcMain.on('main-window-show', () => {
    const window = MainWindow.getWindow();
    if (window) window.show()
})

ipcMain.handle('Microsoft-window', async (_, client_id) => {
    return await new Microsoft(client_id).getAuth();
})

ipcMain.handle('is-dark-theme', (_, theme) => {
    if (theme === 'dark') return true
    if (theme === 'light') return false
    return nativeTheme.shouldUseDarkColors;
})

ipcMain.on('instance-changed', (event, data) => {
    currentInstance = data.instanceName;
    setActivity(currentInstance, currentPanel);
    console.log(`Instancia cambió a: ${currentInstance}`);
})

ipcMain.on('panel-changed', (event, data) => {
    currentPanel = data.panelName;
    setActivity(currentInstance, currentPanel);
    console.log(`Panel cambió a: ${currentPanel}`);
})

app.on('window-all-closed', () => app.quit());

let closeBehavior = 'close-launcher'; // default behavior

ipcMain.on('update-close-behavior', (event, value) => {
    if (typeof value === 'string') {
        closeBehavior = value;
        console.log('Close behavior updated to:', closeBehavior);
    }
});

autoUpdater.autoDownload = false;

ipcMain.handle('update-app', async () => {
    return await new Promise(async (resolve, reject) => {
        autoUpdater.checkForUpdates().then(res => {
            resolve(res);
        }).catch(error => {
            reject({
                error: true,
                message: error.message || error.toString()
            })
        })
    })
})

autoUpdater.on('update-available', () => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('updateAvailable');
});

ipcMain.on('start-update', () => {
    autoUpdater.downloadUpdate();
})

autoUpdater.on('update-not-available', () => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('update-not-available');
});

autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall();
});

autoUpdater.on('download-progress', (progress) => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('download-progress', progress);
})

autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('error', { message: 'No se pudo verificar actualizaciones' });
});