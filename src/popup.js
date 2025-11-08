// Markdown Viewer Extension - Popup Script

// Note: Popup cannot access IndexedDB directly due to security restrictions
// We use BackgroundCacheProxy to communicate with content scripts through background script

import Localization, { DEFAULT_SETTING_LOCALE } from './localization.js';

const translate = (key, substitutions) => Localization.translate(key, substitutions);

const getUiLocale = () => {
  const selectedLocale = Localization.getLocale();
  if (selectedLocale && selectedLocale !== DEFAULT_SETTING_LOCALE) {
    return selectedLocale.replace('_', '-');
  }

  if (chrome?.i18n?.getUILanguage) {
    return chrome.i18n.getUILanguage();
  }
  return 'en';
};

const applyI18nText = () => {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach((element) => {
    const { i18n: key, version, i18nArgs } = element.dataset;
    let substitutions;

    if (i18nArgs) {
      substitutions = i18nArgs.split('|');
    } else if (version) {
      substitutions = [version];
    }

    const message = translate(key, substitutions);
    if (message) {
      element.textContent = message;
    }
  });

  const attributeElements = document.querySelectorAll('[data-i18n-attr]');
  attributeElements.forEach((element) => {
    const mapping = element.dataset.i18nAttr;
    if (!mapping) {
      return;
    }

    mapping.split(',').forEach((pair) => {
      const [attrRaw, key] = pair.split(':');
      if (!attrRaw || !key) {
        return;
      }

      const attrName = attrRaw.trim();
      const message = translate(key.trim());
      if (attrName && message) {
        element.setAttribute(attrName, message);
      }
    });
  });
};

// Backup proxy for cache operations via background script
class BackgroundCacheProxy {
  constructor() {
    this.maxItems = 1000;
  }

  async getStats() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getCacheStats'
      });
      
      if (response && response.error) {
        throw new Error(response.error);
      }
      
      return response || {
        itemCount: 0,
        maxItems: this.maxItems,
        totalSize: 0,
        totalSizeMB: '0.00',
        items: [],
        message: translate('cache_default_message')
      };
    } catch (error) {
      console.error('Failed to get cache stats via background:', error);
      return {
        itemCount: 0,
        maxItems: this.maxItems,
        totalSize: 0,
        totalSizeMB: '0.00',
        items: [],
        message: translate('cache_error_message')
      };
    }
  }

  async clear() {
    try {
      return await chrome.runtime.sendMessage({
        action: 'clearCache'
      });
    } catch (error) {
      console.error('Failed to clear cache via background:', error);
      throw error;
    }
  }
}

class PopupManager {
  constructor() {
    this.cacheManager = null;
    this.currentTab = 'overview';
    this.settings = {
      maxCacheItems: 1000,
      preferredLocale: DEFAULT_SETTING_LOCALE
    };
    
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.initCacheManager();
    
    // If cache tab is active, load cache data
    if (this.currentTab === 'cache') {
      this.loadCacheData();
    }
  }

  async initCacheManager() {
        // Use BackgroundCacheProxy directly since popup can't access IndexedDB
        this.cacheManager = new BackgroundCacheProxy();
        
        try {
            // Load initial cache data
            await this.loadCacheData();
        } catch (error) {
            console.error('Failed to load cache data:', error);
      this.showError(translate('cache_system_unavailable') || 'Cache system unavailable — open a Markdown file first');
            this.showManualCacheInfo();
        }
    }

  setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // Cache management buttons
    const refreshBtn = document.getElementById('refresh-cache');
    const clearBtn = document.getElementById('clear-cache');
    const saveBtn = document.getElementById('save-settings');
    const resetBtn = document.getElementById('reset-settings');
    const demoBtn = document.getElementById('demo-link');

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.loadCacheData();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.clearCache();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this.saveSettings();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.resetSettings();
      });
    }

    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        this.openDemo();
      });
    }
  }

  switchTab(tabName) {
    // Update active tab button
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update active tab panel
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    this.currentTab = tabName;

    // Load data for specific tabs
    if (tabName === 'cache') {
      this.loadCacheData();
    } else if (tabName === 'settings') {
      this.loadSettingsUI();
    }
  }

  async loadCacheData() {
    const loadingEl = document.getElementById('cache-loading');
    const contentEl = document.getElementById('cache-content');
    
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';

    try {
      if (!this.cacheManager) {
        await this.initCacheManager();
      }

      if (!this.cacheManager) {
  throw new Error(translate('cache_manager_init_failed') || 'Cache manager initialization failed');
      }

      const stats = await this.cacheManager.getStats();
      
      this.renderCacheStats(stats);
      
      // Handle items for new two-layer cache structure
      let items = [];
      if (stats.indexedDBCache?.items) {
        items = stats.indexedDBCache.items;
      } else if (stats.items) {
        items = stats.items;
      }
      
      this.renderCacheItems(items);

      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = 'block';
    } catch (error) {
      console.error('Failed to load cache data:', error);
      if (loadingEl) {
        loadingEl.textContent = translate('cache_loading_failed', [error.message || '']);
      }
    }
  }

  renderCacheStats(stats) {
    const statsEl = document.getElementById('cache-stats');
    if (!statsEl) {
      return;
    }
    
    // Handle new two-layer cache structure, but only show meaningful data to users
    let itemCount = 0;
    let totalSizeMB = '0.00';
    let maxItems = 1000;
    
    if (stats.indexedDBCache) {
      // Use IndexedDB cache as the source of truth
      itemCount = stats.indexedDBCache.itemCount || 0;
      totalSizeMB = stats.indexedDBCache.totalSizeMB || '0.00';
      maxItems = stats.indexedDBCache.maxItems || 1000;
    } else {
      // Fallback for old structure
      itemCount = stats.itemCount || 0;
      totalSizeMB = stats.totalSizeMB || '0.00';
      maxItems = stats.maxItems || 1000;
    }
    
    // Show message if cache is empty or unavailable
    if (itemCount === 0 && stats.message) {
      const hintDetails = translate('cache_hint_details');
      statsEl.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 15px;">
          <div style="font-size: 14px; margin-bottom: 8px;">💡 ${stats.message}</div>
          <div style="font-size: 12px; opacity: 0.8;">
            ${hintDetails}
          </div>
        </div>
      `;
      return;
    }
    
    const usagePercent = Math.round((itemCount / maxItems) * 100);
  const statItemLabel = translate('cache_stat_item_label') || 'Cached items';
  const statSizeLabel = translate('cache_stat_size_label') || 'Space used';
  const statUsageLabel = translate('cache_stat_usage_label') || 'Capacity used';
  const statCapacityLabel = translate('cache_stat_capacity_label') || 'Max capacity';
    
    statsEl.innerHTML = `
      <div class="stat-item">
        <div class="stat-value">${itemCount}</div>
        <div class="stat-label">${statItemLabel}</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${totalSizeMB}MB</div>
        <div class="stat-label">${statSizeLabel}</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${usagePercent}%</div>
        <div class="stat-label">${statUsageLabel}</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${maxItems}</div>
        <div class="stat-label">${statCapacityLabel}</div>
      </div>
    `;
  }

  renderCacheItems(items) {
    const itemsEl = document.getElementById('cache-items');
    if (!itemsEl) {
      return;
    }
    
    // Handle new two-layer cache structure, but only show IndexedDB items
    let allItems = [];
    
    if (Array.isArray(items)) {
      // Old structure - items is directly an array
      allItems = items;
    } else if (items && typeof items === 'object') {
      // New structure - only show IndexedDB items (persistent cache)
      if (items.indexedDBCache?.items) {
        allItems = items.indexedDBCache.items;
      }
    }
    
    const emptyMessage = translate('cache_items_empty') || 'No cached items yet';
    const typeLabel = translate('cache_item_type_label') || 'Type';
    const sizeLabel = translate('cache_item_size_label') || 'Size';
    const createdLabel = translate('cache_item_created_label') || 'Created';
    const accessedLabel = translate('cache_item_accessed_label') || 'Last accessed';
    const unknownType = translate('cache_item_type_unknown') || 'unknown';
    const locale = getUiLocale();

    if (allItems.length === 0) {
      itemsEl.innerHTML = `<div class="cache-item">${emptyMessage}</div>`;
      return;
    }

    itemsEl.innerHTML = allItems.map((item) => {
      const sizeMB = item.sizeMB || (item.size ? (item.size / (1024 * 1024)).toFixed(3) : '0.000');
      const created = item.created ? new Date(item.created).toLocaleString(locale) : null;
      const lastAccess = item.lastAccess ? new Date(item.lastAccess).toLocaleString(locale) : null;

      return `
        <div class="cache-item">
          <div class="cache-item-key">
            ${item.key}
          </div>
          <div class="cache-item-info">
            <span>${typeLabel}: ${item.type || unknownType}</span>
            <span>${sizeLabel}: ${sizeMB}MB</span>
          </div>
          ${created ? `
          <div class="cache-item-info">
            <span>${createdLabel}: ${created}</span>
          </div>
          ` : ''}
          ${lastAccess ? `
          <div class="cache-item-info">
            <span>${accessedLabel}: ${lastAccess}</span>
          </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  async clearCache() {
    const confirmMessage = translate('cache_clear_confirm') || 'Clear all cached data? This action cannot be undone.';
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      if (!this.cacheManager) {
        await this.initCacheManager();
      }

      await this.cacheManager.clear();
      this.loadCacheData(); // Refresh display
      this.showMessage(translate('cache_clear_success') || 'Cache cleared', 'success');
    } catch (error) {
      console.error('Failed to clear cache:', error);
      this.showMessage(translate('cache_clear_failed') || 'Failed to clear cache', 'error');
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['markdownViewerSettings']);
      if (result.markdownViewerSettings) {
        this.settings = { ...this.settings, ...result.markdownViewerSettings };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  loadSettingsUI() {
    const maxCacheItemsEl = document.getElementById('max-cache-items');
    if (maxCacheItemsEl) {
      maxCacheItemsEl.value = this.settings.maxCacheItems;
    }

    const localeSelect = document.getElementById('interface-language');
    if (localeSelect) {
      localeSelect.value = this.settings.preferredLocale || DEFAULT_SETTING_LOCALE;
    }
  }

  async saveSettings() {
    try {
      const maxCacheItemsEl = document.getElementById('max-cache-items');
      const maxCacheItems = parseInt(maxCacheItemsEl.value, 10);
      const localeSelect = document.getElementById('interface-language');
      const preferredLocale = localeSelect ? localeSelect.value : DEFAULT_SETTING_LOCALE;

      if (isNaN(maxCacheItems) || maxCacheItems < 100 || maxCacheItems > 5000) {
        this.showMessage(
          translate('settings_invalid_max_cache', ['100', '5000']) || 'Enter a valid cache size between 100 and 5000',
          'error'
        );
        return;
      }

      this.settings.maxCacheItems = maxCacheItems;
      this.settings.preferredLocale = preferredLocale;
      
      await chrome.storage.local.set({
        markdownViewerSettings: this.settings
      });

  await Localization.setPreferredLocale(preferredLocale);
  chrome.runtime.sendMessage({ type: 'localeChanged', locale: preferredLocale }).catch(() => {});
  applyI18nText();
      this.loadSettingsUI();

      if (this.currentTab === 'cache') {
        this.loadCacheData();
      }

      // Update cache manager if needed
      if (this.cacheManager && this.cacheManager.maxItems !== maxCacheItems) {
        this.cacheManager.maxItems = maxCacheItems;
      }

      this.showMessage(translate('settings_save_success') || 'Settings saved', 'success');
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showMessage(translate('settings_save_failed') || 'Failed to save settings', 'error');
    }
  }

  async resetSettings() {
    const confirmMessage = translate('settings_reset_confirm') || 'Reset all settings to default values?';
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      this.settings = {
        maxCacheItems: 1000,
        preferredLocale: DEFAULT_SETTING_LOCALE
      };

      await chrome.storage.local.set({
        markdownViewerSettings: this.settings
      });

  await Localization.setPreferredLocale(DEFAULT_SETTING_LOCALE);
  chrome.runtime.sendMessage({ type: 'localeChanged', locale: DEFAULT_SETTING_LOCALE }).catch(() => {});
  applyI18nText();

      if (this.currentTab === 'cache') {
        this.loadCacheData();
      }

      this.loadSettingsUI();
      this.showMessage(translate('settings_reset_success') || 'Settings reset', 'success');
    } catch (error) {
      console.error('Failed to reset settings:', error);
      this.showMessage(translate('settings_reset_failed') || 'Failed to reset settings', 'error');
    }
  }

  showMessage(text, type = 'info') {
    // Create a simple toast message
    const message = document.createElement('div');
    message.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s;
    `;
    message.textContent = text;
    
    document.body.appendChild(message);
    
    // Animate in
    setTimeout(() => {
      message.style.opacity = '1';
    }, 100);
    
    // Animate out and remove
    setTimeout(() => {
      message.style.opacity = '0';
      setTimeout(() => {
        document.body.removeChild(message);
      }, 300);
    }, 2000);
  }

  showError(text) {
    console.error('Popup Error:', text);
    this.showMessage(`❌ ${text}`);
  }

  async openDemo() {
    try {
      const demoUrl = 'https://raw.githubusercontent.com/xicilion/markdown-viewer-extension/refs/heads/main/test/test.md';
      
      // Create a new tab with the demo URL
      await chrome.tabs.create({
        url: demoUrl,
        active: true
      });
      
      // Close the popup window after opening the demo
      window.close();
    } catch (error) {
      console.error('Failed to open demo:', error);
      this.showMessage(translate('demo_open_failed') || 'Failed to open demo document', 'error');
    }
  }

  showManualCacheInfo() {
    const loadingEl = document.getElementById('cache-loading');
    const contentEl = document.getElementById('cache-content');
    
    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) {
      contentEl.style.display = 'block';
      const manualLimitTitle = translate('cache_manual_limit_title') || '⚠️ Cache access limits';
      const manualLimitDesc1 = translate('cache_manual_limit_desc_1') || 'For security reasons the popup cannot access IndexedDB directly.';
      const manualLimitDesc2 = translate('cache_manual_limit_desc_2') || 'Caching works while rendering Markdown pages but details are unavailable here.';
      const manualStatusTitle = translate('cache_manual_status_title') || '📊 Check cache status';
      const manualStatusIntro = translate('cache_manual_status_intro') || 'To make sure caching works:';
      const manualStatusStepOpen = translate('cache_manual_status_step_open') || 'Open a Markdown file';
      const manualStatusStepSpeed = translate('cache_manual_status_step_speed') || 'Notice faster renders when cache is warm';
      const manualStatusStepConsole = translate('cache_manual_status_step_console') || 'Check for "⚡ Using cached" logs in DevTools';
      const manualClearTitle = translate('cache_manual_clear_title') || '🧹 Clear cache manually';
      const manualClearIntro = translate('cache_manual_clear_intro') || 'To clear cache manually:';
      const manualClearStep1 = translate('cache_manual_clear_step_1') || 'Open any Markdown file';
      const manualClearStep2 = translate('cache_manual_clear_step_2') || 'Press F12 to open DevTools';
      const manualClearCode = 'window.extensionRenderer?.cacheManager?.clear()';
      const manualClearStep3Raw = translate('cache_manual_clear_step_3', [manualClearCode]) || `Run "${manualClearCode}" in the console`;
      const manualClearStep3 = manualClearStep3Raw.replace(
        manualClearCode,
        `<code style="background: rgba(255,255,255,0.2); padding: 2px 4px; border-radius: 2px;">${manualClearCode}</code>`
      );

      contentEl.innerHTML = `
        <div class="info-section">
          <h3>${manualLimitTitle}</h3>
          <p>${manualLimitDesc1}</p>
          <p>${manualLimitDesc2}</p>
        </div>
        
        <div class="info-section">
          <h3>${manualStatusTitle}</h3>
          <p>${manualStatusIntro}</p>
          <ul style="list-style: none; padding-left: 0;">
            <li>✓ ${manualStatusStepOpen}</li>
            <li>✓ ${manualStatusStepSpeed}</li>
            <li>✓ ${manualStatusStepConsole}</li>
          </ul>
        </div>
        
        <div class="info-section">
          <h3>${manualClearTitle}</h3>
          <p>${manualClearIntro}</p>
          <ol style="list-style: none; padding-left: 0;">
            <li>1. ${manualClearStep1}</li>
            <li>2. ${manualClearStep2}</li>
            <li>3. ${manualClearStep3}</li>
          </ol>
        </div>
      `;
    }
  }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await Localization.init();
    applyI18nText();
    const popupManager = new PopupManager();
    
    // Store reference globally for debugging
    window.popupManager = popupManager;
  } catch (error) {
    console.error('Failed to create PopupManager:', error);
  }
});