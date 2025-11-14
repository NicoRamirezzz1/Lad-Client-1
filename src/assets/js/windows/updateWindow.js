"use strict";
const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");
const os = require("os");

let dev = process.env.DEV_TOOL === 'open';
let updateWindow = undefined;

function getWindow() {
    return updateWindow;
}

function destroyWindow() {
    if (!updateWindow) return;
    updateWindow.close();
    updateWindow = undefined;
}

function createWindow() {
    destroyWindow();

    updateWindow = new BrowserWindow({
        title: "Actualizar",
        width: 1000,
        height: 600,
        resizable: false,
        transparent: true,
        frame: false,
        show: false,
        icon: `./src/assets/images/icon.${os.platform() === "win32" ? "ico" : "png"}`,
        backgroundColor: '#00000000',
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
        },
    });

    Menu.setApplicationMenu(null);
    updateWindow.setMenuBarVisibility(false);

    updateWindow.loadFile(path.join(`${app.getAppPath()}/src/index.html`));

    updateWindow.once('ready-to-show', () => {
        if (updateWindow) {
            if (dev) updateWindow.webContents.openDevTools({ mode: 'detach' });
            updateWindow.show();
        }
    });
}

// Registrar listeners solo una vez, no dentro de createWindow()
ipcMain.on("update-window-close", () => {
    destroyWindow();
});

ipcMain.on("update-window-dev-tools", () => {
    if (updateWindow) updateWindow.webContents.openDevTools({ mode: 'detach' });
});

ipcMain.on("update-window-progress-load", () => {
    console.log("Splash cargando...");
    if (updateWindow) {
        updateWindow.setProgressBar(2);
    }
});

ipcMain.on("update-window-progress", (event, data) => {
    const progress = data.progress / data.size;
    console.log("Progress:", progress);
    if (updateWindow) {
        updateWindow.setProgressBar(progress);
    }
});

ipcMain.on("update-window-progress-reset", () => {
    if (updateWindow) {
        updateWindow.setProgressBar(-1);
    }
});

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

module.exports = {
    getWindow,
    createWindow,
    destroyWindow,
};
