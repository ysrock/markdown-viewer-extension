#!/usr/bin/env node

/**
 * Remove unused translation keys from all locale files
 */

import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.join(import.meta.dirname, '../src/_locales');

// Keys to remove
const UNUSED_KEYS = [
  'cache_default_message',
  'cache_loading',
  'file_access_disabled_desc',
  'file_access_enabled',
  'file_access_enabled_desc',
  'overview_demo_button',
  'overview_demo_helper',
  'overview_demo_title',
  'overview_feature_cache',
  'overview_feature_code_highlight',
  'overview_feature_live_render',
  'overview_feature_math_support',
  'overview_feature_theme',
  'overview_feature_toc',
  'overview_features_title',
  'overview_file_access_title',
  'overview_tip_content',
  'overview_tip_title',
  'overview_usage_step1',
  'overview_usage_step2',
  'overview_usage_title',
  'overview_version_title',
  'settings_about_author_label',
  'settings_about_storage_label',
  'settings_about_title',
  'settings_about_updated_label',
  'settings_about_version_label',
  'tab_guide',
  'tab_overview'
];

// New keys to add (for non-en/zh_CN locales)
const NEW_KEYS = {
  'file_access_disabled': {
    message: 'Disabled',
    description: 'Status text when file access is disabled'
  },
  'file_access_disabled_desc_short': {
    message: 'To view local files, visit',
    description: 'Short description prefix for file access warning'
  },
  'file_access_settings_link': {
    message: 'extension settings page',
    description: 'Link text to extension settings'
  },
  'file_access_disabled_suffix': {
    message: 'and enable \'Allow access to file URLs\'',
    description: 'Suffix for file access warning'
  }
};

function getLocaleDirs() {
  return fs.readdirSync(LOCALES_DIR)
    .filter(file => {
      const fullPath = path.join(LOCALES_DIR, file);
      return fs.statSync(fullPath).isDirectory();
    })
    .sort();
}

function cleanupLocale(locale) {
  const messagesPath = path.join(LOCALES_DIR, locale, 'messages.json');
  
  try {
    const content = fs.readFileSync(messagesPath, 'utf8');
    const messages = JSON.parse(content);
    
    let removedCount = 0;
    let addedCount = 0;
    
    // Remove unused keys
    UNUSED_KEYS.forEach(key => {
      if (messages[key]) {
        delete messages[key];
        removedCount++;
      }
    });
    
    // Add new keys for non-en/zh_CN locales
    if (locale !== 'en' && locale !== 'zh_CN') {
      Object.entries(NEW_KEYS).forEach(([key, value]) => {
        if (!messages[key]) {
          messages[key] = value;
          addedCount++;
        }
      });
    }
    
    // Write back with proper formatting
    const updatedContent = JSON.stringify(messages, null, 2) + '\n';
    fs.writeFileSync(messagesPath, updatedContent, 'utf8');
    
    console.log(`✅ ${locale}: removed ${removedCount} keys, added ${addedCount} keys`);
    
  } catch (error) {
    console.error(`❌ Error processing ${locale}:`, error.message);
  }
}

function main() {
  console.log('🧹 Cleaning up unused translation keys...\n');
  
  const locales = getLocaleDirs();
  
  locales.forEach(locale => {
    cleanupLocale(locale);
  });
  
  console.log('\n✨ Cleanup complete!');
  console.log('\n💡 Run "node scripts/check-missing-keys.js" to verify.');
}

main();
