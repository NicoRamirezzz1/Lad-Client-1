/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

const { ipcRenderer } = require('electron')
const { Status } = require('minecraft-java-core')
const fs = require('fs');
const pkg = require('../package.json');

import config from './utils/config.js';
import database from './utils/database.js';
import logger from './utils/logger.js';
import popup from './utils/popup.js';
import { skin2D } from './utils/skin.js';
import slider from './utils/slider.js';

async function setBackground(theme) {
    let body = document.body;
    body.className = theme ? 'dark global' : 'light global';
    let backgroundPath = './assets/images/background/dark/1.png';
    body.style.backgroundImage = `linear-gradient(#00000000, #00000080), url(${backgroundPath})`;
    body.style.backgroundSize = 'cover';
}


async function changePanel(id) {
    let panel = document.querySelector(`.${id}`);
    if (!panel) return;
    let active = document.querySelector(`.active`)
    if (active) active.classList.remove("active");

    if (id === 'settings' || id === 'login') {
        await setBackground(false);
    }

    try {
        if (id !== 'settings') {
            const activeSettingsBTN = document.querySelector('.active-settings-BTN');
            const activeContainerSettings = document.querySelector('.active-container-settings');
            if (activeSettingsBTN) activeSettingsBTN.classList.remove('active-settings-BTN');
            if (activeContainerSettings) activeContainerSettings.classList.remove('active-container-settings');
            const cancelHome = document.querySelector('.cancel-home');
            if (cancelHome) cancelHome.style.display = 'none';
        }
    } catch (err) {
        console.error('changePanel cleanup error', err);
    }

    try {
        const panels = document.querySelectorAll('.panel');
        panels.forEach(p => {
            if (p === panel) {
                p.style.display = 'block';
            } else {
                p.style.display = 'none';
                p.classList.remove('active');
            }
        })
    } catch (err) {
    }

    panel.classList.add("active");

    ipcRenderer.send('panel-changed', { panelName: id });
}

async function appdata() {
    return await ipcRenderer.invoke('appData').then(path => path)
}

async function addAccount(data) {
    let skin = false
    if (data?.profile?.skins[0]?.base64) skin = await new skin2D().creatHeadTexture(data.profile.skins[0].base64);
    let div = document.createElement("div");
    div.classList.add("account");
    div.id = data.ID;
    const accountName = data.name || data.profile?.name || 'Unknown Account';
    div.innerHTML = `
        <div class="profile-image" ${skin ? 'style="background-image: url(' + skin + ');"' : ''}></div>
        <div class="profile-infos">
            <div class="profile-pseudo">${accountName}</div>
            <div class="profile-uuid">${data.uuid}</div>
        </div>
        <div class="delete-profile" id="${data.ID}">
            <div class="icon-account-delete delete-profile-icon"></div>
        </div>
    `
    return document.querySelector('.accounts-list').appendChild(div);
}

async function accountSelect(data) {
    let account = document.getElementById(`${data.ID}`);
    let activeAccount = document.querySelector('.account-select')

    if (activeAccount) activeAccount.classList.toggle('account-select');
    account.classList.add('account-select');
    if (data?.profile?.skins[0]?.base64) headplayer(data.profile.skins[0].base64);
}

async function headplayer(skinBase64) {
    let skin = await new skin2D().creatHeadTexture(skinBase64);
    document.querySelector(".player-head").style.backgroundImage = `url(${skin})`;
}

async function setStatus(opt) {
    try {
        const nameServerElement = document.querySelector('.server-status-name');
        const statusServerElement = document.querySelector('.server-status-text');
        const playersOnline = document.querySelector('.status-player-count .player-count');
        const statusCountContainer = document.querySelector('.status-player-count');

        // Helper para aplicar texto/clase si el elemento existe
        const safeSetText = (el, text) => { if (el) el.innerHTML = text; };
        const safeAddClass = (el, cls) => { if (el && el.classList) el.classList.add(cls); };
        const safeRemoveClass = (el, cls) => { if (el && el.classList) el.classList.remove(cls); };

        if (!opt) {
            safeAddClass(statusServerElement, 'red');
            safeSetText(statusServerElement, `Ferme - 0 ms`);
            safeAddClass(statusCountContainer, 'red');
            safeSetText(playersOnline, '0');
            return;
        }

        let { ip, port, nameServer } = opt;
        safeSetText(nameServerElement, nameServer || '');

        let status = new Status(ip, port);
        let statusServer = await status.getStatus().then(res => res).catch(err => err);

        if (!statusServer || !statusServer.error) {
            safeRemoveClass(statusServerElement, 'red');
            safeRemoveClass(statusCountContainer, 'red');
            const msText = statusServer && statusServer.ms ? `${statusServer.ms} ms` : '0 ms';
            safeSetText(statusServerElement, `En Linea - ${msText}`);
            safeSetText(playersOnline, (statusServer && (statusServer.playersConnect ?? statusServer.players)) ?? '0');
        } else {
            safeAddClass(statusServerElement, 'red');
            safeSetText(statusServerElement, `Farm - 0 ms`);
            safeAddClass(statusCountContainer, 'red');
            safeSetText(playersOnline, '0');
        }
    } catch (e) {
        // No dejar que una excepción rompa el flujo del caller
        console.warn('setStatus error (ignored):', e);
    }
}

// show launcher version in settings (if the element exists)
document.addEventListener('DOMContentLoaded', () => {
    try {
        const verEl = document.querySelector('#launcher-version-text') || document.querySelector('.settings-version-text');
        if (verEl && pkg && pkg.version) {
            verEl.textContent = `v${pkg.version}`;
        }
    } catch (e) {
        console.warn('Failed to set launcher version text:', e);
    }
});


export {
    appdata as appdata,
    changePanel as changePanel,
    config as config,
    database as database,
    logger as logger,
    popup as popup,
    setBackground as setBackground,
    skin2D as skin2D,
    addAccount as addAccount,
    accountSelect as accountSelect,
    slider as Slider,
    pkg as pkg,
    setStatus as setStatus
}