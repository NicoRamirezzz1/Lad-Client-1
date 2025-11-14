const { AZauth, Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

import { popup, database, changePanel, accountSelect, addAccount, config, setStatus } from '../utils.js';

class Login {
    static id = "login";

    async init(config) {
        this.config = config;
        this.db = new database();

        this.showTab('.login-select');

        document.querySelector('.select-microsoft').addEventListener('click', () => {
            this.showMicrosoftLogin();
        });

        document.querySelector('.select-offline').addEventListener('click', () => {
            this.showOfflineLogin();
        });

        document.querySelector('.cancel-home').addEventListener('click', () => {
            this.showTab('.login-select');
        });

        document.querySelector('.cancel-offline').addEventListener('click', () => {
            this.showTab('.login-select');
        });

        const cancelAZauth = document.querySelector('.cancel-AZauth');
        if(cancelAZauth){
            cancelAZauth.addEventListener('click', () => {
                this.showTab('.login-select');
            });
        }

        const cancelAZauthA2F = document.querySelector('.cancel-AZauth-A2F');
        if(cancelAZauthA2F){
            cancelAZauthA2F.addEventListener('click', () => {
                this.showTab('.login-select');
            });
        }
    }

    showTab(selector) {
        document.querySelectorAll('.login-tabs').forEach(tab => {
            tab.style.display = 'none';
        });
        const tab = document.querySelector(selector);
        if(tab) tab.style.display = 'block';
    }

    showMicrosoftLogin() {
        this.showTab('.login-home');
        this.getMicrosoft();
    }

    showOfflineLogin() {
        this.showTab('.login-offline');
        this.getCrack();
    }

    async getMicrosoft() {
        console.log('Initializing Microsoft login...');
        const popupLogin = new popup();
        const microsoftBtn = document.querySelector('.connect-home');

        microsoftBtn.replaceWith(microsoftBtn.cloneNode(true));
        const btn = document.querySelector('.connect-home');

        btn.addEventListener("click", () => {
            popupLogin.openPopup({
                title: 'Conectando',
                content: 'Espere por favor...',
                color: 'var(--color)'
            });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id).then(async account_connect => {
                if (!account_connect || account_connect === 'cancel') {
                    popupLogin.closePopup();
                    return;
                }
                await this.saveData(account_connect);
                popupLogin.closePopup();
            }).catch(err => {
                popupLogin.openPopup({
                    title: 'Error',
                    content: err,
                    options: true
                });
            });
        });
    }

    async getCrack() {
        console.log('Initializing offline login...');
        const popupLogin = new popup();
        const emailOffline = document.querySelector('.email-offline');
        const connectOffline = document.querySelector('.connect-offline');

        connectOffline.replaceWith(connectOffline.cloneNode(true));
        const btn = document.querySelector('.connect-offline');

        btn.addEventListener('click', async () => {
            const nick = emailOffline.value.trim();
            if (nick.length < 3) {
                popupLogin.openPopup({
                    title: 'Error',
                    content: 'Tu Nick debe tener al menos 3 caracteres.',
                    options: true
                });
                return;
            }
            if (nick.includes(' ')) {
                popupLogin.openPopup({
                    title: 'Error',
                    content: 'Tu Nick no debe contener espacios.',
                    options: true
                });
                return;
            }

            const MojangConnect = await Mojang.login(nick);
            if (MojangConnect.error) {
                popupLogin.openPopup({
                    title: 'Error',
                    content: MojangConnect.message,
                    options: true
                });
                return;
            }
            await this.saveData(MojangConnect);
            popupLogin.closePopup();
        });
    }

    async getAZauth() {
    }

    async saveData(connectionData) {
        console.log('[Login] Raw Microsoft response:', JSON.stringify(connectionData, null, 2));
        console.log('[Login] connectionData keys:', Object.keys(connectionData));
        console.log('[Login] connectionData.profile keys:', Object.keys(connectionData.profile || {}));
        
        let extractedName = null;
        
        const searchOrder = [
            { path: 'name', desc: 'connectionData.name' },
            { path: 'profile.name', desc: 'profile.name' },
            { path: 'profile.xboxProfile.gamertag', desc: 'xboxProfile.gamertag' },
            { path: 'profile.xboxProfile.username', desc: 'xboxProfile.username' },
            { path: 'profile.realName', desc: 'profile.realName' },
            { path: 'profile.displayName', desc: 'profile.displayName' },
            { path: 'profile.id', desc: 'profile.id' },
            { path: 'uuid', desc: 'uuid' }
        ];
        
        for (let { path, desc } of searchOrder) {
            const value = path.split('.').reduce((obj, key) => obj?.[key], connectionData);
            if (value && typeof value === 'string' && value.trim()) {
                extractedName = value.trim();
                console.log('[Login] Using', desc, ':', extractedName);
                break;
            }
        }
        
        if (!extractedName) {
            console.warn('[Login] Could not extract name from any property! Full response:', JSON.stringify(connectionData, null, 2));
            extractedName = 'Unknown Account';
        }
        
        connectionData.name = extractedName;
        console.log('[Login] Final extracted name:', connectionData.name);

        const configClient = await this.db.readData('configClient');
        const account = await this.db.createData('accounts', connectionData);
        
        if (!account.name || account.name === 'Unknown Account') {
            if (connectionData.profile?.name) {
                account.name = connectionData.profile.name;
            } else if (connectionData.profile?.xboxProfile?.gamertag) {
                account.name = connectionData.profile.xboxProfile.gamertag;
            } else if (extractedName && extractedName !== 'Unknown Account') {
                account.name = extractedName;
            }
            
            if (account.name && account.name !== 'Unknown Account') {
                console.log(`[Login] Account name corrected after createData: ${account.name}`);
                await this.db.updateData('accounts', account, account.ID);
            }
        }
        const instanceSelect = configClient.instance_selct;
        const instancesList = await config.getInstanceList();

        configClient.account_selected = account.ID;

        try {
            for (let instance of instancesList) {
                if (instance.whitelistActive) {
                    const whitelist = instance.whitelist.find(u => u === account.name);
                    if (whitelist !== account.name && instance.name === instanceSelect) {
                        const newInstanceSelect = instancesList.find(i => !i.whitelistActive);
                        if (newInstanceSelect) {
                            configClient.instance_selct = newInstanceSelect.name;
                            await setStatus(newInstanceSelect.status);
                        }
                    }
                }
            }
        } catch (err) {
            console.warn('Error while adjusting instance selection for new account:', err);
        }

        await this.db.updateData('configClient', configClient);

        try {
            await addAccount(account);
        } catch (err) {
            console.warn('addAccount failed (UI list update) but account was created:', err);
        }

        try {
            await accountSelect(account);
        } catch (err) {
            console.warn('accountSelect failed (UI selection) but account was created:', err);
        }

        try {
            changePanel('home');
        } catch (err) {
            console.error('changePanel to home failed after login:', err);
        }

        return account;
    }
}

export default Login;
