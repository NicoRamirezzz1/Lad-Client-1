/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';

import { logger, config, changePanel, database, popup, setBackground, accountSelect, addAccount, pkg } from './utils.js';
const { AZauth, Microsoft, Mojang } = require('minecraft-java-core');

const { ipcRenderer } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const crypto = require('crypto');

function generateHWID() {
	try {
		const hostname = os.hostname() || '';
		let username = '';
		try { username = (os.userInfo && os.userInfo().username) || process.env.USER || process.env.USERNAME || ''; } catch { username = process.env.USER || process.env.USERNAME || ''; }
		const platform = os.platform() || '';
		const arch = os.arch() || '';
		const raw = `${hostname}|${username}|${platform}|${arch}`;
		return crypto.createHash('sha256').update(raw).digest('hex');
	} catch {
		return '';
	}
}
const HWID = generateHWID();

// --- ADD: getPublicIP ---
async function getPublicIP() {
	try {
		const res = await fetch("https://api.ipify.org?format=json").catch(() => null);
		if (!res || !res.ok) return "unknown";
		const json = await res.json().catch(() => null);
		return json?.ip || "unknown";
	} catch {
		return "unknown";
	}
}

// --- REPLACE: checkHWID (send hwid + username + ip) ---
async function checkHWID(username) {
	try {
		const ip = await getPublicIP();

		const res = await fetch("http://104.243.47.197:25577/api/hwid/check.php", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				hwid: HWID,
				username,
				ip,
				action: "check"
			})
		}).catch(() => null);

		if (!res || !res.ok) return;

		const json = await res.json().catch(() => null);

		if (json?.status === "banned") {
			try { alert("Tu HWID está baneado."); } catch {}
			try { ipcRenderer.send("main-window-close"); } catch {}
		}
	} catch (err) {
		// silent on error per requirements
	}
}

// --- REPLACE: autoBan (send hwid + username + ip) ---
async function autoBan(reason, username) {
	try {
		const ip = await getPublicIP();

		await fetch("http://104.243.47.197:25577/api/hwid/ban.php", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				hwid: HWID,
				username,
				ip,
				reason,
				action: "ban"
			})
		}).catch(() => null);
	} catch {}
	try { ipcRenderer.send("main-window-close"); } catch {}
}

// --- MODIFY: monitorTamper to accept username and call autoBan(reason, username) ---
async function monitorTamper(config, username) {
	try {
		const appDataPath = await ipcRenderer.invoke('appData').catch(() => null);
		if (!appDataPath) return;
		const dataDir = (config && config.dataDirectory) || 'Minecraft';
		const basePath = process.platform === 'darwin'
			? path.join(appDataPath, dataDir)
			: path.join(appDataPath, `.${dataDir}`);

		const watchTargets = ['mods', 'config', 'launcher-core'];

		for (const t of watchTargets) {
			const dir = path.join(basePath, t);
			try {
				if (!fs.existsSync(dir)) continue;
				try {
					fs.watch(dir, { recursive: true }, (eventType, filename) => {
						try {
							const filePart = filename ? `/${filename}` : '';
							const reason = `Carpeta modificada: /${t}${filePart}`;
							autoBan(reason, username);
						} catch {}
					});
				} catch {
					try {
						fs.watch(dir, (eventType, filename) => {
							try {
								const filePart = filename ? `/${filename}` : '';
								const reason = `Carpeta modificada: /${t}${filePart}`;
								autoBan(reason, username);
							} catch {}
						});
					} catch {}
				}
			} catch {}
		}
	} catch {}
}

class Launcher {
    async init() {
        this.initLog();
        console.log('Initializing Launcher...');
        this.shortcut()
        await setBackground()
        this.initFrame();
        this.config = await config.GetConfig().then(res => res).catch(err => err);
        if (await this.config.error) return this.errorConnect()
        this.db = new database();
        await this.initConfigClient();

        // --- NEW: derive username from DB (do not remove existing HWID logic) ---
        let accounts = await this.db.readAllData("accounts");
        let configClient = await this.db.readData("configClient");

        let username = "unknown";
        if (accounts && accounts.length && configClient?.account_selected) {
            const found = accounts.find(a => a.ID === configClient.account_selected);
            if (found?.name) username = found.name;
        }

        // SECURITY: HWID check + tamper monitor (silent) - pass username into checks
        try {
            await checkHWID(username);
        } catch {}
        try {
            monitorTamper(this.config, username);
        } catch {}

        // NEW: send stored close behavior to main process so main knows how to act
        try {
            const cfgClient = await this.db.readData('configClient') || {};
            const closeBehavior = cfgClient.launcher_config?.closeLauncher || 'close-launcher';
            ipcRenderer.send('update-close-behavior', closeBehavior);
            console.log('Sent initial close behavior to main:', closeBehavior);
        } catch (e) {
            console.warn('Failed to send initial close behavior to main:', e);
        }

        this.createPanels(Login, Home, Settings);
        this.startLauncher();
    }

    initLog() {
        document.addEventListener('keydown', e => {
            try {
                const tag = (e.target && e.target.tagName) || '';
                const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);

                // Existing combos (fix precedence) -> Ctrl+Shift+I or F12
                if ((e.ctrlKey && e.shiftKey && e.keyCode === 73) || e.keyCode === 123) {
                    ipcRenderer.send('main-window-dev-tools-close');
                    ipcRenderer.send('main-window-dev-tools');
                    return;
                }

                // NEW: Ctrl+V opens DevTools when NOT focused in an input/textarea/contenteditable
                if (e.ctrlKey && !inEditable && (e.key === 'v' || e.key === 'V' || e.keyCode === 86)) {
                    // prevent accidental paste behavior outside editable contexts
                    e.preventDefault && e.preventDefault();
                    ipcRenderer.send('main-window-dev-tools');
                }
            } catch (err) {
                console.warn('initLog key handler error:', err);
            }
        })
        new logger(pkg.name, '#7289da')
    }

    shortcut() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.keyCode == 87) {
                ipcRenderer.send('main-window-close');
            }
        })
    }


    errorConnect() {
        new popup().openPopup({
            title: this.config.error.code,
            content: this.config.error.message,
            color: 'red',
            exit: true,
            options: true
        });
    }

    initFrame() {
        console.log('Initializing Frame...')
        const platform = os.platform() === 'darwin' ? "darwin" : "other";

        const frameSelector = document.querySelector(`.${platform} .frame`);
        if (frameSelector) {
            frameSelector.classList.toggle('hide')

            const minimizeBtn = frameSelector.querySelector('#minimize');
            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', () => {
                    console.log('Minimize clicked');
                    ipcRenderer.send('main-window-minimize');
                });
            }

            const maximizeBtn = frameSelector.querySelector('#maximize');
            if (maximizeBtn) {
                maximizeBtn.style.display = 'none';
            }

            const closeBtn = frameSelector.querySelector('#close');
            if (closeBtn) {
                closeBtn.addEventListener('click', () => {
                    console.log('Close button clicked');
                    ipcRenderer.send('main-window-close');
                });
            } else {
                console.warn('Close button not found in frame');
            }
        } else {
            console.warn('Frame selector not found for platform:', platform);
        }
    }

    async initConfigClient() {
        console.log('Initializing Config Client...')
        let configClient = await this.db.readData('configClient')

        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                instance_selct: null,
                java_config: {
                    java_path: null,
                    java_memory: {
                        min: 2,
                        max: 4
                    }
                },
                game_config: {
                    screen_size: {
                        width: 854,
                        height: 480
                    }
                },
                launcher_config: {
                    download_multi: 5,
                    theme: 'auto',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true
                }
            })
        }
    }

    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels')
        for (let panel of panels) {
            console.log(`Initializing ${panel.name} Panel...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id)
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            panelsElem.appendChild(div);
            new panel().init(this.config);
        }
    }

    async startLauncher() {
        let accounts = await this.db.readAllData('accounts')
        let configClient = await this.db.readData('configClient')
        let account_selected = configClient ? configClient.account_selected : null
        let popupRefresh = new popup();

        if (accounts?.length) {
            for (let account of accounts) {
                let account_ID = account.ID
                if (account.error) {
                    await this.db.deleteData('accounts', account_ID)
                    continue
                }
                if (account.meta.type === 'Xbox') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Conectando...',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });

                    let refresh_accounts = await new Microsoft(this.config.client_id).refresh(account);

                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                        refresh_accounts.name = refresh_accounts.profile.name;
                        console.log(`[Launcher] Microsoft account refreshed and normalized: name=${refresh_accounts.name}`);
                    }
                    
                    if (!refresh_accounts.name) {
                        console.error(`[Account] ${account.name}: Refreshed account missing name property`, refresh_accounts);
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    await this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'AZauth') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Conectando',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    let refresh_accounts = await new AZauth(this.config.online).verify(account);

                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.message}`);
                        continue;
                    }

                    if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                        refresh_accounts.name = refresh_accounts.profile.name;
                        console.log(`[Launcher] AZauth account refreshed and normalized: name=${refresh_accounts.name}`);
                    }
                    
                    if (!refresh_accounts.name) {
                        console.error(`[Account] ${account.name}: Refreshed account missing name property`, refresh_accounts);
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    await this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'Mojang') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Connexion',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    if (account.meta.online == false) {
                        let refresh_accounts = await Mojang.login(account.name);
                        
                        if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                            refresh_accounts.name = refresh_accounts.profile.name;
                        }

                        refresh_accounts.ID = account_ID
                        await addAccount(refresh_accounts)
                        await this.db.updateData('accounts', refresh_accounts, account_ID)
                        if (account_ID == account_selected) accountSelect(refresh_accounts)
                        continue;
                    }

                    let refresh_accounts = await Mojang.refresh(account);

                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                        refresh_accounts.name = refresh_accounts.profile.name;
                        console.log(`[Launcher] Mojang account refreshed and normalized: name=${refresh_accounts.name}`);
                    }
                    
                    if (!refresh_accounts.name) {
                        console.error(`[Account] ${account.name}: Refreshed account missing name property`, refresh_accounts);
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    await this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else {
                    console.error(`[Account] ${account.name}: Account Type Not Found`);
                    this.db.deleteData('accounts', account_ID)
                    if (account_ID == account_selected) {
                        configClient.account_selected = null
                        this.db.updateData('configClient', configClient)
                    }
                }
            }

            accounts = await this.db.readAllData('accounts')
            configClient = await this.db.readData('configClient')
            account_selected = configClient ? configClient.account_selected : null

            if (!account_selected) {
                let uuid = accounts[0].ID
                if (uuid) {
                    configClient.account_selected = uuid
                    await this.db.updateData('configClient', configClient)
                    accountSelect(uuid)
                }
            }

            if (!accounts.length) {
                config.account_selected = null
                await this.db.updateData('configClient', config);
                popupRefresh.closePopup()
                return changePanel("login");
            }

            popupRefresh.closePopup()
            changePanel("home");
        } else {
            popupRefresh.closePopup()
            changePanel('login');
        }
    }
}

new Launcher().init();
