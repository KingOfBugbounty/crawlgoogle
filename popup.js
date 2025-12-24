// CrawlGoogle Extension - Popup Script
// Author: ofjaaah
// Auto-collects domains while browsing Google

document.addEventListener('DOMContentLoaded', async () => {
  const vpsIpInput = document.getElementById('vps-ip');
  const vpsPortInput = document.getElementById('vps-port');
  const saveConfigBtn = document.getElementById('save-config');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const connectionInfo = document.getElementById('connection-info');
  const clearDomainsBtn = document.getElementById('clear-domains');
  const domainsCount = document.getElementById('domains-count');
  const sentCount = document.getElementById('sent-count');
  const domainsList = document.getElementById('domains-list');
  const collectingIndicator = document.getElementById('collecting-indicator');
  const stopBtn = document.getElementById('stop-btn');
  const startBtn = document.getElementById('start-btn');
  const collectFullUrlToggle = document.getElementById('collect-full-url');
  const modeLabel = document.getElementById('mode-label');

  // Pagination elements
  const maxPagesInput = document.getElementById('max-pages');
  const pageDelayInput = document.getElementById('page-delay');
  const startPaginationBtn = document.getElementById('start-pagination');
  const stopPaginationBtn = document.getElementById('stop-pagination');
  const paginationStatus = document.getElementById('pagination-status');
  const currentPageSpan = document.getElementById('current-page');
  const maxPageDisplay = document.getElementById('max-page-display');

  let isInitialized = false;
  let isPaginationActive = false;

  // Load saved configuration
  try {
    const config = await chrome.storage.local.get([
      'vpsIp', 'vpsPort', 'isCollecting', 'domains', 'sentDomains', 'useHttps', 'autoExtract', 'collectFullUrl'
    ]);

    if (config.vpsIp) {
      vpsIpInput.value = config.vpsIp;
    }
    if (config.vpsPort) {
      vpsPortInput.value = config.vpsPort;
    } else {
      vpsPortInput.value = '9876';
    }

    // Load collect mode toggle
    if (config.collectFullUrl) {
      collectFullUrlToggle.checked = true;
      modeLabel.textContent = 'Full URL';
    } else {
      collectFullUrlToggle.checked = false;
      modeLabel.textContent = 'Domain only';
    }

    updateStatus(config.vpsIp, config.vpsPort, config.useHttps);
    updateStats(config.domains || [], config.sentDomains || 0);
    updateDomainsList(config.domains || []);

    // Show appropriate buttons based on state
    if (config.vpsIp && config.vpsPort) {
      if (config.isCollecting || config.autoExtract) {
        showCollectingState();
      } else {
        showStoppedState();
      }
    } else {
      showStoppedState();
    }

    isInitialized = true;
  } catch (error) {
    console.error('[CrawlGoogle] Init error:', error);
    showNotification('Error loading config', 'error');
  }

  // Handle collect mode toggle
  collectFullUrlToggle.addEventListener('change', async () => {
    const isFullUrl = collectFullUrlToggle.checked;
    modeLabel.textContent = isFullUrl ? 'Full URL' : 'Domain only';

    await chrome.storage.local.set({ collectFullUrl: isFullUrl });

    // Notify content scripts about the change
    chrome.runtime.sendMessage({
      type: 'COLLECT_MODE_CHANGED',
      collectFullUrl: isFullUrl
    });

    showNotification(isFullUrl ? 'Collecting full URLs' : 'Collecting domains only', 'success');
  });

  // Start pagination
  startPaginationBtn.addEventListener('click', async () => {
    const maxPages = parseInt(maxPagesInput.value) || 50;
    const delay = parseInt(pageDelayInput.value) || 2000;

    // Save settings
    await chrome.storage.local.set({
      maxPages: maxPages,
      paginationDelay: delay
    });

    // Get active tab and send message
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('google.')) {
      showNotification('Navigate to Google search first', 'error');
      return;
    }

    try {
      chrome.tabs.sendMessage(tab.id, {
        type: 'START_PAGINATION',
        maxPages: maxPages,
        delay: delay
      }, (response) => {
        if (chrome.runtime.lastError) {
          showNotification('Reload the Google page first', 'error');
          return;
        }

        if (response && response.success) {
          isPaginationActive = true;
          showPaginationRunning(maxPages);
          showNotification(`Pagination started - ${maxPages} pages`, 'success');
        }
      });
    } catch (error) {
      showNotification('Error starting pagination', 'error');
    }
  });

  // Stop pagination
  stopPaginationBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'STOP_PAGINATION' }, () => {
        isPaginationActive = false;
        showPaginationStopped();
        showNotification('Pagination stopped', 'success');
      });
    }
  });

  function showPaginationRunning(maxPages) {
    startPaginationBtn.classList.add('hidden');
    stopPaginationBtn.classList.remove('hidden');
    paginationStatus.classList.remove('hidden');
    maxPageDisplay.textContent = maxPages;
  }

  function showPaginationStopped() {
    startPaginationBtn.classList.remove('hidden');
    stopPaginationBtn.classList.add('hidden');
    paginationStatus.classList.add('hidden');
  }

  // Save configuration and START collecting
  saveConfigBtn.addEventListener('click', async () => {
    const vpsIp = vpsIpInput.value.trim();
    const vpsPort = parseInt(vpsPortInput.value.trim()) || 9876;

    if (!vpsIp) {
      showNotification('Enter VPS IP address', 'error');
      vpsIpInput.focus();
      return;
    }

    // Validate IP/hostname
    if (!isValidHostname(vpsIp)) {
      showNotification('Invalid IP or hostname', 'error');
      vpsIpInput.focus();
      return;
    }

    // Validate port
    if (vpsPort < 1 || vpsPort > 65535) {
      showNotification('Invalid port (1-65535)', 'error');
      vpsPortInput.focus();
      return;
    }

    saveConfigBtn.textContent = 'Testing...';
    saveConfigBtn.disabled = true;

    try {
      await chrome.storage.local.set({
        vpsIp: vpsIp,
        vpsPort: vpsPort,
        isCollecting: true,
        autoExtract: true
      });

      // Test connection and notify background
      chrome.runtime.sendMessage({
        type: 'CONFIG_UPDATED',
        vpsIp: vpsIp,
        vpsPort: vpsPort
      }, (response) => {
        saveConfigBtn.textContent = 'Save & Start Collecting';
        saveConfigBtn.disabled = false;

        if (chrome.runtime.lastError) {
          showNotification('Extension error - try reloading', 'error');
          return;
        }

        if (response && response.success) {
          const protocol = response.protocol ? response.protocol.toUpperCase() : 'HTTP';
          showNotification(`Connected via ${protocol}!`, 'success');
          updateStatus(vpsIp, vpsPort, response.protocol === 'https');
          showCollectingState();
        } else {
          showNotification('Saved! VPS not reachable yet', 'warning');
          updateStatus(vpsIp, vpsPort, false);
          showCollectingState();
        }
      });

      // Enable auto-extract in content script
      chrome.runtime.sendMessage({
        type: 'AUTO_EXTRACT_CHANGED',
        enabled: true
      });

    } catch (error) {
      saveConfigBtn.textContent = 'Save & Start Collecting';
      saveConfigBtn.disabled = false;
      showNotification('Error saving config', 'error');
    }
  });

  // STOP collecting
  stopBtn.addEventListener('click', async () => {
    try {
      await chrome.storage.local.set({
        isCollecting: false,
        autoExtract: false
      });

      showStoppedState();
      showNotification('Collection STOPPED', 'success');

      chrome.runtime.sendMessage({
        type: 'AUTO_EXTRACT_CHANGED',
        enabled: false
      });
    } catch (error) {
      showNotification('Error stopping', 'error');
    }
  });

  // START collecting
  startBtn.addEventListener('click', async () => {
    try {
      const cfg = await chrome.storage.local.get(['vpsIp', 'vpsPort']);

      if (!cfg.vpsIp || !cfg.vpsPort) {
        showNotification('Configure VPS first', 'error');
        vpsIpInput.focus();
        return;
      }

      await chrome.storage.local.set({
        isCollecting: true,
        autoExtract: true
      });

      showCollectingState();
      showNotification('Collection STARTED', 'success');

      chrome.runtime.sendMessage({
        type: 'AUTO_EXTRACT_CHANGED',
        enabled: true
      });
    } catch (error) {
      showNotification('Error starting', 'error');
    }
  });

  // Clear domains
  clearDomainsBtn.addEventListener('click', async () => {
    if (!confirm('Clear all collected domains?')) {
      return;
    }

    try {
      await chrome.storage.local.set({
        domains: [],
        sentDomains: 0
      });

      updateStats([], 0);
      updateDomainsList([]);
      showNotification('All domains cleared', 'success');
    } catch (error) {
      showNotification('Error clearing', 'error');
    }
  });

  // Copy domains to clipboard
  domainsList.addEventListener('click', async (e) => {
    if (e.target.classList.contains('domain-item')) {
      const domain = e.target.textContent;
      try {
        await navigator.clipboard.writeText(domain);
        showNotification(`Copied: ${domain}`, 'success');
      } catch (err) {
        console.log('Copy failed:', err);
      }
    }
  });

  function isValidHostname(str) {
    if (!str) return false;
    // IP address pattern
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    // Hostname pattern
    const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

    if (ipPattern.test(str)) {
      // Validate IP octets
      const parts = str.split('.');
      return parts.every(p => parseInt(p) <= 255);
    }

    return hostnamePattern.test(str);
  }

  function showCollectingState() {
    collectingIndicator.classList.remove('hidden');
    stopBtn.classList.remove('hidden');
    startBtn.classList.add('hidden');
    statusDot.classList.add('collecting');
  }

  function showStoppedState() {
    collectingIndicator.classList.add('hidden');
    stopBtn.classList.add('hidden');
    startBtn.classList.remove('hidden');
    statusDot.classList.remove('collecting');
  }

  function updateStatus(ip, port, useHttps) {
    if (ip && port) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Configured';
      const protocol = useHttps ? 'https' : 'http';
      connectionInfo.textContent = `${protocol}://${ip}:${port}`;
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Not configured';
      connectionInfo.textContent = 'Enter VPS IP and save';
    }
  }

  function updateStats(domains, sent) {
    domainsCount.textContent = Array.isArray(domains) ? domains.length : 0;
    sentCount.textContent = sent || 0;
  }

  function updateDomainsList(domains) {
    if (!Array.isArray(domains) || domains.length === 0) {
      domainsList.innerHTML = '<p class="empty-message">No domains collected yet</p>';
      return;
    }

    const recentDomains = domains.slice(-30).reverse();
    domainsList.innerHTML = recentDomains
      .map(domain => `<div class="domain-item" title="Click to copy">${escapeHtml(domain)}</div>`)
      .join('');
  }

  async function refreshStats() {
    try {
      const data = await chrome.storage.local.get([
        'domains', 'sentDomains', 'useHttps', 'vpsIp', 'vpsPort', 'isCollecting', 'autoExtract'
      ]);

      updateStats(data.domains || [], data.sentDomains || 0);
      updateDomainsList(data.domains || []);
      updateStatus(data.vpsIp, data.vpsPort, data.useHttps);

      // Update button states
      if (data.vpsIp && data.vpsPort) {
        if (data.isCollecting || data.autoExtract) {
          showCollectingState();
        } else {
          showStoppedState();
        }
      }
    } catch (error) {
      console.error('[CrawlGoogle] Refresh error:', error);
    }
  }

  function showNotification(message, type) {
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 3000);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Listen for updates from background
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'STATS_UPDATED':
      case 'DOMAINS_EXTRACTED':
        refreshStats();
        break;

      case 'VPS_SEND_SUCCESS':
        statusDot.classList.add('pulse');
        setTimeout(() => statusDot.classList.remove('pulse'), 500);
        refreshStats();
        break;

      case 'VPS_SEND_ERROR':
        showNotification(`VPS Error: ${message.error}`, 'error');
        break;

      case 'PAGINATION_PROGRESS':
        currentPageSpan.textContent = message.currentPage;
        maxPageDisplay.textContent = message.maxPages;
        break;

      case 'PAGINATION_COMPLETE':
        isPaginationActive = false;
        showPaginationStopped();
        showNotification(`Pagination complete - ${message.pagesCollected} pages`, 'success');
        refreshStats();
        break;
    }
  });

  // Refresh stats periodically
  setInterval(refreshStats, 2000);

  // Initial refresh
  if (isInitialized) {
    refreshStats();
  }
});
