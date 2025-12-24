// CrawlGoogle Extension - Content Script
// Author: ofjaaah
// Extracts ONLY domains (no http/https) from Google search results

(function() {
  'use strict';

  let isAutoExtractEnabled = false;
  let collectFullUrl = false; // New: toggle between domain and full URL
  let extractedDomains = new Set();
  let lastExtractTime = 0;
  const EXTRACT_INTERVAL = 500; // Reduced for faster extraction
  const DEBUG = true; // Enable debug logging

  // Blacklist of domains to ignore
  const BLACKLIST = [
    'google.com', 'google.com.br', 'google.co.uk', 'google.ca', 'google.de',
    'google.fr', 'google.es', 'google.it', 'google.pt', 'google.nl',
    'gstatic.com', 'googleapis.com', 'googleusercontent.com',
    'youtube.com', 'youtu.be', 'ggpht.com', 'gvt1.com', 'gvt2.com',
    'webcache.googleusercontent.com', 'translate.google.com', 'maps.google.com',
    'accounts.google.com', 'chrome.google.com', 'play.google.com', 'support.google.com',
    'developers.google.com', 'cloud.google.com', 'firebase.google.com', 'android.com',
    'blogger.com', 'blogspot.com', 'schema.org', 'w3.org', 'example.com',
    'localhost', '127.0.0.1', 'wikipedia.org', 'wikimedia.org'
  ];

  // Auto-pagination settings
  let autoPaginationEnabled = false;
  let currentPaginationPage = 1;
  let maxPaginationPages = 50;
  let paginationDelay = 2000;
  let isPaginationRunning = false;

  // Initialize
  init();

  async function init() {
    try {
      log('Initializing CrawlGoogle...');

      const config = await chrome.storage.local.get(['autoExtract', 'domains', 'collectFullUrl', 'autoPagination', 'maxPages', 'paginationDelay']);
      isAutoExtractEnabled = config.autoExtract || false;
      collectFullUrl = config.collectFullUrl || false;
      autoPaginationEnabled = config.autoPagination || false;
      maxPaginationPages = config.maxPages || 50;
      paginationDelay = config.paginationDelay || 2000;

      log(`Collect mode: ${collectFullUrl ? 'Full URL' : 'Domain only'}`);
      log(`Auto-pagination: ${autoPaginationEnabled ? 'ENABLED' : 'DISABLED'}`);

      if (config.domains && Array.isArray(config.domains)) {
        config.domains.forEach(d => extractedDomains.add(d));
        log(`Loaded ${config.domains.length} existing domains from storage`);
      }

      if (isAutoExtractEnabled) {
        log('Auto-extract is ENABLED');
        startAutoExtract();
      } else {
        log('Auto-extract is DISABLED');
      }

      // Listen for messages
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        log('Received message:', message.type);
        try {
          if (message.type === 'EXTRACT_NOW') {
            // Only extract if collection is active
            if (!isAutoExtractEnabled) {
              log('EXTRACT_NOW: Collection is STOPPED - ignoring');
              sendResponse({ domains: [], success: false, reason: 'Collection stopped' });
            } else {
              const domains = extractDomains();
              log(`EXTRACT_NOW: Found ${domains.length} domains`);
              sendResponse({ domains: domains, success: true });
            }
          } else if (message.type === 'AUTO_EXTRACT_CHANGED') {
            isAutoExtractEnabled = message.enabled;
            log(`Auto-extract changed to: ${isAutoExtractEnabled}`);
            if (isAutoExtractEnabled) {
              startAutoExtract();
            }
            sendResponse({ success: true });
          } else if (message.type === 'COLLECT_MODE_CHANGED') {
            collectFullUrl = message.collectFullUrl;
            log(`Collect mode changed to: ${collectFullUrl ? 'Full URL' : 'Domain only'}`);
            sendResponse({ success: true });
          } else if (message.type === 'START_PAGINATION') {
            autoPaginationEnabled = true;
            maxPaginationPages = message.maxPages || 50;
            paginationDelay = message.delay || 2000;
            currentPaginationPage = 1;
            log(`Starting auto-pagination: max ${maxPaginationPages} pages, delay ${paginationDelay}ms`);
            startAutoPagination();
            sendResponse({ success: true });
          } else if (message.type === 'STOP_PAGINATION') {
            autoPaginationEnabled = false;
            isPaginationRunning = false;
            log('Auto-pagination STOPPED');
            sendResponse({ success: true });
          } else if (message.type === 'PING') {
            sendResponse({ success: true, message: 'Content script is alive' });
          }
        } catch (error) {
          log('Message handler error:', error);
          sendResponse({ success: false, error: error.message });
        }
        return true;
      });

      // Monitor for page changes
      observePageChanges();

      // Initial extraction after page load (only if collection is active)
      setTimeout(() => {
        if (isGoogleSearchPage() && isAutoExtractEnabled) {
          log('On Google search page, doing initial extraction...');
          extractDomains();
        } else if (isGoogleSearchPage() && !isAutoExtractEnabled) {
          log('On Google search page, but collection is STOPPED - skipping initial extraction');
        }
      }, 1000);

      console.log('[CrawlGoogle] ✓ Ready - by ofjaaah');
    } catch (error) {
      console.error('[CrawlGoogle] Init error:', error);
    }
  }

  function log(...args) {
    if (DEBUG) {
      console.log('[CrawlGoogle]', ...args);
    }
  }

  function isGoogleSearchPage() {
    return window.location.href.includes('/search') ||
           window.location.pathname === '/search';
  }

  function extractDomains() {
    // Check if collection is active - if not, don't collect anything
    if (!isAutoExtractEnabled) {
      log('Collection is STOPPED - skipping extraction');
      return [];
    }

    const now = Date.now();
    if (now - lastExtractTime < EXTRACT_INTERVAL) {
      return [];
    }
    lastExtractTime = now;

    if (!isGoogleSearchPage()) {
      log('Not on a search page, skipping extraction');
      return [];
    }

    const newDomains = [];
    const seenDomains = new Set();

    log('Starting domain extraction...');

    // === MULTIPLE EXTRACTION STRATEGIES ===
    // Helper to add item (URL or domain based on mode)
    const addItem = (url, domain) => {
      const item = collectFullUrl ? url : domain;
      if (item && !seenDomains.has(item)) {
        seenDomains.add(item);
        newDomains.push(item);
      }
    };

    // STRATEGY 1: Get ALL links with href starting with http (most comprehensive)
    document.querySelectorAll('a[href^="http"]').forEach(link => {
      const href = link.href;
      // Skip Google internal links
      if (href.includes('google.com/search') ||
          href.includes('google.com/url') ||
          href.includes('google.com/preferences') ||
          href.includes('google.com/advanced_search') ||
          href.includes('accounts.google.com') ||
          href.includes('support.google.com') ||
          href.includes('policies.google.com')) {
        return;
      }
      const result = extractFromUrl(href);
      if (result) addItem(result.url, result.domain);
    });

    // STRATEGY 2: Get from search result containers
    document.querySelectorAll('#search a[href^="http"], #rso a[href^="http"], #botstuff a[href^="http"]').forEach(link => {
      const result = extractFromUrl(link.href);
      if (result) addItem(result.url, result.domain);
    });

    // STRATEGY 3: Get from data-ved links (Google's tracking links)
    document.querySelectorAll('a[data-ved][href^="http"]').forEach(link => {
      if (!link.href.includes('google.com/search') && !link.href.includes('google.com/url')) {
        const result = extractFromUrl(link.href);
        if (result) addItem(result.url, result.domain);
      }
    });

    // STRATEGY 4: Get from div with data-header-feature attribute (Knowledge Panel)
    document.querySelectorAll('div[data-attrid] a[href^="http"]').forEach(link => {
      const result = extractFromUrl(link.href);
      if (result) addItem(result.url, result.domain);
    });

    // STRATEGY 5: Get from "People also ask" section
    document.querySelectorAll('.related-question-pair a[href^="http"]').forEach(link => {
      const result = extractFromUrl(link.href);
      if (result) addItem(result.url, result.domain);
    });

    // STRATEGY 6: General fallback - any link in main content area
    document.querySelectorAll('#center_col a[href^="http"], #main a[href^="http"]').forEach(link => {
      if (!link.closest('g-scrolling-carousel') && !link.href.includes('google.')) {
        const result = extractFromUrl(link.href);
        if (result) addItem(result.url, result.domain);
      }
    });

    // STRATEGY 7: Get from all result containers
    document.querySelectorAll('[data-sokoban-container] a[href^="http"], [data-hveid] a[href^="http"]').forEach(link => {
      const result = extractFromUrl(link.href);
      if (result) addItem(result.url, result.domain);
    });

    // STRATEGY 8: Get from organic results (multiple class patterns)
    document.querySelectorAll('.g a[href^="http"], .MjjYud a[href^="http"], .hlcw0c a[href^="http"]').forEach(link => {
      if (!link.href.includes('google.')) {
        const result = extractFromUrl(link.href);
        if (result) addItem(result.url, result.domain);
      }
    });

    // STRATEGY 9: Get from social media cards (Twitter/X, Facebook, etc)
    document.querySelectorAll('[data-init-vis="true"] a[href^="http"], .kCrYT a[href^="http"]').forEach(link => {
      const result = extractFromUrl(link.href);
      if (result) addItem(result.url, result.domain);
    });

    // STRATEGY 10: Get from cite elements (URL shown below title)
    document.querySelectorAll('cite').forEach(cite => {
      const text = cite.textContent || '';
      // Try to extract full URL first if mode is URL
      if (collectFullUrl) {
        const urlMatch = text.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          const result = extractFromUrl(urlMatch[0]);
          if (result) addItem(result.url, result.domain);
          return;
        }
      }
      const domain = extractDomainFromText(text);
      if (domain && !seenDomains.has(collectFullUrl ? `https://${domain}` : domain)) {
        if (collectFullUrl) {
          addItem(`https://${domain}`, domain);
        } else {
          seenDomains.add(domain);
          newDomains.push(domain);
        }
      }
    });

    // STRATEGY 11: Get from breadcrumb-style URLs
    document.querySelectorAll('.TbwUpd, .UPmit, .iUh30, .tjvcx, .byrV5b, .VuuXrf, .qLRx3b').forEach(el => {
      const text = el.textContent || '';
      const domain = extractDomainFromText(text);
      if (domain && !seenDomains.has(collectFullUrl ? `https://${domain}` : domain)) {
        if (collectFullUrl) {
          addItem(`https://${domain}`, domain);
        } else {
          seenDomains.add(domain);
          newDomains.push(domain);
        }
      }
    });

    // STRATEGY 12: Get from span elements that might contain URLs
    document.querySelectorAll('#search span[dir="ltr"], #rso span[dir="ltr"]').forEach(span => {
      const text = span.textContent || '';
      if (text.includes('.') && !text.includes(' ')) {
        const domain = extractDomainFromText(text);
        if (domain && !seenDomains.has(collectFullUrl ? `https://${domain}` : domain)) {
          if (collectFullUrl) {
            addItem(`https://${domain}`, domain);
          } else {
            seenDomains.add(domain);
            newDomains.push(domain);
          }
        }
      }
    });

    // STRATEGY 13: Extract from any visible URL text on page
    document.querySelectorAll('[class*="url"], [class*="Url"], [class*="link"], [class*="Link"]').forEach(el => {
      const text = el.textContent || '';
      if (text.includes('.') && text.length < 100) {
        const domain = extractDomainFromText(text);
        if (domain && !seenDomains.has(collectFullUrl ? `https://${domain}` : domain)) {
          if (collectFullUrl) {
            addItem(`https://${domain}`, domain);
          } else {
            seenDomains.add(domain);
            newDomains.push(domain);
          }
        }
      }
    });

    log(`Found ${seenDomains.size} total domains on page`);

    // Filter out already extracted and add new ones
    const uniqueNewDomains = newDomains.filter(d => {
      if (!extractedDomains.has(d)) {
        extractedDomains.add(d);
        return true;
      }
      return false;
    });

    if (uniqueNewDomains.length > 0) {
      log(`${uniqueNewDomains.length} NEW unique domains:`, uniqueNewDomains);

      saveDomains(uniqueNewDomains);
      sendToVPS(uniqueNewDomains);

      // Notify popup
      chrome.runtime.sendMessage({
        type: 'DOMAINS_EXTRACTED',
        count: uniqueNewDomains.length,
        domains: uniqueNewDomains
      }).catch(() => {});

      // Visual feedback
      showCollectionFeedback(uniqueNewDomains.length);
    } else {
      log('No new unique domains found');
    }

    return uniqueNewDomains;
  }

  // Extract both URL and domain from a link
  function extractFromUrl(url) {
    try {
      if (!url) return null;

      // Skip Google redirect URLs
      if (url.includes('google.com/url?')) {
        const match = url.match(/[?&]url=([^&]+)/);
        if (match) {
          url = decodeURIComponent(match[1]);
        }
      }

      const urlObj = new URL(url);
      let domain = urlObj.hostname.toLowerCase();

      // Remove www prefix
      domain = domain.replace(/^www\./, '');

      // Validate domain
      if (isValidDomain(domain)) {
        // Clean URL (remove tracking params, normalize)
        const cleanUrl = urlObj.origin + urlObj.pathname;
        return {
          url: cleanUrl,
          domain: domain
        };
      }
    } catch (e) {
      // Silently ignore URL parse errors
    }
    return null;
  }

  // Extract clean domain from URL (legacy, for compatibility)
  function extractDomainFromUrl(url) {
    const result = extractFromUrl(url);
    return result ? result.domain : null;
  }

  // Extract domain from text (like cite elements)
  function extractDomainFromText(text) {
    if (!text) return null;

    // Clean the text
    text = text.trim().toLowerCase();

    // Remove protocol if present (handle cases where https is concatenated)
    text = text.replace(/https?:\/\//g, ' ');
    text = text.replace(/https?/g, ' ');
    text = text.trim().split(/\s+/)[0];

    // Remove www
    text = text.replace(/^www\./, '');

    // Get only the domain part (before any path)
    let domain = text.split('/')[0];
    domain = domain.split(' ')[0];
    domain = domain.split(' › ')[0];
    domain = domain.split('>')[0].trim();
    domain = domain.split('›')[0].trim();
    domain = domain.split('...')[0].trim();

    // Remove port if present
    domain = domain.split(':')[0];

    // Validate
    if (isValidDomain(domain)) {
      return domain;
    }
    return null;
  }

  function isValidDomain(domain) {
    if (!domain || domain.length < 4 || domain.length > 253) return false;

    // Check blacklist
    for (const blocked of BLACKLIST) {
      if (domain === blocked || domain.endsWith('.' + blocked)) {
        return false;
      }
    }

    // Check if contains google
    if (domain.includes('google.') || domain.includes('.google')) {
      return false;
    }

    // Must have at least one dot and valid TLD
    const domainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
    if (!domainRegex.test(domain)) {
      return false;
    }

    // Must have at least one dot
    if (!domain.includes('.')) {
      return false;
    }

    // TLD must be at least 2 chars
    const parts = domain.split('.');
    const tld = parts[parts.length - 1];
    if (tld.length < 2) {
      return false;
    }

    return true;
  }

  async function saveDomains(newDomains) {
    try {
      const data = await chrome.storage.local.get(['domains']);
      const existingDomains = data.domains || [];

      // Create a map of normalized -> original for deduplication
      const normalizedMap = new Map();

      // Add existing domains first
      for (const domain of existingDomains) {
        const normalized = collectFullUrl ? normalizeUrl(domain) : normalizeDomain(domain);
        if (normalized && !normalizedMap.has(normalized)) {
          normalizedMap.set(normalized, domain);
        }
      }

      // Add new domains (only if not duplicate)
      for (const domain of newDomains) {
        const normalized = collectFullUrl ? normalizeUrl(domain) : normalizeDomain(domain);
        if (normalized && !normalizedMap.has(normalized)) {
          normalizedMap.set(normalized, domain);
        }
      }

      const allDomains = Array.from(normalizedMap.values());

      await chrome.storage.local.set({ domains: allDomains });
      log(`Saved ${allDomains.length} total unique domains to storage (deduped from ${existingDomains.length + newDomains.length})`);
      chrome.runtime.sendMessage({ type: 'STATS_UPDATED' }).catch(() => {});
    } catch (error) {
      console.error('[CrawlGoogle] Save error:', error);
    }
  }

  // Send via background script to avoid mixed content blocking
  function sendToVPS(domains) {
    if (!domains || domains.length === 0) return;

    log(`Sending ${domains.length} domains to background for VPS...`);

    chrome.runtime.sendMessage({
      type: 'SEND_TO_VPS',
      domains: domains
    }).then((response) => {
      log('Background acknowledged:', response);
    }).catch((error) => {
      log('Background message error:', error);
    });
  }

  function showCollectionFeedback(count) {
    const existing = document.getElementById('crawlgoogle-feedback');
    if (existing) existing.remove();

    const feedback = document.createElement('div');
    feedback.id = 'crawlgoogle-feedback';
    feedback.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #e94560 0%, #c73e54 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        z-index: 999999;
        box-shadow: 0 4px 15px rgba(233, 69, 96, 0.4);
        animation: cgSlideIn 0.3s ease;
      ">
        ✓ +${count} domains collected
      </div>
      <style>
        @keyframes cgSlideIn {
          from { transform: translateX(100px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      </style>
    `;
    document.body.appendChild(feedback);

    setTimeout(() => {
      if (feedback.parentNode) {
        feedback.remove();
      }
    }, 2500);
  }

  function startAutoExtract() {
    log('Starting auto-extract mode...');

    // Initial extraction
    setTimeout(extractDomains, 500);

    // Observe DOM changes
    const observer = new MutationObserver((mutations) => {
      if (isAutoExtractEnabled) {
        // Debounce mutations
        clearTimeout(window._cgMutationTimeout);
        window._cgMutationTimeout = setTimeout(extractDomains, 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function observePageChanges() {
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      if (!isAutoExtractEnabled) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(extractDomains, 500);
    }, { passive: true });

    // Handle navigation within Google (SPA-like behavior)
    window.addEventListener('popstate', () => {
      if (isAutoExtractEnabled) {
        setTimeout(extractDomains, 1000);
      }
    });

    // Handle hash changes
    window.addEventListener('hashchange', () => {
      if (isAutoExtractEnabled) {
        setTimeout(extractDomains, 500);
      }
    });

    // Periodically check for new content
    setInterval(() => {
      if (isAutoExtractEnabled && isGoogleSearchPage()) {
        extractDomains();
      }
    }, 3000);
  }

  // === NORMALIZE DOMAIN FOR DEDUPLICATION ===
  function normalizeDomain(domain) {
    if (!domain) return null;

    let normalized = domain.toLowerCase().trim();

    // Remove protocol
    normalized = normalized.replace(/^https?:\/\//, '');

    // Remove www. prefix
    normalized = normalized.replace(/^www\./, '');

    // Remove trailing slash
    normalized = normalized.replace(/\/+$/, '');

    // Remove port
    normalized = normalized.split(':')[0];

    // Remove path for domain-only comparison
    normalized = normalized.split('/')[0];

    return normalized;
  }

  // === NORMALIZE URL FOR DEDUPLICATION ===
  function normalizeUrl(url) {
    if (!url) return null;

    try {
      const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);

      // Normalize: lowercase host, remove www, clean path
      let host = urlObj.hostname.toLowerCase().replace(/^www\./, '');
      let path = urlObj.pathname.replace(/\/+$/, '') || '/';

      // Remove common tracking parameters
      const cleanParams = new URLSearchParams();
      const skipParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                         'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid'];

      urlObj.searchParams.forEach((value, key) => {
        if (!skipParams.includes(key.toLowerCase())) {
          cleanParams.append(key, value);
        }
      });

      const queryString = cleanParams.toString();
      return `https://${host}${path}${queryString ? '?' + queryString : ''}`;
    } catch (e) {
      return url;
    }
  }

  // === CHECK IF DOMAIN/URL ALREADY EXISTS (NORMALIZED) ===
  function isDuplicate(item) {
    const normalized = collectFullUrl ? normalizeUrl(item) : normalizeDomain(item);

    for (const existing of extractedDomains) {
      const existingNormalized = collectFullUrl ? normalizeUrl(existing) : normalizeDomain(existing);
      if (normalized === existingNormalized) {
        return true;
      }
    }
    return false;
  }

  // === AUTO-PAGINATION FUNCTIONS ===
  async function startAutoPagination() {
    if (isPaginationRunning) {
      log('Pagination already running');
      return;
    }

    isPaginationRunning = true;
    currentPaginationPage = 1;

    log(`Starting auto-pagination through ${maxPaginationPages} pages...`);
    showPaginationFeedback(`Pagination started - Page 1`);

    // Extract from current page first
    extractDomains();

    // Wait and then navigate to next page
    await delay(paginationDelay);

    while (autoPaginationEnabled && isPaginationRunning && currentPaginationPage < maxPaginationPages) {
      const hasNextPage = await goToNextPage();

      if (!hasNextPage) {
        log('No more pages available');
        showPaginationFeedback('Pagination complete - No more pages');
        break;
      }

      currentPaginationPage++;
      log(`Navigated to page ${currentPaginationPage}`);
      showPaginationFeedback(`Collecting page ${currentPaginationPage}/${maxPaginationPages}`);

      // Wait for page to load
      await delay(1500);

      // Extract domains from this page
      extractDomains();

      // Notify about progress
      chrome.runtime.sendMessage({
        type: 'PAGINATION_PROGRESS',
        currentPage: currentPaginationPage,
        maxPages: maxPaginationPages
      }).catch(() => {});

      // Wait before next page
      await delay(paginationDelay);
    }

    isPaginationRunning = false;

    if (currentPaginationPage >= maxPaginationPages) {
      showPaginationFeedback(`Pagination complete - ${maxPaginationPages} pages collected`);
    }

    chrome.runtime.sendMessage({
      type: 'PAGINATION_COMPLETE',
      pagesCollected: currentPaginationPage
    }).catch(() => {});

    log(`Auto-pagination finished. Collected from ${currentPaginationPage} pages`);
  }

  async function goToNextPage() {
    // Try multiple selectors for Google's "Next" button
    const nextSelectors = [
      '#pnnext',                           // Standard next button
      'a[aria-label="Next page"]',         // Aria label
      'a[id="pnnext"]',                    // ID selector
      'td.navend a',                       // Old style
      'a.fl[style*="text-align:left"]',    // Numbered pagination
      '.d6cvqb a[aria-label="Page 2"]',    // First navigation from page 1
      'a[aria-label*="Next"]',             // Any next label
      'span:contains("Next") a',           // Text-based
    ];

    // Also try to find numbered pagination
    const pageNum = currentPaginationPage + 1;
    nextSelectors.push(`a[aria-label="Page ${pageNum}"]`);
    nextSelectors.push(`td a[aria-label="Page ${pageNum}"]`);

    for (const selector of nextSelectors) {
      try {
        const nextBtn = document.querySelector(selector);
        if (nextBtn && nextBtn.href) {
          log(`Found next page button with selector: ${selector}`);

          // Click the button
          nextBtn.click();

          // Wait for navigation
          await waitForNavigation();
          return true;
        }
      } catch (e) {
        // Try next selector
      }
    }

    // Fallback: Look for any link that looks like pagination
    const allLinks = document.querySelectorAll('a[href*="start="]');
    for (const link of allLinks) {
      const href = link.href;
      const match = href.match(/start=(\d+)/);
      if (match) {
        const startNum = parseInt(match[1]);
        const expectedStart = currentPaginationPage * 10;
        if (startNum === expectedStart) {
          log(`Found pagination link via start parameter: ${href}`);
          link.click();
          await waitForNavigation();
          return true;
        }
      }
    }

    return false;
  }

  function waitForNavigation() {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const maxWait = 10000;

      const checkLoaded = () => {
        if (Date.now() - startTime > maxWait) {
          resolve();
          return;
        }

        // Check if new results are loaded
        const results = document.querySelectorAll('#search .g, #rso .g');
        if (results.length > 0 && document.readyState === 'complete') {
          resolve();
          return;
        }

        setTimeout(checkLoaded, 200);
      };

      checkLoaded();
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function showPaginationFeedback(message) {
    const existing = document.getElementById('crawlgoogle-pagination-feedback');
    if (existing) existing.remove();

    const feedback = document.createElement('div');
    feedback.id = 'crawlgoogle-pagination-feedback';
    feedback.innerHTML = `
      <div style="
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        font-weight: bold;
        z-index: 999999;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      ">
        ${message}
      </div>
    `;
    document.body.appendChild(feedback);

    setTimeout(() => {
      if (feedback.parentNode) {
        feedback.remove();
      }
    }, 3000);
  }
})();
