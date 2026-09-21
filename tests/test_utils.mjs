import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WMO_CODES,
  getWeatherInfo,
  formatTemp,
  convertTemp,
  formatSpeed,
  formatPressure,
  formatVisibility,
  getWindDirection,
  getBeaufortScale,
  getBeaufortName,
  getUvRisk,
  getAqiDetails,
  calculateSunPosition,
  getMeteoconFileName,
  getSvgIcon,
  getIconPath,
  getMoonPhaseIcon,
  escapeHtml
} from '../static/js/utils.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

test('formatTemp: formats temperatures with degree symbol', () => {
  assert.equal(formatTemp(20, 'C'), '20°');
  assert.equal(formatTemp(20, 'F'), '68°');
  assert.equal(formatTemp('25.4', 'C'), '25°');
  assert.equal(formatTemp(null), '--');
  assert.equal(formatTemp(undefined), '--');
  assert.equal(formatTemp(NaN), '--');
});

test('convertTemp: converts temperatures as rounded integers', () => {
  assert.equal(convertTemp(20, 'C'), 20);
  assert.equal(convertTemp(20, 'F'), 68);
  assert.equal(convertTemp(null), 0);
  assert.equal(convertTemp(undefined), 0);
});

test('formatSpeed: handles units conversion', () => {
  assert.equal(formatSpeed(20, 'C'), '20 km/h');
  assert.equal(formatSpeed(20, 'F'), '12 mph');
  assert.equal(formatSpeed(null), '--');
});

test('formatPressure: formats hPa and inHg', () => {
  assert.equal(formatPressure(1013, 'C'), '1013 hPa');
  assert.equal(formatPressure(1013, 'F'), '29.91 inHg');
  assert.equal(formatPressure(null), '--');
});

test('formatVisibility: formats km and miles', () => {
  assert.equal(formatVisibility(10000, 'C'), '10.0 km');
  assert.equal(formatVisibility(10000, 'F'), '6.2 mi');
  assert.equal(formatVisibility(null), '--');
});

test('getWindDirection: maps compass degrees to 16 cardinal points', () => {
  assert.equal(getWindDirection(0), 'N');
  assert.equal(getWindDirection(360), 'N');
  assert.equal(getWindDirection(90), 'E');
  assert.equal(getWindDirection(180), 'S');
  assert.equal(getWindDirection(270), 'W');
  assert.equal(getWindDirection(45), 'NE');
  assert.equal(getWindDirection(null), 'N/A');
  assert.equal(getWindDirection(NaN), 'N/A');
});

test('getBeaufortScale & getBeaufortName: maps km/h to scale and names', () => {
  assert.equal(getBeaufortScale(0), 0);
  assert.equal(getBeaufortName(0), 'Calm');
  assert.equal(getBeaufortScale(15), 3);
  assert.equal(getBeaufortName(3), 'Gentle Breeze');
  assert.equal(getBeaufortScale(130), 12);
  assert.equal(getBeaufortName(12), 'Hurricane Force');
});

test('getUvRisk: calculates correct risk levels and advice', () => {
  assert.equal(getUvRisk(1).text, 'Low');
  assert.equal(getUvRisk(4).text, 'Moderate');
  assert.equal(getUvRisk(7).text, 'High');
  assert.equal(getUvRisk(9).text, 'Very High');
  assert.equal(getUvRisk(12).text, 'Extreme');
  assert.equal(getUvRisk(null).text, 'Unknown');
});

test('getAqiDetails: maps AQI numbers to descriptions and colors', () => {
  assert.equal(getAqiDetails(25).text, 'Good');
  assert.equal(getAqiDetails(75).text, 'Moderate');
  assert.equal(getAqiDetails(125).text, 'Unhealthy for Sensitive Groups');
  assert.equal(getAqiDetails(175).text, 'Unhealthy');
  assert.equal(getAqiDetails(250).text, 'Very Unhealthy');
  assert.equal(getAqiDetails(350).text, 'Hazardous');
  assert.equal(getAqiDetails(null).text, 'Good (Est.)');
});

test('calculateSunPosition: computes daylight percentage and descriptions', () => {
  const noon = calculateSunPosition('2026-09-05T06:00', '2026-09-05T20:00', '2026-09-05T13:00');
  assert.equal(noon.isDaytime, true);
  assert.equal(noon.percent, 50);

  const night = calculateSunPosition('2026-09-05T06:00', '2026-09-05T20:00', '2026-09-05T23:00');
  assert.equal(night.isDaytime, false);
  assert.equal(night.percent, 100);

  const preDawn = calculateSunPosition('2026-09-05T06:00', '2026-09-05T20:00', '2026-09-05T04:00');
  assert.equal(preDawn.isDaytime, false);
  assert.equal(preDawn.percent, 0);

  const fallback = calculateSunPosition(null, null);
  assert.equal(fallback.percent, 50);
});

test('getMeteoconFileName: returns valid SVG filename for weather codes', () => {
  assert.equal(getMeteoconFileName('clear', true), 'clear-day.svg');
  assert.equal(getMeteoconFileName('clear', false), 'clear-night.svg');
  assert.equal(getMeteoconFileName('partly-cloudy', true), 'partly-cloudy-day.svg');
  assert.equal(getMeteoconFileName('rain', true), 'rain.svg');
  assert.equal(getMeteoconFileName('thunderstorm', true), 'thunderstorms-day-rain.svg');
  assert.equal(getMeteoconFileName('unknown_code', true), 'clear-day.svg');
});

test('escapeHtml: sanitizes HTML special characters safely', () => {
  assert.equal(escapeHtml('Hello <script>alert("xss")</script>'), 'Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("Tom & Jerry's"), 'Tom &amp; Jerry&#39;s');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(''), '');
});

test('getIconPath: resolves root and subpath correctly', () => {
  assert.equal(getIconPath('clear-day.svg'), '/static/icons/clear-day.svg');
  assert.equal(getIconPath('/static/icons/clear-day.svg'), '/static/icons/clear-day.svg');

  // Test custom base path
  globalThis.window = { ZEPHYR_BASE_PATH: '/Zephyr' };
  assert.equal(getIconPath('wind.svg'), '/Zephyr/static/icons/wind.svg');
  delete globalThis.window;
});

test('getSvgIcon: generates CSP-safe HTML with data-attribute fallback and accessible attributes', () => {
  const svgHtml = getSvgIcon('clear', true, 48);
  assert.ok(svgHtml.includes('src="/static/icons/clear-day.svg"'));
  assert.ok(svgHtml.includes('data-fallback-src="/static/icons/clear-day.svg"'));
  assert.ok(!svgHtml.includes('onerror='), 'must not use CSP-blocked inline event handlers');
  assert.ok(svgHtml.includes('width="48"'));
  assert.ok(svgHtml.includes('height="48"'));
  assert.ok(svgHtml.includes('loading="eager"'), 'defaults to eager loading');

  const lazyNight = getSvgIcon('rain-light', false, 36, 'lazy');
  assert.ok(lazyNight.includes('loading="lazy"'), 'supports lazy loading for offscreen icons');
  assert.ok(lazyNight.includes('data-fallback-src="/static/icons/clear-night.svg"'));
});

test('Asset verification: all WMO weather condition icons exist on disk in static/icons/', () => {
  const iconDir = path.join(PROJECT_ROOT, 'static', 'icons');
  for (const codeStr of Object.keys(WMO_CODES)) {
    const code = Number(codeStr);
    for (const isDay of [true, false]) {
      const info = getWeatherInfo(code, isDay);
      const fileName = getMeteoconFileName(info.iconKey, info.isDay);
      const filePath = path.join(iconDir, fileName);
      assert.ok(fs.existsSync(filePath), `Icon file ${fileName} for WMO code ${code} (isDay: ${isDay}) must exist on disk`);
    }
  }
});

test('Asset verification: all Beaufort, UV, and Moon Phase icons exist on disk in static/icons/', () => {
  const iconDir = path.join(PROJECT_ROOT, 'static', 'icons');

  // Beaufort 0..12
  for (let b = 0; b <= 12; b++) {
    const fn = `wind-beaufort-${b}.svg`;
    assert.ok(fs.existsSync(path.join(iconDir, fn)), `Beaufort icon ${fn} must exist on disk`);
  }

  // UV 1..11 and default
  assert.ok(fs.existsSync(path.join(iconDir, 'uv-index.svg')));
  for (let u = 1; u <= 11; u++) {
    const fn = `uv-index-${u}.svg`;
    assert.ok(fs.existsSync(path.join(iconDir, fn)), `UV icon ${fn} must exist on disk`);
  }

  // Moon phases
  const moonPhases = [
    'moon-new.svg',
    'moon-waxing-crescent.svg',
    'moon-first-quarter.svg',
    'moon-waxing-gibbous.svg',
    'moon-full.svg',
    'moon-waning-gibbous.svg',
    'moon-last-quarter.svg',
    'moon-waning-crescent.svg'
  ];
  for (const mp of moonPhases) {
    assert.ok(fs.existsSync(path.join(iconDir, mp)), `Moon phase icon ${mp} must exist on disk`);
  }
});
