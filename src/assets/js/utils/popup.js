/**
 * @author Darken
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

const { ipcRenderer } = require('electron');

export default class popup {
    constructor() {
        this.popup = document.querySelector('.popup');
        this.popupTitle = document.querySelector('.popup-title');
        this.popupContent = document.querySelector('.popup-content');
        this.popupOptions = document.querySelector('.popup-options');
        this.popupButton = document.querySelector('.popup-button');

        // placeholders for global handlers so we can remove them later
        this._globalCloseHandler = null;
        this._globalKeyHandler = null;
        this._buttonHandler = null;
    }

    openPopup(info) {
        this.popup.style.display = 'flex';
        if (info.background == false) this.popup.style.background = 'none';
        else this.popup.style.background = '#000000b3'
        this.popupTitle.innerHTML = info.title;
        this.popupContent.style.color = info.color ? info.color : '#e21212';
        this.popupContent.innerHTML = info.content;

        if (info.options) this.popupOptions.style.display = 'flex';
        else this.popupOptions.style.display = 'none';

        // Ensure previous button handler removed to avoid duplicates
        if (this.popupButton) {
            this.popupButton.onclick = null;
        }

        // If options are shown, wire the popup button (single handler)
        if (this.popupOptions.style.display !== 'none' && this.popupButton) {
            this._buttonHandler = () => {
                if (info.exit) return ipcRenderer.send('main-window-close');
                this.closePopup();
            };
            this.popupButton.addEventListener('click', this._buttonHandler);
        }

        // Global close handler: click anywhere closes popup (as requested)
        this._globalCloseHandler = (ev) => {
            try {
                // close immediately on any click (including inside content per requirement)
                this.closePopup();
            } catch (e) { /* ignore */ }
        };
        document.addEventListener('click', this._globalCloseHandler, { capture: true });

        // Global key handler: Escape / Enter / Space close popup
        this._globalKeyHandler = (ev) => {
            try {
                const key = ev.key;
                if (key === 'Escape' || key === 'Enter' || key === ' ' || key === 'Spacebar') {
                    ev.preventDefault && ev.preventDefault();
                    this.closePopup();
                }
            } catch (e) { /* ignore */ }
        };
        document.addEventListener('keydown', this._globalKeyHandler, { capture: true });
    }

    closePopup() {
        // remove global handlers first
        try {
            if (this._globalCloseHandler) {
                document.removeEventListener('click', this._globalCloseHandler, { capture: true });
                this._globalCloseHandler = null;
            }
        } catch (e) { /* ignore */ }

        try {
            if (this._globalKeyHandler) {
                document.removeEventListener('keydown', this._globalKeyHandler, { capture: true });
                this._globalKeyHandler = null;
            }
        } catch (e) { /* ignore */ }

        // remove button handler if set
        try {
            if (this.popupButton && this._buttonHandler) {
                this.popupButton.removeEventListener('click', this._buttonHandler);
                this._buttonHandler = null;
            }
        } catch (e) { /* ignore */ }

        // hide popup and reset content
        this.popup.style.display = 'none';
        this.popupTitle.innerHTML = '';
        this.popupContent.innerHTML = '';
        this.popupOptions.style.display = 'none';
    }
}