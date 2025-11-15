/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

class Home {
	// new helpers/properties to manage background elements/timers
	bgTimer = null;
	bgElement = null;
	currentBackground = null;
	currentIsVideo = false;

	// new audio properties
	audio = null;
	audioButton = null;
	audioPlaying = false;
	currentMusic = null;

	// dev console helpers
	devConsoleElement = null;
	devConsoleVisible = false;
	originalConsole = null;
	logBuffer = [];
	maxLogs = 5000;

	static id = "home";

    async init(config) {
        this.config = config;
        this.db = new database();
        this.news();
        this.renderSidebarAvatars();
        this.instancesSelect();
        document.querySelector('.settings-btn').addEventListener('click', e => changePanel('settings'));

		// create audio controls in .home-actions
		try {
			this.createAudioControls();
            // setup volume UI and sync with stored config (if present)
			try { await this.setupVolumeControl(); } catch (err) { console.warn('Failed to setup volume control:', err); }
		} catch (err) { console.warn('Failed to create audio controls:', err); }

		// create and wire custom dev console and block devtools open
		try {
			await this.createDevConsole();
			this.overrideConsole();
			window.addEventListener('keydown', this.handleDevKeys.bind(this), true);
			// block right click (optional)
			window.addEventListener('contextmenu', (e) => { e.preventDefault(); }, true);
			// capture uncaught errors/promises
			window.addEventListener('error', (ev) => {
				this.appendLog('error', ev.message || 'window.error', ev.filename + ':' + ev.lineno + ':' + ev.colno);
			});
			window.addEventListener('unhandledrejection', (ev) => {
				this.appendLog('error', 'unhandledrejection', ev.reason);
			});
		} catch (e) {
			console.warn('Dev console init failed:', e);
		}
    }

    async filterAuthorizedInstances(instancesList, authName) {
        let unlockedData = {};
        try {
            unlockedData = await this.db.readData('unlockedInstances') || {};
            console.log('filterAuthorizedInstances: unlockedData from DB =', JSON.stringify(unlockedData));
        } catch (e) {
            console.warn('Error reading unlocked instances from DB:', e);
        }

        let needsUpdate = false;
        for (let instanceName in unlockedData) {
            const unlockedInfo = unlockedData[instanceName];
            const savedCode = typeof unlockedInfo === 'object' ? unlockedInfo.code : null;
            
            const currentInstance = instancesList.find(i => i.name === instanceName);
            if (currentInstance && currentInstance.password) {
                if (!savedCode || savedCode !== currentInstance.password) {
                    const reason = !savedCode ? 'no code stored' : 'code mismatch';
                    console.log(`🔄 ${reason} for "${instanceName}" - clearing unlock`);
                    delete unlockedData[instanceName];
                    needsUpdate = true;
                }
            } else {
                if (currentInstance && !currentInstance.password) {
                    console.log(`🔄 Password removed from "${instanceName}" - clearing unlock`);
                    delete unlockedData[instanceName];
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            try {
                const dataToSave = { ...unlockedData };
                delete dataToSave.ID;
                await this.db.updateData('unlockedInstances', dataToSave);
                console.log('✅ Cleaned up expired unlocks');
            } catch (e) {
                console.warn('Error updating unlocks:', e);
            }
        }

        const unlockedInstances = Object.keys(unlockedData).filter(key => {
            const info = unlockedData[key];
            return info === true || (typeof info === 'object' && info !== null);
        });

        const filtered = instancesList.filter(instance => {
            if (instance.password) {
                const isUnlocked = unlockedInstances.includes(instance.name);
                console.log(`Instance "${instance.name}" has password, unlocked=${isUnlocked}`);
                return isUnlocked;
            }

            if (instance.whitelistActive) {
                const wl = Array.isArray(instance.whitelist) ? instance.whitelist : [];
                const unlockInfo = unlockedData[instance.name];
                const unlockedUsers = (unlockInfo && Array.isArray(unlockInfo.users)) ? unlockInfo.users : [];
                
                const isAuthorized = wl.includes(authName) || unlockedUsers.includes(authName);
                console.log(`Instance "${instance.name}" has whitelist=[${wl.join(', ')}], unlockedUsers=[${unlockedUsers.join(', ')}], authName=${authName}, authorized=${isAuthorized}`);
                return isAuthorized;
            }

            return true;
        });
        
        console.log('filterAuthorizedInstances: total instances in =', instancesList.length, 'filtered out =', filtered.length);
        return filtered;
    }

    setBackground(url) {
		// Reemplaza el método existente para soportar:
		// - url string o array de urls
		// - reproducción de video (mp4/webm/ogg) como fondo
		// - slideshow de imágenes si hay múltiples imágenes
		try {
			// limpiar timers/elementos previos
			if (this.bgTimer) {
				clearInterval(this.bgTimer);
				this.bgTimer = null;
			}
			if (this.bgElement && this.bgElement.parentNode) {
				// si había un video, pausarlo
				const vid = this.bgElement.querySelector('video');
				if (vid && typeof vid.pause === 'function') {
					try { vid.pause(); } catch (e) { }
					vid.src = '';
				}
				this.bgElement.remove();
				this.bgElement = null;
			}
			// reset body background
			document.body.style.backgroundImage = '';
			this.currentBackground = null;
			this.currentIsVideo = false;

			if (!url) {
				return;
			}

			const videoRegex = /\.(mp4|webm|ogg)(\?.*)?$/i;
			const urls = Array.isArray(url) ? url.slice() : [url];

			// normalize (filtrar solo strings)
			const valid = urls.filter(u => typeof u === 'string' && u.trim().length > 0);

			if (!valid.length) return;

			// separar videos e imagenes
			const videos = valid.filter(u => videoRegex.test(u));
			const images = valid.filter(u => !videoRegex.test(u));

			// crear contenedor de fondo
			const container = document.createElement('div');
			container.className = 'launcher-background-media';
			Object.assign(container.style, {
				position: 'fixed',
				inset: '0',
				width: '100%',
				height: '100%',
				zIndex: '-1',
				overflow: 'hidden',
				pointerEvents: 'none',
				display: 'block',
				backgroundColor: 'transparent'
			});

			// preferir video si existe
			if (videos.length > 0) {
				const video = document.createElement('video');
				video.autoplay = true;
				video.loop = true;
				video.muted = true;
				video.playsInline = true;
				video.src = videos[0];
				Object.assign(video.style, {
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%,-50%)',
					minWidth: '100%',
					minHeight: '100%',
					width: 'auto',
					height: 'auto',
					objectFit: 'cover'
				});
				// si el video falla, intento fallback a imagen (si existe)
				video.onerror = () => {
					video.remove();
					if (images.length) {
						container.style.backgroundImage = `url('${images[0]}')`;
						container.style.backgroundSize = 'cover';
						container.style.backgroundPosition = 'center center';
					}
				};
				container.appendChild(video);
				document.body.appendChild(container);
				this.bgElement = container;
				this.currentBackground = videos[0];
				this.currentIsVideo = true;
				// intentar play seguro (algunas plataformas requieren interacción)
				try { video.play().catch(()=>{}); } catch (e) { }
				return;
			}

			// si no hay video, usar imágenes
			if (images.length === 1) {
				container.style.backgroundImage = `url('${images[0]}')`;
				container.style.backgroundSize = 'cover';
				container.style.backgroundPosition = 'center center';
				document.body.appendChild(container);
				this.bgElement = container;
				this.currentBackground = images[0];
				this.currentIsVideo = false;
				return;
			}

			// slideshow si hay múltiples imágenes
			if (images.length > 1) {
				let idx = 0;
				const slide = document.createElement('div');
				Object.assign(slide.style, {
					position: 'absolute',
					inset: '0',
					backgroundSize: 'cover',
					backgroundPosition: 'center center',
					transition: 'opacity 1s ease',
					opacity: '1'
				});
				slide.style.backgroundImage = `url('${images[0]}')`;
				container.appendChild(slide);
				document.body.appendChild(container);
				this.bgElement = container;
				this.currentBackground = images[0];
				this.currentIsVideo = false;

				// ciclo cada 8s
				this.bgTimer = setInterval(() => {
					idx = (idx + 1) % images.length;
					try {
						slide.style.opacity = '0';
						setTimeout(() => {
							try {
								slide.style.backgroundImage = `url('${images[idx]}')`;
								this.currentBackground = images[idx];
								slide.style.opacity = '1';
							} catch (e) { console.warn('Error cambiando slide bg:', e); }
						}, 500);
					} catch (e) { console.warn('Error en slideshow bg:', e); }
				}, 8000);
				return;
			}
		} catch (e) {
			console.warn('Error estableciendo fondo multimedia:', e);
			document.body.style.backgroundImage = '';
		}
	}

    async news() {
        let newsElement = document.querySelector('.news-list');
        if (!newsElement) {
            console.warn('news-list element not found in DOM');
            return;
        }
        
        let news = await config.getNews().then(res => res).catch(err => false);

        if (news) {
            if (!news.length) {
                let blockNews = document.createElement('div');
                blockNews.classList.add('news-block');
                blockNews.innerHTML = `
                    <div class="news-header">
                        <img class="server-status-icon" src="assets/images/icon.png">
                        <div class="header-text">
                            <div class="title">No hay noticias disponibles actualmente.</div>
                        </div>
                        <div class="date">
                            <div class="day">25</div>
                            <div class="month">Abril</div>
                        </div>
                    </div>
                    <div class="news-content">
                        <div class="bbWrapper">
                            <p>Puedes seguir todas las novedades relativas al servidor aquí.</p>
                        </div>
                    </div>`;
                newsElement.appendChild(blockNews);
            } else {
                for (let News of news) {
                    let date = this.getdate(News.publish_date);
                    let blockNews = document.createElement('div');
                    blockNews.classList.add('news-block');
                    blockNews.innerHTML = `
                        <div class="news-header">
                            <img class="server-status-icon" src="assets/images/icon.png">
                            <div class="header-text">
                                <div class="title">${News.title}</div>
                            </div>
                            <div class="date">
                                <div class="day">${date.day}</div>
                                <div class="month">${date.month}</div>
                            </div>
                        </div>
                        <div class="news-content">
                            <div class="bbWrapper">
                                <p>${News.content.replace(/\n/g, '<br>')}</p>
                                <p class="news-author">- <span>${News.author}</span></p>
                            </div>
                        </div>`;
                    newsElement.appendChild(blockNews);
                }
            }
        } else {
            let blockNews = document.createElement('div');
            blockNews.classList.add('news-block');
            blockNews.innerHTML = `
                <div class="news-header">
                        <img class="server-status-icon" src="assets/images/icon.png">
                        <div class="header-text">
                            <div class="title">Error.</div>
                        </div>
                        <div class="date">
                            <div class="day">25</div>
                            <div class="month">Abril</div>
                        </div>
                    </div>
                    <div class="news-content">
                        <div class="bbWrapper">
                            <p>No se puede contactar con el servidor de noticias.</br>Por favor verifique su configuración.</p>
                        </div>
                    </div>`
            newsElement.appendChild(blockNews);
        }
    }

    socialLick() {
        let socials = document.querySelectorAll('.social-block');
        socials.forEach(social => {
            social.addEventListener('click', e => shell.openExternal(social.dataset.url));
        });
    }

	// New: create audio button + audio element (improved: apply saved volume/mute immediately)
	createAudioControls() {
		const actions = document.querySelector('.home-actions');
		if (!actions) return;

		if (this.audioButton) return;

		const btn = document.createElement('button');
		btn.className = 'audio-btn';
		btn.type = 'button';
		btn.title = 'Toggle music';
		btn.innerHTML = '🔈';
		actions.appendChild(btn);
		this.audioButton = btn;

		const audio = document.createElement('audio');
		audio.autoplay = false;
		audio.loop = true;
		audio.crossOrigin = 'anonymous';
		audio.preload = 'auto';
		audio.style.display = 'none';
		document.body.appendChild(audio);
		this.audio = audio;

		// Apply saved volume/mute right away (async)
		(async () => {
			try {
				const cfg = await this.db.readData('configClient') || {};
				const vol = cfg.launcher_config?.audio_volume;
				const muted = !!cfg.launcher_config?.audio_muted;
				if (typeof vol === 'number') {
					try { this.audio.volume = Math.max(0, Math.min(1, vol / 100)); } catch (e) {}
				}
				try { this.audio.muted = muted; } catch (e) {}
				// reflect mute state on audio button icon
				if (muted) btn.innerHTML = '🔇';
			} catch (e) {
				console.warn('createAudioControls: failed loading saved volume/mute', e);
			}
		})();

		btn.addEventListener('click', async () => {
			if (!this.audio) return;
			if (this.audio.paused) {
				try {
					await this.audio.play();
					btn.classList.add('playing');
					btn.innerHTML = '🔊';
					this.audioPlaying = true;
				} catch (e) {
					console.warn('Audio play blocked:', e);
					this.audioPlaying = true;
					btn.classList.add('playing');
					btn.innerHTML = '🔊';
				}
			} else {
				this.audio.pause();
				btn.classList.remove('playing');
				btn.innerHTML = '🔈';
				this.audioPlaying = false;
			}
		});
	}

	// New: load/set music URL for current instance (ensure volume/mute applied before play)
	async setMusic(url) {
		try {
			if (!this.audio) {
				this.createAudioControls();
				if (!this.audio) return;
			}

			// stop if no url
			if (!url) {
				this.currentMusic = null;
				try { this.audio.pause(); } catch (e) {}
				this.audio.removeAttribute('src');
				this.audio.load();
				if (this.audioButton) {
					this.audioButton.classList.remove('playing');
					this.audioButton.innerHTML = '🔈';
					this.audioPlaying = false;
				}
				return;
			}

			// avoid reload same track
			if (this.currentMusic === url) {
				if (this.audioPlaying && this.audio.paused) {
					try { await this.audio.play(); } catch (e) {}
				}
				return;
			}

			this.currentMusic = url;
			this.audio.src = url;
			this.audio.load();

			// Ensure the audio element uses current saved volume/muted before attempting play
			try {
				const cfg = await this.db.readData('configClient') || {};
				const vol = typeof cfg.launcher_config?.audio_volume === 'number' ? cfg.launcher_config.audio_volume : null;
				const muted = !!cfg.launcher_config?.audio_muted;
				if (vol !== null) {
					try { this.audio.volume = Math.max(0, Math.min(1, vol / 100)); } catch (e) {}
				}
				try { this.audio.muted = muted; } catch (e) {}
				// update UI mute icon if settings panel not open
				const muteBtn = document.querySelector('#audio-mute-toggle');
				if (muteBtn) muteBtn.textContent = muted ? '🔇' : '🔈';
			} catch (e) {
				console.warn('setMusic: failed applying saved volume/mute', e);
			}

			if (this.audioPlaying) {
				try {
					await this.audio.play();
				} catch (e) {
					console.warn('setMusic: play blocked or failed', e);
				}
			}
		} catch (e) {
			console.warn('Error setting music:', e);
		}
	}

	// New: bind settings slider/mute to audio and persist value in configClient
	async setupVolumeControl() {
		try {
			const slider = document.querySelector('#audio-volume-slider');
			const valueSpan = document.querySelector('#audio-volume-value');
			const muteBtn = document.querySelector('#audio-mute-toggle');

			// If elements not yet in DOM, observe and re-run when they appear
			if (!slider || !muteBtn || !valueSpan) {
				const observer = new MutationObserver((mutations, obs) => {
					const s = document.querySelector('#audio-volume-slider');
					const v = document.querySelector('#audio-volume-value');
					const m = document.querySelector('#audio-mute-toggle');
					if (s && v && m) {
						obs.disconnect();
						// re-call to bind now that elements exist
						setTimeout(() => { this.setupVolumeControl().catch(()=>{}); }, 0);
					}
				});
				observer.observe(document.body, { childList: true, subtree: true });
				// safety timeout to disconnect after 6s
				setTimeout(() => observer.disconnect(), 6000);
				return;
			}

			// ensure DB/config available
			let configClient = await this.db.readData('configClient') || {};
			if (!configClient.launcher_config) configClient.launcher_config = {};

			// default values
			let vol = typeof configClient.launcher_config.audio_volume === 'number'
				? configClient.launcher_config.audio_volume
				: 100;
			let muted = !!configClient.launcher_config.audio_muted;

			// apply to UI & audio
			slider.value = String(vol);
			valueSpan.textContent = `${vol}%`;
			muteBtn.textContent = muted ? '🔇' : '🔈';

			if (this.audio) {
				try { this.audio.volume = Math.max(0, Math.min(1, vol / 100)); } catch (e) {}
				try { this.audio.muted = muted; } catch (e) {}
			}

			// bind events (use input for live feedback)
			const onSliderInput = async (ev) => {
				const v = Number(ev.target.value || 0);
				valueSpan.textContent = `${v}%`;
				if (this.audio) {
					try { this.audio.volume = v / 100; } catch (e) {}
				}
				configClient.launcher_config.audio_volume = v;
				try { await this.db.updateData('configClient', configClient); } catch (e) { console.warn('Failed to save volume to DB:', e); }
			};

			const onMuteToggle = async () => {
				muted = !muted;
				if (this.audio) {
					try { this.audio.muted = muted; } catch (e) {}
				}
				muteBtn.textContent = muted ? '🔇' : '🔈';
				// also update audio-button icon to reflect mute when paused
				if (this.audioButton && !this.audioPlaying) {
					this.audioButton.innerHTML = muted ? '🔇' : '🔈';
				}
				configClient.launcher_config.audio_muted = muted;
				try { await this.db.updateData('configClient', configClient); } catch (e) { console.warn('Failed to save mute to DB:', e); }
			};

			// remove previous listeners if any (basic)
			slider.removeEventListener('input', onSliderInput);
			muteBtn.removeEventListener('click', onMuteToggle);

			slider.addEventListener('input', onSliderInput);
			muteBtn.addEventListener('click', onMuteToggle);
		} catch (e) {
			console.warn('setupVolumeControl error:', e);
		}
	}

    async renderSidebarAvatars() {
        try {
            let configClient = await this.db.readData('configClient');
            let auth = await this.db.readData('accounts', configClient.account_selected);
            let allInstances = await config.getInstanceList();
            let instancesList = await this.filterAuthorizedInstances(allInstances, auth?.name);
            const container = document.querySelector('.instance-avatars');
            if (!container) return;

            console.debug('renderSidebarAvatars: auth=', auth?.name, 'authorized instances=', instancesList.map(i => i.name));

            container.innerHTML = '';

            let tooltip = document.querySelector('.instance-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'instance-tooltip';
                tooltip.style.display = 'none';
                document.body.appendChild(tooltip);
            }

            for (let instance of instancesList) {

				// elegir correctamente primer avatar/bg si son arrays y evitar usar video como thumbnail
				const rawBg = instance.backgroundUrl || instance.background || '';
				const rawAvatar = instance.avatarUrl || instance.iconUrl || instance.icon || '';

				const videoRegex = /\.(mp4|webm|ogg)(\?.*)?$/i;
				const pickFirst = (v) => {
					if (!v) return '';
					if (Array.isArray(v)) {
						// preferir primera imagen; si no hay images, tomar el primer elemento (aunque sea video)
						const images = v.filter(x => typeof x === 'string' && !videoRegex.test(x));
						return images.length ? images[0] : (typeof v[0] === 'string' ? v[0] : '');
					}
					return (typeof v === 'string') ? v : '';
				};

				const bg = pickFirst(rawBg);
				const avatar = pickFirst(rawAvatar);

                const el = document.createElement('div');
                el.className = 'instance-avatar';
                el.dataset.name = instance.name;

                const defaultAvatar = 'assets/images/icon.png';
                if (avatar) el.style.backgroundImage = `url('${avatar}')`;
                else if (bg) el.style.backgroundImage = `url('${bg}')`;
                else el.style.backgroundImage = `url('${defaultAvatar}')`;

                if (configClient.instance_selct === instance.name) el.classList.add('active');

                el.addEventListener('mouseenter', (ev) => {
                    try {
                        let tooltipText = instance.name;
                        tooltip.textContent = tooltipText;
                        tooltip.style.display = 'block';
                        const rect = el.getBoundingClientRect();
                        tooltip.style.top = `${rect.top + rect.height / 2}px`;
                        tooltip.style.left = `${rect.right + 10}px`;
                    } catch (err) { }
                });
                el.addEventListener('mousemove', (ev) => {
                    tooltip.style.top = `${ev.clientY + 12}px`;
                    tooltip.style.left = `${ev.clientX + 12}px`;
                });
                el.addEventListener('mouseleave', () => {
                    tooltip.style.display = 'none';
                });

                el.addEventListener('click', async () => {
                    try {
                        const prev = container.querySelector('.instance-avatar.active');
                        if (prev) prev.classList.remove('active');
                        el.classList.add('active');

                        configClient.instance_selct = instance.name;
                        await this.db.updateData('configClient', configClient);

                        ipcRenderer.send('instance-changed', { instanceName: instance.name });

                        try { this.setBackground(bg || null); } catch (e) { }
                        try { setStatus(instance.status); } catch (e) { }
						try { this.setMusic(instance.music || instance.musicUrl || null); } catch (e) { }
						try { this.updateServerTitle(instance.name); } catch (e) { }
                    } catch (err) { console.warn('Error al seleccionar instancia desde sidebar:', err); }
                });

                container.appendChild(el);
            }
        } catch (e) {
            console.warn('Error renderizando avatars de instancia:', e);
        }
    }

    async instancesSelect() {
        let configClient = await this.db.readData('configClient');
        let auth = await this.db.readData('accounts', configClient.account_selected);
        let allInstances = await config.getInstanceList();
        let instancesList = await this.filterAuthorizedInstances(allInstances, auth?.name);
        
        let instanceSelect = instancesList.find(i => i.name == configClient?.instance_selct)
            ? configClient?.instance_selct
            : null;

        let playBTN = document.querySelector('.play-btn');
        let instanceBTN = document.querySelector('.instance-select');
        let instancePopup = document.querySelector('.instance-popup');
        let instancesListPopup = document.querySelector('.instances-List');
        let instanceCloseBTN = document.querySelector('.close-popup');

        instanceBTN.style.display = 'flex';

        if (!instanceSelect && instancesList.length > 0) {
            configClient.instance_selct = instancesList[0]?.name;
            instanceSelect = instancesList[0]?.name;
            await this.db.updateData('configClient', configClient);
        }

        for (let instance of instancesList) {
            if (instance.name === instanceSelect) {
                setStatus(instance.status);
                break;
            }
        }

        try {
            let currentOption = instancesList.find(i => i.name === instanceSelect);
            if (currentOption) {
                this.setBackground(currentOption.backgroundUrl || currentOption.background || null);
                // load music for initial selection (do not auto-play unless user toggled)
                try { this.setMusic(currentOption.music || currentOption.musicUrl || null); } catch (e) {}
                try { this.updateServerTitle(currentOption.name); } catch (e) {}
            }
        } catch (e) { console.warn('Error aplicando fondo inicial:', e); }

        instanceBTN.addEventListener('click', async () => {
            const previousBackground = this.currentBackground;
            
            instancesListPopup.innerHTML = '';

            if (instancesList.length === 0) {
                instancesListPopup.innerHTML = `<div class="no-instances">No hay instancias activas disponibles</div>`;
            } else {
                instancesListPopup.innerHTML = '';
                
                for (let instance of instancesList) {
                    // Prefer avatar/icon as banner (evitar usar vídeo como thumbnail)
                    const rawAvatar = instance.avatarUrl || instance.avatar || instance.iconUrl || instance.icon || instance.backgroundUrl || instance.background || '';
                    const videoRegex = /\.(mp4|webm|ogg)(\?.*)?$/i;
                    let avatarForBanner = '';
                    if (Array.isArray(rawAvatar)) {
                        const images = rawAvatar.filter(x => typeof x === 'string' && !videoRegex.test(x));
                        avatarForBanner = images.length ? images[0] : (typeof rawAvatar[0] === 'string' ? rawAvatar[0] : '');
                    } else {
                        avatarForBanner = typeof rawAvatar === 'string' ? rawAvatar : '';
                    }

                    // loader info
                    const loader = instance.loadder || instance.loaders || {};
                    const loaderType = (loader.loadder_type || loader.loader_type || '') ;
                    const mcVersion = (loader.minecraft_version || loader.minecraftVersion || '');

                    const bannerStyle = avatarForBanner ? `style="background-image: url('${avatarForBanner}');"` : '';

                    instancesListPopup.innerHTML += `
                        <div id="${instance.name}" class="instance-card${instance.name === instanceSelect ? ' active-instance' : ''}" data-loader-type="${loaderType}" data-mc-version="${mcVersion}">
                            <div class="instance-banner" ${bannerStyle}>
                                <div class="instance-banner-overlay">
                                    <div class="instance-name">${instance.name}</div>
                                </div>
                            </div>
                            <div class="instance-hover-info" style="display:none;"></div>
                        </div>`;
                }
            }

            // hover behavior: show info panel inside the card (NO background change)
            const onHover = e => {
                const el = e.target.closest('.instance-card');
                if (!el) return;

                // show loader/version info inside card hover box
                const loaderType = el.getAttribute('data-loader-type') || '';
                const mcVer = el.getAttribute('data-mc-version') || '';
                let content = `<div class="hover-title">${el.id}</div>`;
                if (loaderType) content += `<div class="hover-line"><strong>Loader:</strong> ${loaderType}</div>`;
                if (mcVer) content += `<div class="hover-line"><strong>Version:</strong> ${mcVer}</div>`;

                const hoverInfo = el.querySelector('.instance-hover-info');
                if (hoverInfo) {
                    hoverInfo.innerHTML = content;
                    hoverInfo.style.display = 'block';
                }
            };

            const onLeave = e => {
                const el = e.target.closest('.instance-card');
                if (!el) {
                    // hide any hover-info if leaving the container area
                    const all = instancesListPopup.querySelectorAll('.instance-hover-info');
                    all.forEach(h => h.style.display = 'none');
                    return;
                }
                const hoverInfo = el.querySelector('.instance-hover-info');
                if (hoverInfo) hoverInfo.style.display = 'none';
            };

            // ensure we don't re-add duplicates
            instancesListPopup.removeEventListener('mouseover', onHover);
            instancesListPopup.removeEventListener('mouseout', onLeave);
            instancesListPopup.addEventListener('mouseover', onHover);
            instancesListPopup.addEventListener('mouseout', onLeave);

            // display modal
            instancePopup.style.display = 'flex';
        });

        // prevent selecting instance via click in popup (no selection action)
        instancePopup.addEventListener('click', async e => {
            const instanceEl = e.target.closest('.instance-card');
            if (instanceEl) {
                // intentionally ignore click selection; only hover shows info
                return;
            }
            // allow clicks on other controls (e.g., unlock code) to work normally
        });

        instancePopup.addEventListener('click', async e => {
            const instanceEl = e.target.closest('.instance-card');
            if (instanceEl) {
                let newInstanceSelect = instanceEl.id;
                let instance = instancesList.find(i => i.name === newInstanceSelect);

                if (!instance) return;

                let active = document.querySelector('.active-instance');
                if (active) active.classList.remove('active-instance');
                instanceEl.classList.add('active-instance');

                configClient.instance_selct = newInstanceSelect;
                await this.db.updateData('configClient', configClient);
                instanceSelect = newInstanceSelect;

                ipcRenderer.send('instance-changed', { instanceName: newInstanceSelect });

                await setStatus(instance.status);
                try { this.setBackground(instance.backgroundUrl || instance.background || null); } catch (e) { }
				try { this.setMusic(instance.music || instance.musicUrl || null); } catch (e) {}
				try { this.updateServerTitle(instance.name); } catch (e) {}
                instancePopup.style.display = 'none';
            }
        });

        instanceCloseBTN.addEventListener('click', () => instancePopup.style.display = 'none');

        const updateInstanceSelection = async () => {
            try {
                await this.renderSidebarAvatars();
            } catch (err) {
                console.error('Error updating instance selection:', err);
            }
        };

        updateInstanceSelection();

        setInterval(() => {
            updateInstanceSelection();
        }, 2500);
        
        const codeInput = document.querySelector(".code-unlock-input");
        const unlockButton = document.querySelector(".code-unlock-button");
        const messageDiv = document.querySelector(".code-unlock-message");

        if (codeInput && unlockButton) {
            codeInput.addEventListener("keypress", (event) => {
                if (event.key === "Enter") {
                    unlockButton.click();
                }
            });

            unlockButton.addEventListener("click", async () => {
                let codigo = codeInput.value.trim();
                if (!codigo) {
                    messageDiv.textContent = '❌ Por favor ingresa un código';
                    messageDiv.style.color = 'red';
                    return;
                }
                
                codeInput.value = "";
          
                let configClient = await this.db.readData("configClient");

                if (!configClient.account_selected) {
                    const allAccounts = await this.db.readAllData("accounts");
                    if (allAccounts.length > 0) {
                        configClient.account_selected = allAccounts[0].ID;
                        await this.db.updateData("configClient", configClient);
                    }
                }
                
                let cuenta = await this.db.readData("accounts", configClient.account_selected);
                console.log("Cuenta cargada:", cuenta);
                
                let usuario = (cuenta && cuenta.name) || "Invitado";
                console.log("Usuario detectado:", usuario);
              
                try {
                    const response = await fetch(`http://104.243.47.197:25572/api/validate.php`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            codigo: codigo,
                            usuario: usuario,
                        }),
                    });

                    const data = await response.json();
                    console.info("Respuesta del servidor:", data);
          
                    if (data.status === "success") {
                        console.info("✅ Acceso concedido a la instancia");
                        
                        try {
                            const instanceName = data.instanceName || data.instance;
                            
                            if (instanceName) {
                                let unlockedData = await this.db.readData('unlockedInstances') || {};
                                
                                if (!unlockedData[instanceName]) {
                                    unlockedData[instanceName] = { users: [] };
                                }
                                
                                if (!Array.isArray(unlockedData[instanceName].users)) {
                                    unlockedData[instanceName].users = [];
                                }
                                
                                if (!unlockedData[instanceName].users.includes(usuario)) {
                                    unlockedData[instanceName].users.push(usuario);
                                }
                                
                                const dataToSave = { ...unlockedData };
                                delete dataToSave.ID;
                                await this.db.updateData('unlockedInstances', dataToSave);
                                
                                console.log(`👤 Usuario ${usuario} agregado a instancia ${instanceName} en BD`);
                            }
                            
                            if (messageDiv) {
                                messageDiv.textContent = `✅ ¡Código canjeado exitosamente! Instancia desbloqueada.`;
                                messageDiv.style.color = 'green';
                            }
                            
                            setTimeout(async () => {
                                await updateInstanceSelection();
                                if (messageDiv) {
                                    setTimeout(() => {
                                        messageDiv.textContent = '';
                                    }, 2000);
                                }
                            }, 500);
                        } catch (e) {
                            console.error("Error procesando acceso:", e);
                            if (messageDiv) {
                                messageDiv.textContent = 'Error procesando el acceso.';
                                messageDiv.style.color = 'red';
                            }
                        }
                    } else if (data.status === "error" && data.message === "Ya tienes acceso a esta instancia") {
                        console.info("⚠️ El usuario ya tiene acceso a esta instancia.");
                        if (messageDiv) {
                            messageDiv.textContent = '⚠️ Ya tienes acceso a esta instancia.';
                            messageDiv.style.color = 'orange';
                        }
                        setTimeout(() => {
                            updateInstanceSelection();
                        }, 100);
                    } else {
                        console.error("❌ Instancia no encontrada o código inválido.");
                        if (messageDiv) {
                            messageDiv.textContent = '❌ Código inválido o instancia no encontrada.';
                            messageDiv.style.color = 'red';
                        }
                    }
                } catch (error) {
                    console.error("❌ Error en la petición:", error);
                    if (messageDiv) {
                        messageDiv.textContent = '❌ Error al conectar con el servidor.';
                        messageDiv.style.color = 'red';
                    }
                }
            });
        } else {
            console.warn('Code unlock elements not found in DOM');
        }

        playBTN.addEventListener('click', () => {
            const playInstanceBTN = document.querySelector('.play-instance');
            if (playInstanceBTN?.classList.contains('disabled')) {
                this.showGameStartingNotification();
            } else {
                this.startGame();
            }
        });
    }

    // New: update server instance title in the header
	updateServerTitle(name) {
		try {
			const el = document.querySelector('.server-instance-title');
			if (!el) return;
			if (!name) {
				el.textContent = 'Selecciona una instancia';
				return;
			}
			el.textContent = name;
		} catch (e) {
			console.warn('updateServerTitle error:', e);
		}
	}

    async startGame() {
        const rawConfig = await this.db.readData('configClient');
        let configClient = rawConfig || {};
        let needPersist = false;

        if (!rawConfig || typeof rawConfig !== 'object') {
            needPersist = true;
            configClient = {
                account_selected: null,
                instance_selct: null,
                java_config: { java_path: null, java_memory: { min: 2, max: 4 } },
                game_config: { screen_size: { width: 854, height: 480 } },
                launcher_config: { download_multi: 5, theme: 'auto', closeLauncher: 'close-launcher', intelEnabledMac: true }
            };
        }

        if (!configClient.launcher_config) { configClient.launcher_config = { download_multi: 5, theme: 'auto', closeLauncher: 'close-launcher', intelEnabledMac: true }; needPersist = true; }
        if (!configClient.java_config) { configClient.java_config = { java_path: null, java_memory: { min: 2, max: 4 } }; needPersist = true; }
        if (!configClient.java_config.java_memory) { configClient.java_config.java_memory = { min: 2, max: 4 }; needPersist = true; }
        if (!configClient.game_config) { configClient.game_config = { screen_size: { width: 854, height: 480 } }; needPersist = true; }
        if (!configClient.game_config.screen_size) { configClient.game_config.screen_size = { width: 854, height: 480 }; needPersist = true; }
        if (needPersist) {
            try { await this.db.updateData('configClient', configClient); } catch (err) { console.warn('Failed to persist default configClient:', err); }
        }
        const instances = await config.getInstanceList();
        const authenticator = await this.db.readData('accounts', configClient.account_selected);
        const options = instances.find(i => i.name === configClient.instance_selct);

        const playInstanceBTN = document.querySelector('.play-instance');
        const infoStartingBOX = document.querySelector('.info-starting-game');
        const infoStarting = document.querySelector(".info-starting-game-text");
        const progressBar = document.querySelector('.progress-bar');

        if (!options) {
            console.error('startGame: no options found for selected instance', configClient.instance_selct);
            new popup().openPopup({ title: 'Error', content: 'No se encontró la instancia seleccionada. Revise la configuración.', color: 'red', options: true });
            return;
        }

        if (!authenticator) {
            console.error('startGame: no authenticator/account selected');
            new popup().openPopup({ title: 'Error', content: 'No hay una cuenta seleccionada. Inicie sesión primero.', color: 'red', options: true });
            return;
        }

        if (options.whitelistActive) {
            const wl = Array.isArray(options.whitelist) ? options.whitelist : [];
            if (!wl.includes(authenticator?.name)) {
                console.error('startGame: Usuario no autorizado para lanzar instancia', configClient.instance_selct, 'usuario:', authenticator?.name);
                new popup().openPopup({ title: 'Acceso denegado', content: `No tienes permiso para lanzar la instancia ${options.name}.`, color: 'red', options: true });
                return;
            }
        }

        if (!options.loadder || typeof options.loadder !== 'object') {
            console.warn('startGame: instance loader info missing or invalid, attempting to continue with defaults', options.name);
        }

        const opt = {
            url: options.url,
            authenticator,
            timeout: 10000,
            path: `${await appdata()}/${process.platform === 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
            instance: options.name,
            version: options.loadder?.minecraft_version,
            detached: configClient.launcher_config.closeLauncher !== "close-all",
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,
            loader: {
                type: options.loadder?.loadder_type,
                build: options.loadder?.loadder_version,
                enable: options.loadder?.loadder_type !== 'none'
            },
            verify: options.verify,
            ignored: Array.isArray(options.ignored) ? [...options.ignored] : [],
            javaPath: configClient.java_config?.java_path,
            screen: {
                width: configClient.game_config?.screen_size?.width,
                height: configClient.game_config?.screen_size?.height
            },
            memory: {
                min: `${configClient.java_config.java_memory.min * 1024}M`,
                max: `${configClient.java_config.java_memory.max * 1024}M`
            }
        };

        const launch = new Launch();

        launch.on('extract', () => ipcRenderer.send('main-window-progress-load'));
        launch.on('progress', (progress, size) => {
            infoStarting.innerHTML = `Descargando ${((progress / size) * 100).toFixed(0)}%`;
            ipcRenderer.send('main-window-progress', { progress, size });
            if (progressBar) {
                progressBar.value = progress;
                progressBar.max = size;
            }
        });
        launch.on('check', (progress, size) => {
            infoStarting.innerHTML = `Verificando ${((progress / size) * 100).toFixed(0)}%`;
            ipcRenderer.send('main-window-progress', { progress, size });
            if (progressBar) {
                progressBar.value = progress;
                progressBar.max = size;
            }
        });
        launch.on('estimated', time => console.log(`Tiempo estimado: ${time}s`));
        launch.on('speed', speed => console.log(`${(speed / 1067008).toFixed(2)} Mb/s`));
        launch.on('patch', () => { if (infoStarting) infoStarting.innerHTML = `Parche en curso...`; });
        launch.on('data', () => {
            if (progressBar) progressBar.style.display = "none";
            if (infoStarting) infoStarting.innerHTML = `Jugando...`;
            new logger('Minecraft', '#36b030');
        });
        launch.on('close', code => {
            ipcRenderer.send('main-window-progress-reset');
            if (infoStartingBOX) infoStartingBOX.style.display = "none";
            if (playInstanceBTN) playInstanceBTN.classList.remove('disabled');
            if (infoStarting) infoStarting.innerHTML = `Verificando`;
            new logger(pkg.name, '#7289da');
        });
        launch.on('error', err => {
            let popupError = new popup();
            popupError.openPopup({ title: 'Error', content: err?.error || err?.message || String(err), color: 'red', options: true });
            ipcRenderer.send('main-window-progress-reset');
            if (infoStartingBOX) infoStartingBOX.style.display = "none";
            if (playInstanceBTN) playInstanceBTN.classList.remove('disabled');
            if (infoStarting) infoStarting.innerHTML = `Verificando`;
            new logger(pkg.name, '#7289da');
        });

        if (playInstanceBTN) playInstanceBTN.classList.add('disabled');
        if (infoStartingBOX) infoStartingBOX.style.display = "block";
        if (progressBar) progressBar.style.display = "";
        ipcRenderer.send('main-window-progress-load');

        try {
            const startImg = document.querySelector('.starting-icon-big');
            if (startImg) {
                // elegir preview: preferir imagenes; si background es video, usar icon por defecto
                const avatarRaw = options.avatarUrl || options.avatar || options.iconUrl || options.icon || options.backgroundUrl || options.background;
                const videoRegex = /\.(mp4|webm|ogg)(\?.*)?$/i;
                let preview = null;
                if (Array.isArray(avatarRaw)) {
                    preview = avatarRaw.find(u => typeof u === 'string' && !videoRegex.test(u)) || avatarRaw.find(u => typeof u === 'string');
                } else if (typeof avatarRaw === 'string') {
                    preview = avatarRaw;
                }
                if (preview && !videoRegex.test(preview)) {
                    startImg.src = preview;
                } else {
                    // fallback icon
                    const fallback = options.avatarUrl || options.avatar || options.iconUrl || options.icon || 'assets/images/icon.png';
                    startImg.src = (typeof fallback === 'string' && !videoRegex.test(fallback)) ? fallback : 'assets/images/icon.png';
                }
            }
        } catch (err) { console.warn('Failed to set starting image:', err); }

        try {
            console.log('Calling launch.Launch with opt:', opt);
            const maybePromise = launch.Launch(opt);
            if (maybePromise && typeof maybePromise.then === 'function') {
                await maybePromise.catch(launchErr => { throw launchErr; });
            }
            console.log('launch.Launch invoked successfully');
        } catch (launchErr) {
            console.error('launch.Launch threw an exception:', launchErr);
            let popupError = new popup();
            popupError.openPopup({ title: 'Error al lanzar', content: launchErr?.message || String(launchErr), color: 'red', options: true });
            ipcRenderer.send('main-window-progress-reset');
            if (infoStartingBOX) infoStartingBOX.style.display = "none";
            if (playInstanceBTN) playInstanceBTN.classList.remove('disabled');
            return;
        }
    }

    showGameStartingNotification() {
        const notification = document.querySelector('.game-starting-notification');
        if (!notification) return;

        notification.classList.remove('hide');
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
            notification.classList.add('hide');
            setTimeout(() => {
                notification.classList.remove('hide');
            }, 400);
        }, 3000);
    }

    getdate(e) {
        let date = new Date(e);
        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let day = date.getDate();
        let allMonth = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return { year, month: allMonth[month - 1], day };
    }

	// Create DOM for developer console overlay (icons, small id, copy-id)
	async createDevConsole() {
		if (this.devConsoleElement) return;
		const container = document.createElement('div');
		container.className = 'dev-console';
		container.innerHTML = `
			<div class="dev-console-header">
				<div class="dev-console-title">Lad Client - Consola</div>
				<div class="dev-console-actions">
					<button class="dev-clear" title="Limpiar">🗑️</button>
					<button class="dev-copy" title="Copiar">📋</button>
					<button class="dev-download" title="Descargar">⬇️</button>
					<button class="dev-close" title="Cerrar">✕</button>
				</div>
			</div>
			<div class="dev-console-body" role="log"></div>
			<div class="dev-console-footer">
				<span class="dev-console-id">Cuenta: <span class="dev-id">-</span></span>
				<button class="dev-copy-id" title="Copiar ID">🔖</button>
			</div>
		`;
		document.body.appendChild(container);
		this.devConsoleElement = container;

		// wire buttons
		container.querySelector('.dev-clear').addEventListener('click', () => this.clearLogs());
		container.querySelector('.dev-copy').addEventListener('click', () => {
			const text = this.logBuffer.map(l => `[${l.ts}] ${l.level.toUpperCase()} ${l.msg}`).join('\n');
			navigator.clipboard?.writeText(text).catch(()=>{});
		});
		container.querySelector('.dev-download').addEventListener('click', () => this.downloadLogs());
		container.querySelector('.dev-close').addEventListener('click', () => this.toggleDevConsole(false));
		container.querySelector('.dev-copy-id').addEventListener('click', async () => {
			const idEl = container.querySelector('.dev-id');
			if (idEl && idEl.textContent && idEl.textContent !== '-') {
				navigator.clipboard?.writeText(idEl.textContent).catch(()=>{});
			}
		});

		// set id (from selected account). keep updated periodically
		const setIdFromDB = async () => {
			try {
				const cfg = await this.db.readData('configClient') || {};
				const accId = cfg.account_selected;
				let accName = '-';
				if (accId) {
					const acc = await this.db.readData('accounts', accId);
					if (acc) accName = acc.name || acc.ID || String(accId);
				}
				const el = container.querySelector('.dev-id');
				if (el) el.textContent = accName;
			} catch (e) { /* ignore */ }
		};
		await setIdFromDB();
		// also refresh id every 5s to reflect changes
		setInterval(setIdFromDB, 5000);

		// hide by default and smaller by CSS
		container.style.display = 'none';
	}

	// Toggle dev console visible state
	toggleDevConsole(force) {
		const el = this.devConsoleElement;
		if (!el) return;
		if (typeof force === 'boolean') this.devConsoleVisible = force;
		else this.devConsoleVisible = !this.devConsoleVisible;
		el.style.display = this.devConsoleVisible ? 'flex' : 'none';
		if (this.devConsoleVisible) {
			const body = el.querySelector('.dev-console-body');
			if (body) body.scrollTop = body.scrollHeight;
		}
	}

	// helper: decide si un mensaje pertenece al launcher (evitar web/privado)
	isLauncherMessage(level, msg) {
		try {
			// aceptar siempre errores/warings que incluyan keywords locales
			const text = ('' + msg).toLowerCase();
			const launcherKeywords = [
				'lad-client', 'lad client', 'launcher', 'minecraft', 'configclient',
				'unlockedinstances', 'setmusic', 'setbackground', 'startgame',
				'renderSidebarAvatars'.toLowerCase(), 'instancesselect'.toLowerCase(),
				'db.readdata', 'db.updatedata', 'ipcRenderer'.toLowerCase(), 'appdata',
				'minecraft-java-core', 'launch', 'load', 'verify'
			];
			const projectPaths = ['src/', 'assets/', this.config?.dataDirectory?.toLowerCase() || '.']; // include dataDirectory if available

			// reject obvious web/network messages
			const webReject = ['http://', 'https://', 'chrome', 'cdn', 'fetch', 'xhr', 'serviceworker', 'websocket', 'ws://', 'wss://'];
			for (const r of webReject) if (text.includes(r)) return false;

			// if contains launcher keyword or project path => allow
			for (const k of launcherKeywords) if (text.includes(k)) return true;
			for (const p of projectPaths) if (p && text.includes(p)) return true;

			// allow unhandled errors and warnings even if no keyword (to detect crashes)
			if (level === 'error' || level === 'warn') return true;

			return false;
		} catch (e) { return false; }
	}

	// Append formatted log into console DOM and buffer (only launcher-related)
	appendLog(level, ...args) {
		try {
			// build message string
			let msg;
			try {
				msg = args.map(a => {
					if (typeof a === 'string') return a;
					try { return (typeof a === 'object') ? JSON.stringify(a) : String(a); } catch (e) { return String(a); }
				}).join(' ');
			} catch (e) { msg = args.join(' '); }

			// filter: only launcher-related
			if (!this.isLauncherMessage(level, msg)) return;

			const ts = new Date().toLocaleString();

			// store buffer
			this.logBuffer.push({ ts, level, msg });
			if (this.logBuffer.length > this.maxLogs) this.logBuffer.shift();

			// append to DOM
			if (this.devConsoleElement) {
				const body = this.devConsoleElement.querySelector('.dev-console-body');
				if (body) {
					const row = document.createElement('div');
					row.className = `dev-log dev-log-${level}`;
					row.textContent = `[${ts}] ${level.toUpperCase()} ${msg}`;
					body.appendChild(row);
					// limit children count
					while (body.children.length > this.maxLogs) body.removeChild(body.firstChild);
					body.scrollTop = body.scrollHeight;
				}
			}
		} catch (e) { /* noop */ }
	}

	// Override console methods to capture everything
	overrideConsole() {
		if (this.originalConsole) return;
		this.originalConsole = {
			log: console.log.bind(console),
			info: console.info.bind(console),
			warn: console.warn.bind(console),
			error: console.error.bind(console),
			debug: console.debug ? console.debug.bind(console) : console.log.bind(console)
		};
		const levels = ['log','info','warn','error','debug'];
		for (const lvl of levels) {
			console[lvl] = (...args) => {
				try { this.appendLog(lvl, ...args); } catch (e) {}
				try { this.originalConsole[lvl](...args); } catch (e) {}
			};
		}
		// also capture console.trace
		const origTrace = console.trace?.bind(console);
		console.trace = (...args) => {
			this.appendLog('debug', 'TRACE', ...args);
			origTrace && origTrace(...args);
		};
	}

	// clear logs UI + buffer
	clearLogs() {
		this.logBuffer = [];
		if (this.devConsoleElement) {
			const body = this.devConsoleElement.querySelector('.dev-console-body');
			if (body) body.innerHTML = '';
		}
	}

	// download logs as txt
	downloadLogs() {
		const text = this.logBuffer.map(l => `[${l.ts}] ${l.level.toUpperCase()} ${l.msg}`).join('\n');
		const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `launcher-console-${Date.now()}.log.txt`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	// capture keyboard combinations and block devtools open; open custom console on F12
	handleDevKeys(e) {
		// block common devtools combos
		const blocked =
			e.key === 'F12' ||
			(e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
			(e.ctrlKey && e.key === 'I');

		if (blocked) {
			e.preventDefault();
			e.stopPropagation();
			// toggle custom console on F12 (or other combos)
			if (e.key === 'F12' || e.key === 'i' || e.key === 'I') {
				this.toggleDevConsole();
			}
			return false;
		}
		return true;
	}
}

export default Home;
