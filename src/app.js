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
let currentInstanceObj = null; // Nuevo: almacena el objeto de la instancia
let currentPanel = 'home';

// Helper para obtener el asset key del icono de la instancia
function getInstanceIconKey(instanceObj) {
    if (!instanceObj) return 'launcher_logo';
    let icon = instanceObj.avatarUrl || instanceObj.iconUrl || instanceObj.icon || instanceObj.avatar || null;
    if (Array.isArray(icon)) icon = icon.find(i => typeof i === 'string');
    if (icon && typeof icon === 'string') {
        // Extrae solo el nombre base sin extensión
        let match = icon.match(/([a-zA-Z0-9_\-]+)\.(png|jpg|jpeg|webp)$/i);
        if (match) return match[1];
        // Si es una URL, intenta extraer el nombre base
        try {
            let url = new URL(icon, 'file://');
            let base = url.pathname.split('/').pop();
            if (base) return base.split('.')[0];
        } catch {}
    }
    return 'launcher_logo';
}

async function setActivity(instanceName = currentInstance, panelName = currentPanel) {
    if (!rpc) return;

    let details = 'En el menú principal';
    if (panelName === 'settings') {
        details = 'Configurando Launcher';
    } else if (panelName === 'login') {
        details = 'En el login';
    }

    // Usa el icono de la instancia si está disponible
    let largeImageKey = getInstanceIconKey(currentInstanceObj);

    rpc.setActivity({
        startTimestamp: new Date(),
        largeImageKey: largeImageKey,
        largeImageText: instanceName || 'Lad Client',
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

// reemplazar handler simple por uno que reutilice/muestre la ventana si ya existe
ipcMain.on('main-window-open', () => {
    const window = MainWindow.getWindow();
    if (window) {
        try {
            if (window.isMinimized && window.isMinimized()) window.restore();
            window.show();
            window.focus();
            return;
        } catch (e) {
            console.warn('Failed to restore existing main window, creating new one:', e);
        }
    }
    MainWindow.createWindow();
})
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

    // Always attempt a robust destroy of the main window to avoid leftover renderer processes
    try {
        // If a window exists, destroy it
        if (window) {
            try { window.removeAllListeners && window.removeAllListeners(); } catch(e){}
        }
        MainWindow.destroyWindow();
    } catch (e) {
        console.warn('Error while destroying main window:', e);
    }

    // Give Electron a short moment to exit cleanly, otherwise force exit
    setTimeout(() => {
        try {
            // Try a graceful quit first
            app.quit();
        } catch (err) {
            console.warn('app.quit() failed, forcing exit:', err);
            try { app.exit(0); } catch(e) { process.exit(0); }
        }

        // Safety fallback: if still not exited after a short delay, force process exit
        setTimeout(() => {
            try { process.exit(0); } catch (e) { /* noop */ }
        }, 800);
    }, 200);
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
    // Recibe el objeto de la instancia desde el renderer
    if (data.instanceObj) {
        currentInstanceObj = data.instanceObj;
    } else {
        currentInstanceObj = null;
    }
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