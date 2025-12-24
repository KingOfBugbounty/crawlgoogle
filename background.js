// CrawlGoogle Extension - Background Service Worker
// Author: ofjaaah

let connectionStatus = { connected: false, lastError: null, lastSuccess: null };
let pendingDomains = [];
let retryTimeout = null;
const MAX_RETRY_DELAY = 30000;
const INITIAL_RETRY_DELAY = 2000;
let currentRetryDelay = INITIAL_RETRY_DELAY;

const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.log('[CrawlGoogle BG]', ...args);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  log('Extension installed - by ofjaaah');

  // Initialize storage
  chrome.storage.local.set({
    domains: [],
    sentDomains: 0,
    autoExtract: false,
    useHttps: false,
    isCollecting: false
  });
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('Received message:', message.type, message);

  switch (message.type) {
    case 'CONFIG_UPDATED':
      log(`Config updated: ${message.vpsIp}:${message.vpsPort}`);
      testConnection(message.vpsIp, message.vpsPort).then(result => {
        log('Connection test result:', result);
        sendResponse(result);
      });
      return true;

    case 'AUTO_EXTRACT_CHANGED':
      log(`Auto-extract: ${message.enabled}`);
      notifyAllTabs(message);
      sendResponse({ success: true });
      break;

    case 'COLLECT_MODE_CHANGED':
      log(`Collect mode: ${message.collectFullUrl ? 'Full URL' : 'Domain only'}`);
      notifyAllTabs(message);
      sendResponse({ success: true });
      break;

    case 'SEND_TO_VPS':
      log(`Received ${message.domains?.length} domains to send to VPS`);
      if (message.domains && message.domains.length > 0) {
        sendDomainsToVPS(message.domains);
      }
      sendResponse({ success: true, received: message.domains?.length });
      break;

    case 'GET_CONNECTION_STATUS':
      sendResponse(connectionStatus);
      return true;

    case 'STATS_UPDATED':
      break;

    case 'RETRY_PENDING':
      retryPendingDomains();
      sendResponse({ success: true });
      break;

    case 'PING':
      sendResponse({ success: true, message: 'Background script is alive' });
      break;
  }

  return true;
});

// Send domains to VPS with retry logic
async function sendDomainsToVPS(domains) {
  if (!domains || domains.length === 0) {
    log('No domains to send');
    return;
  }

  log(`Attempting to send ${domains.length} domains to VPS...`);

  const config = await chrome.storage.local.get(['vpsIp', 'vpsPort', 'useHttps']);

  if (!config.vpsIp || !config.vpsPort) {
    log('VPS not configured, queuing domains');
    pendingDomains = [...new Set([...pendingDomains, ...domains])];
    log(`Pending domains count: ${pendingDomains.length}`);
    return;
  }

  log(`VPS Config: IP=${config.vpsIp}, Port=${config.vpsPort}`);

  // Try HTTP first (more likely to work without SSL issues)
  const protocols = ['http', 'https'];

  for (const protocol of protocols) {
    const url = `${protocol}://${config.vpsIp}:${config.vpsPort}/domains`;

    try {
      log(`Trying ${protocol.toUpperCase()}: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        log(`TIMEOUT after 10s for ${url}`);
        controller.abort();
      }, 10000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ domains: domains }),
        signal: controller.signal,
        mode: 'cors'
      });

      clearTimeout(timeoutId);

      log(`Response status: ${response.status}`);

      if (response.ok) {
        const result = await response.json();
        log(`SUCCESS! Sent ${domains.length} domains via ${protocol.toUpperCase()}:`, result);

        connectionStatus = {
          connected: true,
          lastError: null,
          lastSuccess: Date.now()
        };

        // Update protocol preference if different
        if ((protocol === 'https') !== config.useHttps) {
          await chrome.storage.local.set({ useHttps: protocol === 'https' });
        }

        // Update sent count
        const data = await chrome.storage.local.get(['sentDomains']);
        await chrome.storage.local.set({
          sentDomains: (data.sentDomains || 0) + domains.length
        });

        // Notify popup about success
        chrome.runtime.sendMessage({
          type: 'VPS_SEND_SUCCESS',
          count: domains.length,
          result: result
        }).catch(() => {});

        // Reset retry delay on success
        currentRetryDelay = INITIAL_RETRY_DELAY;

        // Send any pending domains
        if (pendingDomains.length > 0) {
          const toSend = [...pendingDomains];
          pendingDomains = [];
          log(`Sending ${toSend.length} pending domains...`);
          setTimeout(() => sendDomainsToVPS(toSend), 500);
        }

        return;
      } else {
        const errorText = await response.text();
        log(`${protocol.toUpperCase()} returned ${response.status}: ${errorText}`);
      }
    } catch (error) {
      log(`${protocol.toUpperCase()} FAILED:`, error.name, error.message);
      if (error.name === 'AbortError') {
        log('  -> Request timed out (VPS unreachable or port blocked)');
      } else if (error.name === 'TypeError') {
        log('  -> Network error (check firewall, CORS, or VPS status)');
      }
    }
  }

  // All attempts failed - queue domains for retry
  log('All connection attempts failed, queuing for retry');
  pendingDomains = [...new Set([...pendingDomains, ...domains])];

  connectionStatus = {
    connected: false,
    lastError: 'Connection failed',
    lastSuccess: connectionStatus.lastSuccess
  };

  chrome.runtime.sendMessage({
    type: 'VPS_SEND_ERROR',
    error: 'Connection failed - domains queued for retry',
    pendingCount: pendingDomains.length
  }).catch(() => {});

  // Schedule retry with exponential backoff
  scheduleRetry();
}

function scheduleRetry() {
  if (retryTimeout) {
    clearTimeout(retryTimeout);
  }

  log(`Scheduling retry in ${currentRetryDelay}ms`);

  retryTimeout = setTimeout(() => {
    retryPendingDomains();
  }, currentRetryDelay);

  // Increase delay for next retry (exponential backoff)
  currentRetryDelay = Math.min(currentRetryDelay * 2, MAX_RETRY_DELAY);
}

async function retryPendingDomains() {
  if (pendingDomains.length === 0) return;

  log(`Retrying ${pendingDomains.length} pending domains`);
  const toSend = [...pendingDomains];
  pendingDomains = [];
  await sendDomainsToVPS(toSend);
}

// Test connection to VPS
async function testConnection(ip, port) {
  const protocols = ['http', 'https'];

  for (const protocol of protocols) {
    try {
      const url = `${protocol}://${ip}:${port}/ping`;
      log(`Testing connection: ${url}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        log(`VPS connection successful via ${protocol.toUpperCase()}:`, data);
        await chrome.storage.local.set({ useHttps: protocol === 'https' });

        connectionStatus = {
          connected: true,
          lastError: null,
          lastSuccess: Date.now()
        };

        // Reset retry delay on successful connection
        currentRetryDelay = INITIAL_RETRY_DELAY;

        return { success: true, protocol: protocol, data: data };
      }
    } catch (error) {
      log(`${protocol.toUpperCase()} test failed:`, error.message);
    }
  }

  connectionStatus = {
    connected: false,
    lastError: 'Connection test failed',
    lastSuccess: connectionStatus.lastSuccess
  };

  return { success: false, error: 'Could not connect via HTTP or HTTPS' };
}

// Notify all Google tabs about changes
async function notifyAllTabs(message) {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        '*://www.google.com/*',
        '*://www.google.com.br/*',
        '*://www.google.co.uk/*',
        '*://www.google.ca/*',
        '*://www.google.de/*',
        '*://www.google.fr/*',
        '*://www.google.es/*',
        '*://www.google.it/*',
        '*://www.google.pt/*',
        '*://www.google.*/*'
      ]
    });

    log(`Notifying ${tabs.length} Google tabs`);

    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
        log(`Notified tab ${tab.id}`);
      } catch (e) {
        // Tab might not have content script loaded
        log(`Could not notify tab ${tab.id}:`, e.message);
      }
    }
  } catch (error) {
    log('Error notifying tabs:', error.message);
  }
}

// Handle tab updates for auto-extraction
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // Check if it's a Google search page
    const isGoogleSearch = /^https?:\/\/(www\.)?google\.[a-z.]+\/search/.test(tab.url);

    if (isGoogleSearch) {
      log(`Google search page loaded: ${tab.url}`);

      const config = await chrome.storage.local.get(['autoExtract', 'isCollecting']);

      // Only trigger extraction if BOTH autoExtract and isCollecting are enabled
      if (config.autoExtract && config.isCollecting) {
        // Wait for page to fully load then trigger extraction
        log('Triggering extraction on tab', tabId);
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_NOW' }).catch((e) => {
            log('Could not send EXTRACT_NOW to tab:', e.message);
          });
        }, 1500);
      } else {
        log('Collection is STOPPED - not triggering extraction');
      }
    }
  }
});

// Periodic retry of pending domains
setInterval(() => {
  if (pendingDomains.length > 0) {
    log(`Periodic retry: ${pendingDomains.length} pending domains`);
    retryPendingDomains();
  }
}, 60000);

log('Background service worker started - by ofjaaah');
