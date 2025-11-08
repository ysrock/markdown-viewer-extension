// Background script for handling messages between content script and offscreen document
import ExtensionCacheManager from './cache-manager.js';

let offscreenCreated = false;
let globalCacheManager = null;

// Store scroll positions in memory (per session)
const scrollPositions = new Map();
const printJobs = new Map();
const PRINT_CHUNK_SIZE = 256 * 1024;

// Initialize the global cache manager
async function initGlobalCacheManager() {
  try {
    globalCacheManager = new ExtensionCacheManager();
    await globalCacheManager.initDB();
    return globalCacheManager;
  } catch (error) {
    return null;
  }
}

// Initialize cache manager when background script loads
initGlobalCacheManager();

// Monitor offscreen document lifecycle
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen') {
    port.onDisconnect.addListener(() => {
      // Reset state when offscreen document disconnects
      offscreenCreated = false;
    });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'offscreenReady') {
    offscreenCreated = true;
    return;
  }
  
  if (message.type === 'offscreenDOMReady') {
    return;
  }
  
  if (message.type === 'offscreenError') {
    console.error('Offscreen error:', message.error);
    return;
  }
  
  if (message.type === 'injectContentScript') {
    handleContentScriptInjection(sender.tab.id, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Handle scroll position management
  if (message.type === 'saveScrollPosition') {
    scrollPositions.set(message.url, message.position);
    sendResponse({ success: true });
    return;
  }
  
  if (message.type === 'getScrollPosition') {
    const position = scrollPositions.get(message.url) || 0;
    sendResponse({ position });
    return;
  }
  
  if (message.type === 'clearScrollPosition') {
    scrollPositions.delete(message.url);
    sendResponse({ success: true });
    return;
  }
  
  // Handle cache operations
  if (message.action === 'getCacheStats' || message.action === 'clearCache') {
    handleCacheRequest(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Handle cache operations for content scripts
  if (message.type === 'cacheOperation') {
    handleContentCacheOperation(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Forward rendering messages to offscreen document
  if (message.type === 'renderMermaid' || message.type === 'renderHtml' || message.type === 'renderSvg') {
    handleRenderingRequest(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Handle local file reading
  if (message.type === 'READ_LOCAL_FILE') {
    handleFileRead(message, sendResponse);
    return true; // Keep message channel open for async response
  }
  
  // Handle file download
  if (message.type === 'DOWNLOAD_FILE') {
    handleFileDownload(message, sendResponse);
    return true; // Keep message channel open for async response
  }

  if (message.type === 'PRINT_DOCUMENT') {
    handlePrintDocument(message, sender, sendResponse);
    return true;
  }

  if (message.type === 'PRINT_JOB_INIT') {
    handlePrintJobInit(message, sender, sendResponse);
    return true;
  }

  if (message.type === 'PRINT_JOB_CHUNK') {
    handlePrintJobChunk(message, sendResponse);
    return true;
  }

  if (message.type === 'PRINT_JOB_FINALIZE') {
    handlePrintJobFinalize(message, sendResponse);
    return true;
  }

  if (message.type === 'PRINT_JOB_REQUEST') {
    handlePrintJobRequest(message, sender, sendResponse);
    return true;
  }

  if (message.type === 'PRINT_JOB_FETCH_CHUNK') {
    handlePrintJobFetchChunk(message, sendResponse);
    return true;
  }

  if (message.type === 'PRINT_JOB_COMPLETE') {
    handlePrintJobComplete(message, sender, sendResponse);
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [token, job] of printJobs.entries()) {
    if (job.tabId === tabId) {
      printJobs.delete(token);
      break;
    }
  }
});

function createPrintToken() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const buffer = new Uint32Array(4);
  if (globalThis.crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buffer);
  } else {
    for (let i = 0; i < buffer.length; i++) {
      buffer[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }
  return Array.from(buffer, (value) => value.toString(16).padStart(8, '0')).join('-');
}

async function handleContentCacheOperation(message, sendResponse) {
  try {
    // Ensure global cache manager is initialized
    if (!globalCacheManager) {
      globalCacheManager = await initGlobalCacheManager();
    }
    
    if (!globalCacheManager) {
      sendResponse({ error: 'Cache system initialization failed' });
      return;
    }
    
    switch (message.operation) {
      case 'get':
        const item = await globalCacheManager.get(message.key);
        sendResponse({ result: item });
        break;
        
      case 'set':
        await globalCacheManager.set(message.key, message.value, message.dataType);
        sendResponse({ success: true });
        break;
        
      case 'clear':
        await globalCacheManager.clear();
        sendResponse({ success: true });
        break;
        
      case 'getStats':
        const stats = await globalCacheManager.getStats();
        sendResponse({ result: stats });
        break;
        
      default:
        sendResponse({ error: 'Unknown cache operation' });
    }
    
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handleCacheRequest(message, sendResponse) {
  try {
    // Ensure global cache manager is initialized
    if (!globalCacheManager) {
      globalCacheManager = await initGlobalCacheManager();
    }
    
    if (!globalCacheManager) {
      sendResponse({
        itemCount: 0,
        maxItems: 1000,
        totalSize: 0,
        totalSizeMB: '0.00',
        items: [],
        message: 'Cache system initialization failed'
      });
      return;
    }
    
    if (message.action === 'getCacheStats') {
      const stats = await globalCacheManager.getStats();
      sendResponse(stats);
    } else if (message.action === 'clearCache') {
      await globalCacheManager.clear();
      sendResponse({ success: true, message: 'Cache cleared successfully' });
    } else {
      sendResponse({ error: 'Unknown cache action' });
    }
    
  } catch (error) {
    sendResponse({ 
      error: error.message,
      itemCount: 0,
      maxItems: 1000,
      totalSize: 0,
      totalSizeMB: '0.00',
      items: [],
      message: 'Cache operation failed'
    });
  }
}

async function handleFileRead(message, sendResponse) {
  try {
    // Use fetch to read the file - this should work from background script
    const response = await fetch(message.filePath);
    
    if (!response.ok) {
      throw new Error(`Failed to read file: ${response.status} ${response.statusText}`);
    }
    
    // Get content type from response headers
    const contentType = response.headers.get('content-type') || '';
    
    // Check if binary mode is requested
    if (message.binary) {
      // Read as ArrayBuffer for binary files (images)
      const arrayBuffer = await response.arrayBuffer();
      // Convert to base64 for transmission
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      sendResponse({ 
        content: base64,
        contentType: contentType 
      });
    } else {
      // Read as text for text files
      const content = await response.text();
      sendResponse({ content });
    }
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handleFileDownload(message, sendResponse) {
  try {
    // Convert base64 to data URL
    const dataUrl = `data:${message.mimeType};base64,${message.data}`;
    
    // Use chrome.downloads API
    chrome.downloads.download({
      url: dataUrl,
      filename: message.filename,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ downloadId: downloadId });
      }
    });
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handleRenderingRequest(message, sendResponse) {
  try {
    // Ensure offscreen document exists
    await ensureOffscreenDocument();
    
    // Send message to offscreen document
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        // Don't immediately reset on communication failure - it might be temporary
        // Only reset if the error suggests the document is gone
        if (chrome.runtime.lastError.message.includes('receiving end does not exist')) {
          offscreenCreated = false;
        }
        sendResponse({ error: `Offscreen communication failed: ${chrome.runtime.lastError.message}` });
      } else if (!response) {
        sendResponse({ error: 'No response from offscreen document. Document may have failed to load.' });
      } else {
        sendResponse(response);
      }
    });
    
  } catch (error) {
    sendResponse({ error: `Offscreen setup failed: ${error.message}` });
  }
}

async function ensureOffscreenDocument() {
  // If already created, return immediately
  if (offscreenCreated) {
    return;
  }
  
  // Try to create offscreen document
  // Multiple concurrent requests might try to create, but that's OK
  try {
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    
    await chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ['DOM_SCRAPING'],
      justification: 'Render Mermaid diagrams, SVG and HTML to PNG'
    });
    
    offscreenCreated = true;
    
  } catch (error) {
    // If error is about document already existing, that's fine
    if (error.message.includes('already exists') || error.message.includes('Only a single offscreen')) {
      offscreenCreated = true;
      return;
    }
    
    // For other errors, throw them
    throw new Error(`Failed to create offscreen document: ${error.message}`);
  }
}

// Handle dynamic content script injection
async function handleContentScriptInjection(tabId, sendResponse) {
  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId: tabId },
      files: ['styles.css']
    });
    
    // Then inject JavaScript
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    
    sendResponse({ success: true });
    
  } catch (error) {
    sendResponse({ error: error.message });
  }
}

async function handlePrintDocument(message, sender, sendResponse) {
  const payload = message?.payload || {};
  const html = typeof payload.html === 'string' ? payload.html : '';
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Document';
  const filename = typeof payload.filename === 'string' ? payload.filename : '';

  const token = createPrintToken();
  const job = {
    html,
    title,
    filename,
    createdAt: Date.now(),
    sourceTabId: sender?.tab?.id ?? null,
    tabId: null,
    chunkSize: PRINT_CHUNK_SIZE
  };

  printJobs.set(token, job);

  launchPrintTab(token, job, sendResponse);
}

function handlePrintJobInit(message, sender, sendResponse) {
  const payload = message?.payload || {};
  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Document';
  const filename = typeof payload.filename === 'string' ? payload.filename : '';

  const token = createPrintToken();
  const job = {
    html: '',
    chunks: [],
    title,
    filename,
    expectedSize: typeof payload.htmlLength === 'number' ? payload.htmlLength : null,
    createdAt: Date.now(),
    sourceTabId: sender?.tab?.id ?? null,
    tabId: null
  };

  printJobs.set(token, job);
  sendResponse({ success: true, token });
}

function handlePrintJobChunk(message, sendResponse) {
  const token = message?.token;
  const chunk = typeof message?.chunk === 'string' ? message.chunk : null;

  if (!token || chunk === null) {
    sendResponse({ error: 'Invalid print chunk payload' });
    return;
  }

  const job = printJobs.get(token);
  if (!job) {
    sendResponse({ error: 'Print job not found' });
    return;
  }

  if (!Array.isArray(job.chunks)) {
    job.chunks = [];
  }

  job.chunks.push(chunk);
  job.chunkBytes = (job.chunkBytes || 0) + chunk.length;
  job.lastChunkTime = Date.now();

  sendResponse({ success: true });
}

function handlePrintJobFinalize(message, sendResponse) {
  const token = message?.token;
  if (!token) {
    sendResponse({ error: 'Missing print job token' });
    return;
  }

  const job = printJobs.get(token);
  if (!job) {
    sendResponse({ error: 'Print job not found' });
    return;
  }

  if (typeof job.html === 'string' && job.html.length > 0 && !Array.isArray(job.chunks)) {
    launchPrintTab(token, job, sendResponse);
    return;
  }

  const chunks = Array.isArray(job.chunks) ? job.chunks : [];
  job.html = chunks.join('');
  delete job.chunks;
  job.chunkSize = PRINT_CHUNK_SIZE;

  launchPrintTab(token, job, sendResponse);
}

async function launchPrintTab(token, job, sendResponse) {
  try {
    const url = chrome.runtime.getURL(`print.html?token=${encodeURIComponent(token)}`);
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.create({ url, active: true }, (createdTab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(createdTab);
      });
    });

    if (tab && typeof tab.id === 'number') {
      job.tabId = tab.id;
    }

    sendResponse({ success: true, token });
  } catch (error) {
    printJobs.delete(token);
    sendResponse({ error: error?.message || 'Failed to create print tab' });
  }
}

function handlePrintJobRequest(message, sender, sendResponse) {
  const token = message?.token;
  if (!token || !printJobs.has(token)) {
    sendResponse({ error: 'Print job not found' });
    return;
  }

  const job = printJobs.get(token);
  if (!job.tabId && sender?.tab?.id) {
    job.tabId = sender.tab.id;
  }

  if (typeof job.html !== 'string') {
    sendResponse({ error: 'Print job is not ready' });
    return;
  }

  const chunkSize = typeof job.chunkSize === 'number' ? job.chunkSize : PRINT_CHUNK_SIZE;

  sendResponse({
    success: true,
    payload: {
      title: job.title,
      filename: job.filename,
      length: job.html.length,
      chunkSize
    }
  });
}

async function handlePrintJobComplete(message, sender, sendResponse) {
  const token = message?.token;
  if (!token) {
    sendResponse({ error: 'Missing print job token' });
    return;
  }

  const job = cleanupPrintJob(token);
  if (!job) {
    sendResponse({ success: true });
    return;
  }

  if (message?.closeTab !== false && typeof job.tabId === 'number') {
    try {
        await new Promise((resolve, reject) => {
          chrome.tabs.remove(job.tabId, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve();
          });
        });
    } catch (error) {
      // Ignore removal errors
    }
  }

  sendResponse({ success: true });
}

function cleanupPrintJob(token) {
  if (!printJobs.has(token)) {
    return null;
  }
  const job = printJobs.get(token);
  printJobs.delete(token);
  return job;
}

function handlePrintJobFetchChunk(message, sendResponse) {
  const token = message?.token;
  const offset = typeof message?.offset === 'number' && message.offset >= 0 ? message.offset : 0;
  const length = typeof message?.length === 'number' && message.length > 0 ? message.length : PRINT_CHUNK_SIZE;

  if (!token || !printJobs.has(token)) {
    sendResponse({ error: 'Print job not found' });
    return;
  }

  const job = printJobs.get(token);
  if (typeof job.html !== 'string') {
    sendResponse({ error: 'Print data unavailable' });
    return;
  }

  if (offset >= job.html.length) {
    sendResponse({ success: true, chunk: '', nextOffset: job.html.length });
    return;
  }

  const chunk = job.html.slice(offset, Math.min(offset + length, job.html.length));
  const nextOffset = offset + chunk.length;

  sendResponse({ success: true, chunk, nextOffset });
}