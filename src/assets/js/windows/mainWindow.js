/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const os = require("os");
const pkg = require("../../../../package.json");
let dev = process.env.DEV_TOOL === 'open';
let mainWindow = undefined;

function getWindow() {
    return mainWindow;
}

function destroyWindow() {
    if (!mainWindow) return;
    console.log('destroyWindow called');
    try {
        // remove listeners to avoid lingering handles
        mainWindow.removeAllListeners();
        // destroy forcing immediate cleanup
        mainWindow.destroy();
    } catch (err) {
        console.warn('Error destroying mainWindow:', err);
        try { mainWindow.close(); } catch(e){}
    } finally {
        mainWindow = undefined;
        try { app.quit(); } catch(e) {}
    }
}

function createWindow() {
    // if window already exists, restore/show it so it can be reopened after being hidden/minimized
    if (mainWindow) {
        try {
            if (typeof mainWindow.isMinimized === 'function' && mainWindow.isMinimized()) mainWindow.restore();
            if (typeof mainWindow.isVisible === 'function' && !mainWindow.isVisible()) mainWindow.show();
            else mainWindow.show();
        } catch (e) {
            console.warn('Failed to restore/show existing mainWindow:', e);
        }
        return;
    }
    
    mainWindow = new BrowserWindow({
        title: pkg.preductname,
        width: 1280,
        height: 720,
        minWidth: 980,
        minHeight: 552,
        resizable: false,
        maximizable: false,
        icon: `./src/assets/images/icon.${os.platform() === "win32" ? "ico" : "png"}`,
        frame: false,
        show: false,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true
        },
    });
    // Menu.setApplicationMenu(null);
    // mainWindow.setMenuBarVisibility(false);
    // Show menu by default; set HIDE_MENU=1 to keep previous behavior
    if (process.env.HIDE_MENU === '1') {
        try { Menu.setApplicationMenu(null); } catch(e){/* ignore */ }
        try { mainWindow.setMenuBarVisibility(false); } catch(e){/* ignore */ }
    } else {
        try { mainWindow.setMenuBarVisibility(true); mainWindow.setAutoHideMenuBar(false); } catch(e){/* ignore */ }
    }
    mainWindow.loadFile(path.join(`${app.getAppPath()}/src/launcher.html`));
    
    mainWindow.once('ready-to-show', () => {
        if (mainWindow) {
            if (dev) mainWindow.webContents.openDevTools({ mode: 'detach' })
            mainWindow.show()
        }
    });
    
    mainWindow.on('closed', () => {
        console.log('Main window closed');
        mainWindow = undefined;
    });
}

module.exports = {
    getWindow,
    createWindow,
    destroyWindow,
};