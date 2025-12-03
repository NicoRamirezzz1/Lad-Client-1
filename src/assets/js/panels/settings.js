/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground } from '../utils.js'
const { ipcRenderer } = require('electron');
const os = require('os');
// NEW: fs/path for partners loading
const fs = require('fs');
const path = require('path');

class Settings {
    static id = "settings";
    async init(config) {
        this.config = config;
        this.db = new database();
        this.navBTN()
        this.accounts()
        this.ram()
        this.javaPath()
        this.resolution()
        this.launcher()
        // NEW: init legal tab bindings/loaders
        this.legal()
    }



    navBTN() {
        document.querySelector('.settings-tabs').addEventListener('click', e => {
            const tab = e.target.closest('.settings-tab');
            if (tab) {
                let id = tab.id

                let activeSettingsBTN = document.querySelector('.active-tab')
                let activeContainerSettings = document.querySelector('.active-panel')

                if (activeSettingsBTN) activeSettingsBTN.classList.remove('active-tab');
                tab.classList.add('active-tab');

                if (activeContainerSettings) activeContainerSettings.classList.remove('active-panel');
                document.querySelector(`#${id}-tab`).classList.add('active-panel');
            }
        })

        const saveBtn = document.querySelector('#save.settings-close-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                let activeSettingsBTN = document.querySelector('.active-tab')
                let activeContainerSettings = document.querySelector('.active-panel')

                if (activeSettingsBTN) activeSettingsBTN.classList.remove('active-tab');
                document.querySelector('#account').classList.add('active-tab');

                if (activeContainerSettings) activeContainerSettings.classList.remove('active-panel');
                document.querySelector(`#account-tab`).classList.add('active-panel');

                const cancelHome = document.querySelector('.cancel-home');
                if (cancelHome) cancelHome.style.display = 'none';

                changePanel('home')
            })
        }
    }

    accounts() {
        document.querySelector('.accounts-list').addEventListener('click', async e => {
            let popupAccount = new popup()
            try {
                let id = e.target.id
                if (e.target.classList.contains('account')) {
                    popupAccount.openPopup({
                        title: 'Connexion',
                        content: 'Veuillez patienter...',
                        color: 'var(--color)'
                    })

                    if (id == 'add') {
                        document.querySelector('.cancel-home').style.display = 'inline'
                        return changePanel('login')
                    }

                    let account = await this.db.readData('accounts', id);
                    let configClient = await this.setInstance(account);
                    await accountSelect(account);
                    configClient.account_selected = account.ID;
                    return await this.db.updateData('configClient', configClient);
                }

                if (e.target.classList.contains("delete-profile")) {
                    popupAccount.openPopup({
                        title: 'Connexion',
                        content: 'Veuillez patienter...',
                        color: 'var(--color)'
                    })
                    await this.db.deleteData('accounts', id);
                    let deleteProfile = document.getElementById(`${id}`);
                    let accountListElement = document.querySelector('.accounts-list');
                    accountListElement.removeChild(deleteProfile);

                    if (accountListElement.children.length == 1) return changePanel('login');

                    let configClient = await this.db.readData('configClient');

                    if (configClient.account_selected == id) {
                        let allAccounts = await this.db.readAllData('accounts');
                        configClient.account_selected = allAccounts[0].ID
                        accountSelect(allAccounts[0]);
                        let newInstanceSelect = await this.setInstance(allAccounts[0]);
                        configClient.instance_selct = newInstanceSelect.instance_selct
                        return await this.db.updateData('configClient', configClient);
                    }
                }
            } catch (err) {
                console.error(err)
            } finally {
                popupAccount.closePopup();
            }
        })
    }

    async setInstance(auth) {
        let configClient = await this.db.readData('configClient')
        let instanceSelect = configClient.instance_selct
        let instancesList = await config.getInstanceList()

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist == auth.name)
                if (whitelist !== auth.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        configClient.instance_selct = newInstanceSelect.name
                        await setStatus(newInstanceSelect.status)
                    }
                }
            }
        }
        return configClient
    }

    async ram() {
        let config = await this.db.readData('configClient');
        let totalMem = Math.trunc(os.totalmem() / 1073741824 * 10) / 10;
        let freeMem = Math.trunc(os.freemem() / 1073741824 * 10) / 10;

        document.getElementById("total-ram").textContent = `${totalMem} Go`;
        document.getElementById("free-ram").textContent = `${freeMem} Go`;

        // Limites seguros
        const minAllowed = 1; // 1 GB mínimo
        const maxAllowed = Math.max(2, Math.min(16, Math.floor(totalMem * 0.8))); // 80% de la RAM, máx 16GB, min 2GB

        let sliderDiv = document.querySelector(".memory-slider");
        sliderDiv.setAttribute("min", minAllowed);
        sliderDiv.setAttribute("max", maxAllowed);

        if (!config.java_config) {
            config.java_config = { java_path: null, java_memory: { min: 2, max: 4 } };
            await this.db.updateData('configClient', config);
        }

        if (!config.java_config.java_memory) {
            config.java_config.java_memory = { min: 2, max: 4 };
            await this.db.updateData('configClient', config);
        }

        let ramMin = parseFloat(config.java_config.java_memory.min);
        let ramMax = parseFloat(config.java_config.java_memory.max);

        // Corrige valores fuera de rango
        if (isNaN(ramMin) || ramMin < minAllowed) ramMin = minAllowed;
        if (isNaN(ramMax) || ramMax > maxAllowed) ramMax = Math.min(4, maxAllowed);
        if (ramMin > ramMax) ramMin = ramMax;

        // Actualiza config si hay cambios
        if (
            config.java_config.java_memory.min !== ramMin ||
            config.java_config.java_memory.max !== ramMax
        ) {
            config.java_config.java_memory = { min: ramMin, max: ramMax };
            await this.db.updateData('configClient', config);
        }

        let ram = { ramMin: ramMin, ramMax: ramMax };

        let slider = new Slider(".memory-slider", ram.ramMin, ram.ramMax);

        let minSpan = document.querySelector(".slider-touch-left span");
        let maxSpan = document.querySelector(".slider-touch-right span");

        minSpan.setAttribute("value", `${ram.ramMin} Go`);
        maxSpan.setAttribute("value", `${ram.ramMax} Go`);

        slider.on("change", async (min, max) => {
            // Limita valores en tiempo real
            min = Math.max(minAllowed, Math.min(maxAllowed, min));
            max = Math.max(minAllowed, Math.min(maxAllowed, max));
            if (min > max) min = max;

            minSpan.setAttribute("value", `${min} Go`);
            maxSpan.setAttribute("value", `${max} Go`);

            let config = await this.db.readData('configClient');
            if (!config.java_config) {
                config.java_config = { java_path: null, java_memory: { min: 2, max: 4 } };
            }
            config.java_config.java_memory = { min: parseFloat(min), max: parseFloat(max) };
            await this.db.updateData('configClient', config);
        });
    }

    async javaPath() {
        let javaPathText = document.querySelector(".java-path-txt")
        javaPathText.textContent = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/runtime`;

        let configClient = await this.db.readData('configClient')
        let javaPath = configClient?.java_config?.java_path || 'Usar la versión de java incluida con el launcher';
        let javaPathInputTxt = document.querySelector(".java-path-input-text");
        let javaPathInputFile = document.querySelector(".java-path-input-file");
        javaPathInputTxt.value = javaPath;

        document.querySelector(".java-path-set").addEventListener("click", async () => {
            javaPathInputFile.value = '';
            javaPathInputFile.click();
            await new Promise((resolve) => {
                let interval;
                interval = setInterval(() => {
                    if (javaPathInputFile.value != '') resolve(clearInterval(interval));
                }, 100);
            });

            if (javaPathInputFile.value.replace(".exe", '').endsWith("java") || javaPathInputFile.value.replace(".exe", '').endsWith("javaw")) {
                let configClient = await this.db.readData('configClient')
                let file = javaPathInputFile.files[0].path;
                javaPathInputTxt.value = file;
                configClient.java_config.java_path = file
                await this.db.updateData('configClient', configClient);
            } else alert("El nombre del archivo debe ser java o javaw");
        });

        document.querySelector(".java-path-reset").addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            javaPathInputTxt.value = 'Usar la versión de java incluida con el launcher';
            configClient.java_config.java_path = null
            await this.db.updateData('configClient', configClient);
        });
    }

    async resolution() {
        let configClient = await this.db.readData('configClient')
        let resolution = configClient?.game_config?.screen_size || { width: 1920, height: 1080 };

        let width = document.querySelector(".width-size");
        let height = document.querySelector(".height-size");
        let resolutionReset = document.querySelector(".size-reset");

        width.value = resolution.width;
        height.value = resolution.height;

        width.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size.width = width.value;
            await this.db.updateData('configClient', configClient);
        })

        height.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size.height = height.value;
            await this.db.updateData('configClient', configClient);
        })

        resolutionReset.addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size = { width: '854', height: '480' };
            width.value = '854';
            height.value = '480';
            await this.db.updateData('configClient', configClient);
        })
    }

    async launcher() {
        let configClient = await this.db.readData('configClient');

        let closeBox = document.querySelector(".close-box");
        let closeLauncher = configClient?.launcher_config?.closeLauncher || "close-launcher";

        // reflect current choice in UI
        if (closeLauncher == "close-launcher") {
            document.querySelector('.close-launcher').classList.add('active-close');
        } else if (closeLauncher == "close-all") {
            document.querySelector('.close-all').classList.add('active-close');
        } else if (closeLauncher == "close-none") {
            document.querySelector('.close-none').classList.add('active-close');
        }

        // NEW: inform main process about the current stored behavior immediately
        try {
            ipcRenderer.send('update-close-behavior', closeLauncher);
        } catch (e) { console.warn('Failed to send close behavior to main:', e); }

        closeBox.addEventListener("click", async e => {
            if (e.target.classList.contains('close-btn')) {
                let activeClose = document.querySelector('.active-close');
                if (e.target.classList.contains('active-close')) return
                activeClose?.classList.toggle('active-close');

                let configClient = await this.db.readData('configClient')

                if (e.target.classList.contains('close-launcher')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-launcher";
                    await this.db.updateData('configClient', configClient);
                    // NEW: notify main process of change
                    ipcRenderer.send('update-close-behavior', 'close-launcher');
                } else if (e.target.classList.contains('close-all')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-all";
                    await this.db.updateData('configClient', configClient);
                    // NEW: notify main process of change
                    ipcRenderer.send('update-close-behavior', 'close-all');
                } else if (e.target.classList.contains('close-none')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-none";
                    await this.db.updateData('configClient', configClient);
                    // NEW: notify main process of change
                    ipcRenderer.send('update-close-behavior', 'close-none');
                }
            }
        })
    }

    // NEW: populate/legal tab behavior
    async legal() {
        try {
            const panel = document.getElementById('legal-tab');
            if (!panel) return;

            const partnersContainer = panel.querySelector('.partners-grid');
            if (!partnersContainer) return;

            // candidate directories where partners might be located
            const candidateDirs = [];

            try {
                // 1) project folder relative to cwd: ./LadClient/files/partners
                candidateDirs.push(path.join(process.cwd(), 'LadClient', 'files', 'partners'));
            } catch (e) { }

            try {
                // 2) next to appData (common on systems): <appdata>/LadClient/files/partners
                const appdataPath = await appdata().catch(() => null);
                if (appdataPath) {
                    candidateDirs.push(path.join(appdataPath, 'LadClient', 'files', 'partners'));
                    // also try with a dot-prefix (some setups use .LadClient)
                    candidateDirs.push(path.join(appdataPath, '.LadClient', 'files', 'partners'));
                }
            } catch (e) { }

            try {
                // 3) relative to current script folder: traverse upward to locate possible 'files/partners'
                const pFromHere = path.join(__dirname, '..', '..', '..', 'files', 'partners');
                candidateDirs.push(pFromHere);
            } catch (e) { }

            // clean duplicates and ensure existence
            const seen = new Set();
            const validDirs = [];
            for (const d of candidateDirs) {
                if (!d || seen.has(d)) continue;
                seen.add(d);
                try {
                    if (fs.existsSync(d)) validDirs.push(d);
                } catch (e) { /* ignore */ }
            }

            let images = [];
            for (const dir of validDirs) {
                try {
                    const list = fs.readdirSync(dir);
                    for (const f of list) {
                        const ext = f.toLowerCase();
                        if (ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.webp')) {
                            images.push(path.join(dir, f));
                        }
                    }
                } catch (e) { /* ignore errors reading particular dir */ }
            }

            // create DOM elements for each found image
            for (const imgPath of images) {
                try {
                    const item = document.createElement('div');
                    item.className = 'partner-item';
                    const img = document.createElement('img');
                    // use file:// URI and encode spaces
                    const fileUri = `file://${encodeURI(imgPath)}`;
                    img.src = fileUri;
                    img.alt = path.basename(imgPath);
                    // optional: on click open external folder or image
                    item.addEventListener('click', (e) => {
                        try { ipcRenderer.invoke('show-item-in-folder', imgPath).catch(()=>{}); } catch(_) {}
                    });
                    item.appendChild(img);
                    partnersContainer.appendChild(item);
                } catch (e) {
                    // create fallback placeholder per item if something fails
                    try {
                        const item = document.createElement('div');
                        item.className = 'partner-item';
                        const img = document.createElement('img');
                        img.src = 'assets/images/icon.png';
                        img.alt = 'Partner';
                        item.appendChild(img);
                        partnersContainer.appendChild(item);
                    } catch (e2) { /* ignore */ }
                }
            }
        } catch (e) {
            // never throw in renderer init; just log minimal warning
            console.warn('settings.legal init error', e && e.message ? e.message : e);
        }
    }
}
export default Settings;