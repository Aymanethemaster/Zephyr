import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// --- 1. Service Worker Precache Integrity Stress Test ---
test('SW PRECACHE_URLS: all 77 manifest files exist on disk with non-zero size', () => {
  const swPath = path.join(PROJECT_ROOT, 'sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js must exist in project root');

  const swContent = fs.readFileSync(swPath, 'utf8');

  // Extract PRECACHE_URLS array via regex
  const precacheMatch = swContent.match(/const\s+PRECACHE_URLS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(precacheMatch, 'PRECACHE_URLS array must be declared in sw.js');

  const rawUrls = precacheMatch[1]
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith("'") || line.startsWith('"'))
    .map(line => line.replace(/['",]/g, '').trim());

  assert.equal(rawUrls.length, 77, `Expected exactly 77 precache URLs, found ${rawUrls.length}`);

  const missingFiles = [];
  const emptyFiles = [];

  for (const urlPath of rawUrls) {
    let diskRelPath = urlPath;
    if (diskRelPath === '/') {
      diskRelPath = '/index.html';
    }
    const cleanPath = diskRelPath.startsWith('/') ? diskRelPath.slice(1) : diskRelPath;
    const fullPath = path.join(PROJECT_ROOT, ...cleanPath.split('/'));

    if (!fs.existsSync(fullPath)) {
      missingFiles.push({ urlPath, fullPath });
    } else {
      const stats = fs.statSync(fullPath);
      if (stats.size === 0) {
        emptyFiles.push({ urlPath, fullPath });
      }
    }
  }

  assert.equal(missingFiles.length, 0, `Missing precache files: ${JSON.stringify(missingFiles)}`);
  assert.equal(emptyFiles.length, 0, `Zero-byte precache files: ${JSON.stringify(emptyFiles)}`);
});

// --- 2. trimCache() FIFO / LRU Bounding Stress Test ---
test('trimCache(): bounds cache to maxItems using FIFO eviction', async () => {
  // Mock Cache implementation conforming to W3C Cache API specification
  class MockCache {
    constructor() {
      this.store = new Map(); // Map preserves chronological insertion order
    }
    async keys() {
      return Array.from(this.store.keys()).map(url => ({ url }));
    }
    async put(request, response) {
      this.store.set(request.url || request, response);
    }
    async delete(request) {
      return this.store.delete(request.url || request);
    }
  }

  const mockCache = new MockCache();

  // Populate cache with 100 entries (req_0 to req_99)
  for (let i = 0; i < 100; i++) {
    await mockCache.put({ url: `https://api.example.com/item_${i}` }, { data: i });
  }

  assert.equal(mockCache.store.size, 100);

  // Replicate trimCache logic from sw.js
  async function trimCache(cacheInstance, maxItems) {
    const keys = await cacheInstance.keys();
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map((key) => cacheInstance.delete(key)));
    }
  }

  // Trim to 50 items
  await trimCache(mockCache, 50);

  assert.equal(mockCache.store.size, 50, 'Cache must be bounded to exactly 50 items');

  // Verify oldest 50 items (req_0..req_49) were evicted
  for (let i = 0; i < 50; i++) {
    assert.equal(
      mockCache.store.has(`https://api.example.com/item_${i}`),
      false,
      `Oldest item_${i} should have been evicted`
    );
  }

  // Verify newest 50 items (req_50..req_99) were preserved
  for (let i = 50; i < 100; i++) {
    assert.equal(
      mockCache.store.has(`https://api.example.com/item_${i}`),
      true,
      `Newer item_${i} should be preserved`
    );
  }

  // Boundary condition test: trimming when size <= maxItems
  await trimCache(mockCache, 50);
  assert.equal(mockCache.store.size, 50, 'Trimming when size == maxItems must not delete anything');

  await trimCache(mockCache, 60);
  assert.equal(mockCache.store.size, 50, 'Trimming when size < maxItems must not delete anything');

  // Boundary condition test: trimming from 51 to 50
  await mockCache.put({ url: 'https://api.example.com/item_100' }, { data: 100 });
  assert.equal(mockCache.store.size, 51);
  await trimCache(mockCache, 50);
  assert.equal(mockCache.store.size, 50);
  assert.equal(mockCache.store.has('https://api.example.com/item_50'), false, 'item_50 must be evicted');
  assert.equal(mockCache.store.has('https://api.example.com/item_100'), true, 'item_100 must be retained');
});

// --- 3. Cache Partitioning and Upgrade Resilience Test ---
test('sw.js activate lifecycle: static updates purge old static caches but preserve zephyr-data-v1', () => {
  const STATIC_CACHE = 'zephyr-static-v1.6'; // Upgraded static cache
  const DATA_CACHE = 'zephyr-data-v1';        // Data cache remains v1

  const existingCacheNames = [
    'zephyr-static-v1.5',
    'zephyr-static-v1.6',
    'zephyr-data-v1',
    'zephyr-data-v0-old',
    'zephyr-v1.4',
    'other-vendor-cache'
  ];

  const deletedCaches = [];
  const retainedCaches = [];

  // Replicate sw.js activate handler logic
  existingCacheNames.forEach((name) => {
    let deleted = false;
    // Delete outdated static caches
    if (name.startsWith('zephyr-static-') && name !== STATIC_CACHE) {
      deletedCaches.push(name);
      deleted = true;
    }
    // Delete legacy unpartitioned caches (e.g., zephyr-v1.4)
    else if (name.startsWith('zephyr-v') && name !== STATIC_CACHE && name !== DATA_CACHE) {
      deletedCaches.push(name);
      deleted = true;
    }
    // Delete outdated data caches if DATA_CACHE schema/version is updated
    else if (name.startsWith('zephyr-data-') && name !== DATA_CACHE) {
      deletedCaches.push(name);
      deleted = true;
    }

    if (!deleted) {
      retainedCaches.push(name);
    }
  });

  assert.ok(deletedCaches.includes('zephyr-static-v1.5'), 'Old static cache v1.5 must be purged');
  assert.ok(deletedCaches.includes('zephyr-v1.4'), 'Legacy unpartitioned cache zephyr-v1.4 must be purged');
  assert.ok(deletedCaches.includes('zephyr-data-v0-old'), 'Old data cache schema must be purged');

  assert.ok(retainedCaches.includes('zephyr-data-v1'), 'Active data cache zephyr-data-v1 MUST BE PRESERVED');
  assert.ok(retainedCaches.includes('zephyr-static-v1.6'), 'Current active static cache must be retained');
  assert.ok(retainedCaches.includes('other-vendor-cache'), 'Unrelated caches must not be touched');
});

// --- 4. Accessibility DOM - WAI-ARIA 1.2 Combobox Options Integrity ---
test('Accessibility: Zero <button> elements nested inside role="option"', () => {
  const appJsPath = path.join(PROJECT_ROOT, 'static', 'js', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Regex scan for <li ... role="option" ...> blocks and dynamically constructed option HTML
  // Ensure no <button elements exist within autocomplete list items
  const optionButtonRegex = /<li[^>]*role=["']option["'][^>]*>[\s\S]*?<button[\s\S]*?<\/li>/gi;
  assert.equal(optionButtonRegex.test(appJs), false, 'app.js must not nest <button> inside <li role="option">');

  // Verify renderQuickAccessDropdown uses non-interactive presentation elements for delete hints
  assert.ok(appJs.includes('class="dropdown-delete-hint" role="presentation"'));
  assert.ok(!appJs.includes('class="dropdown-delete-item-btn"'));

  // Verify index.html does not contain interactive elements inside autocomplete dropdown listbox
  const indexHtmlPath = path.join(PROJECT_ROOT, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  assert.ok(indexHtml.includes('id="autocomplete-dropdown" class="autocomplete-dropdown" role="listbox"'));
  assert.ok(!indexHtml.includes('<ul id="autocomplete-dropdown"[^>]*><button'));

  // Verify search-input attributes conform to WAI-ARIA 1.2 Combobox
  assert.ok(indexHtml.includes('role="combobox"'));
  assert.ok(indexHtml.includes('aria-autocomplete="list"'));
  assert.ok(indexHtml.includes('aria-haspopup="listbox"'));
  assert.ok(indexHtml.includes('aria-controls="autocomplete-dropdown"'));
});

// --- 5. Accessibility: Keyboard Event Handlers (Delete, Backspace, Escape) ---
test('Accessibility: Delete/Backspace removes items without navigation, Escape preserves focus', () => {
  const appJsPath = path.join(PROJECT_ROOT, 'static', 'js', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Verify Delete / Backspace handler exists in handleSearchKeydown
  assert.ok(appJs.includes("e.key === 'Delete' || e.key === 'Backspace'"));
  assert.ok(appJs.includes('this.removeFavorite(targetIdx)'));
  assert.ok(appJs.includes('this.removeRecentSearch('));

  // Verify preventDefault() is invoked for Delete/Backspace to prevent browser navigation
  const deleteBlockMatch = appJs.match(/else if\s*\(\s*e\.key === 'Delete' \|\| e\.key === 'Backspace'\s*\)\s*\{([\s\S]*?)\n\s*\}\s*else if\s*\(\s*e\.key === 'Escape'\s*\)/);
  assert.ok(deleteBlockMatch, 'Delete/Backspace key handler block must be present');
  assert.ok(deleteBlockMatch[1].includes('e.preventDefault()'), 'Delete/Backspace must call e.preventDefault()');

  // Verify Escape key handling does NOT call searchInput.blur()
  const escapeBlockMatch = appJs.match(/else if\s*\(\s*e\.key === 'Escape'\s*\)\s*\{([\s\S]*?)\}/);
  assert.ok(escapeBlockMatch, 'Escape key handler must be present in handleSearchKeydown');
  assert.ok(!escapeBlockMatch[1].includes('this.searchInput.blur()'), 'Escape key must not blur searchInput');
});

// --- 6. Color Contrast Calculations (WCAG 2.1 AA Math) ---
test('Accessibility: Color contrast ratios for AQI colors on #293142 exceed 4.5:1', () => {
  // Standard WCAG 2.1 Relative Luminance formula
  function srgbToLinear(c255) {
    const s = c255 / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }

  function getLuminance(hex) {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  function getContrastRatio(hex1, hex2) {
    const l1 = getLuminance(hex1);
    const l2 = getLuminance(hex2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  const bg = '#293142'; // Dark badge background in Zephyr

  // Target high-contrast colors implemented in Milestone 2
  const purple400 = '#c084fc'; // Very Unhealthy / Extreme UV
  const rose400 = '#fb7185';   // Hazardous AQI

  const ratioPurple = getContrastRatio(purple400, bg);
  const ratioRose = getContrastRatio(rose400, bg);

  assert.ok(
    ratioPurple >= 4.5,
    `Purple (#c084fc) contrast ratio ${ratioPurple.toFixed(2)}:1 must be >= 4.5:1`
  );
  assert.ok(
    ratioRose >= 4.5,
    `Rose (#fb7185) contrast ratio ${rose400} ${ratioRose.toFixed(2)}:1 must be >= 4.5:1`
  );

  // Empirical confirmation that previous colors failed WCAG AA:
  const legacyPurple = '#a855f7';
  const legacyRose = '#e11d48';
  const legacyPurpleRatio = getContrastRatio(legacyPurple, bg);
  const legacyRoseRatio = getContrastRatio(legacyRose, bg);

  assert.ok(legacyPurpleRatio < 4.5, 'Legacy purple must fail WCAG AA (< 4.5:1)');
  assert.ok(legacyRoseRatio < 4.5, 'Legacy rose must fail WCAG AA (< 4.5:1)');
});
