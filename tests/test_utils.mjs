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
  escapeHtml
} from '../static/js/utils.js';

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
