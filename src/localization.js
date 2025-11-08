// Localization manager providing user-selectable locales.
// Note: Comments in English per instructions.

const DEFAULT_SETTING_LOCALE = 'auto';

class LocalizationManager {
  constructor() {
    this.messages = null;
    this.locale = DEFAULT_SETTING_LOCALE;
    this.ready = false;
    this.loadingPromise = null;
  }

  async init() {
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      try {
        const storageKeys = await this.getStorageSettings();
        const preferredLocale = storageKeys?.preferredLocale || DEFAULT_SETTING_LOCALE;
        if (preferredLocale !== DEFAULT_SETTING_LOCALE) {
          await this.loadLocale(preferredLocale);
        }
        this.locale = preferredLocale;
      } catch (error) {
        console.warn('[Localization] init failed:', error);
      } finally {
        // Ensure ready state reflects whether messages are available
        this.ready = Boolean(this.messages);
      }
    })();

    return this.loadingPromise;
  }

  async getStorageSettings() {
    if (!chrome?.storage?.local) {
      return null;
    }

    const result = await chrome.storage.local.get(['markdownViewerSettings']);
    if (result && result.markdownViewerSettings) {
      return result.markdownViewerSettings;
    }
    return null;
  }

  async setPreferredLocale(locale) {
    const normalized = locale || DEFAULT_SETTING_LOCALE;
    if (normalized === DEFAULT_SETTING_LOCALE) {
      this.messages = null;
      this.ready = false;
      this.locale = DEFAULT_SETTING_LOCALE;
    } else {
      await this.loadLocale(normalized);
      this.locale = normalized;
      this.ready = Boolean(this.messages);
    }
  }

  async loadLocale(locale) {
    try {
      const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this.messages = data;
    } catch (error) {
      console.warn('[Localization] Failed to load locale', locale, error);
      this.messages = null;
      this.ready = false;
    }
  }

  translate(key, substitutions) {
    if (!key) {
      return '';
    }

    // Attempt to use user-selected messages first
    const value = this.lookupMessage(key, substitutions);
    if (value !== null) {
      return value;
    }

    if (chrome?.i18n?.getMessage) {
      return chrome.i18n.getMessage(key, substitutions) || '';
    }

    return '';
  }

  lookupMessage(key, substitutions) {
    if (!this.messages || !this.messages[key]) {
      return null;
    }

    const template = this.messages[key].message || '';
    if (!template) {
      return '';
    }

    if (!substitutions) {
      return template;
    }

    const list = Array.isArray(substitutions) ? substitutions : [substitutions];
    return template.replace(/\{(\d+)\}/g, (match, index) => {
      const idx = parseInt(index, 10);
      if (Number.isNaN(idx) || idx < 0 || idx >= list.length) {
        return match;
      }
      return list[idx];
    });
  }

  getLocale() {
    return this.locale;
  }
}

const Localization = new LocalizationManager();

export default Localization;
export { DEFAULT_SETTING_LOCALE };
