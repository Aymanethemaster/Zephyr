/**
 * Weather Utility Functions
 * Full-spectrum Meteocons integration: WMO codes, dynamic UV index icons, 
 * Beaufort wind scale icons, Moon phase calculator, and unit converters.
 */

export const WMO_CODES = {
  0:  { desc: 'Clear Sky', dayTheme: 'theme-clear-day', nightTheme: 'theme-clear-night', icon: 'clear' },
  1:  { desc: 'Mainly Clear', dayTheme: 'theme-clear-day', nightTheme: 'theme-clear-night', icon: 'mainly-clear' },
  2:  { desc: 'Partly Cloudy', dayTheme: 'theme-cloudy', nightTheme: 'theme-cloudy-night', icon: 'partly-cloudy' },
  3:  { desc: 'Overcast', dayTheme: 'theme-cloudy', nightTheme: 'theme-cloudy', icon: 'overcast' },
  45: { desc: 'Foggy', dayTheme: 'theme-fog', nightTheme: 'theme-fog', icon: 'fog' },
  48: { desc: 'Depositing Rime Fog', dayTheme: 'theme-fog', nightTheme: 'theme-fog', icon: 'fog' },
  51: { desc: 'Light Drizzle', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'drizzle' },
  53: { desc: 'Moderate Drizzle', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'drizzle-moderate' },
  55: { desc: 'Dense Drizzle', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'drizzle-dense' },
  56: { desc: 'Light Freezing Drizzle', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'freezing-rain' },
  57: { desc: 'Dense Freezing Drizzle', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'freezing-rain' },
  61: { desc: 'Slight Rain', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'rain-light' },
  63: { desc: 'Moderate Rain', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'rain' },
  65: { desc: 'Heavy Rain', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'rain-heavy' },
  66: { desc: 'Light Freezing Rain', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'freezing-rain' },
  67: { desc: 'Heavy Freezing Rain', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'freezing-rain' },
  71: { desc: 'Slight Snow Fall', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'snow-light' },
  73: { desc: 'Moderate Snow Fall', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'snow' },
  75: { desc: 'Heavy Snow Fall', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'snow-heavy' },
  77: { desc: 'Snow Grains', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'snow' },
  80: { desc: 'Slight Rain Showers', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'rain-light' },
  81: { desc: 'Moderate Rain Showers', dayTheme: 'theme-rain', nightTheme: 'theme-rain', icon: 'rain' },
  82: { desc: 'Violent Rain Showers', dayTheme: 'theme-thunderstorm', nightTheme: 'theme-thunderstorm', icon: 'rain-heavy' },
  85: { desc: 'Slight Snow Showers', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'snow-light' },
  86: { desc: 'Heavy Snow Showers', dayTheme: 'theme-snow', nightTheme: 'theme-snow', icon: 'snow-heavy' },
  95: { desc: 'Thunderstorm', dayTheme: 'theme-thunderstorm', nightTheme: 'theme-thunderstorm', icon: 'thunderstorm' },
  96: { desc: 'Thunderstorm with Slight Hail', dayTheme: 'theme-thunderstorm', nightTheme: 'theme-thunderstorm', icon: 'thunderstorm-hail' },
  99: { desc: 'Thunderstorm with Heavy Hail', dayTheme: 'theme-thunderstorm', nightTheme: 'theme-thunderstorm', icon: 'thunderstorm-hail' }
};

export function getWeatherInfo(code, isDay = 1) {
  const info = WMO_CODES[code] || {
    desc: 'Variable Weather',
    dayTheme: isDay ? 'theme-clear-day' : 'theme-clear-night',
    nightTheme: 'theme-clear-night',
    icon: 'partly-cloudy'
  };

  const theme = isDay ? info.dayTheme : (info.nightTheme || 'theme-clear-night');
  return {
    desc: info.desc,
    theme: theme,
    iconKey: info.icon,
    isDay: Boolean(isDay)
  };
}

export function formatTemp(celsius, unit = 'C') {
  const num = typeof celsius === 'number' ? celsius : parseFloat(celsius);
  if (isNaN(num)) return '--';
  const u = String(unit || 'C').replace(/["']/g, '').trim().toUpperCase();
  const val = u === 'F' ? (num * 9) / 5 + 32 : num;
  return `${Math.round(val)}°`;
}

export function convertTemp(celsius, unit = 'C') {
  const num = typeof celsius === 'number' ? celsius : parseFloat(celsius);
  if (isNaN(num)) return 0;
  const u = String(unit || 'C').replace(/["']/g, '').trim().toUpperCase();
  return u === 'F' ? Math.round((num * 9) / 5 + 32) : Math.round(num);
}

export function formatSpeed(kmh, unit = 'C') {
  const num = typeof kmh === 'number' ? kmh : parseFloat(kmh);
  if (isNaN(num)) return '--';
  const u = String(unit || 'C').replace(/["']/g, '').trim().toUpperCase();
  if (u === 'F') {
    return `${Math.round(num * 0.621371)} mph`;
  }
  return `${Math.round(num)} km/h`;
}

export function formatPrecipitation(mm, unit = 'C') {
  const num = typeof mm === 'number' ? mm : parseFloat(mm);
  if (isNaN(num)) return '--';
  const u = String(unit || 'C').replace(/["']/g, '').trim().toUpperCase();
  if (u === 'F') {
    return `${(num * 0.0393701).toFixed(2)} in`;
  }
  return `${num.toFixed(1)} mm`;
}

export function formatPressure(hPa, unit = 'C') {
  const num = typeof hPa === 'number' ? hPa : parseFloat(hPa);
  if (isNaN(num)) return '--';
  const u = String(unit || 'C').replace(/["']/g, '').trim().toUpperCase();
  if (u === 'F') {
    return `${(num * 0.02953).toFixed(2)} inHg`;
  }
  return `${Math.round(num)} hPa`;
}

export function formatVisibility(meters, unit = 'C') {
  const num = typeof meters === 'number' ? meters : parseFloat(meters);
  if (isNaN(num)) return '--';
  const u = String(unit || 'C').replace(/["']/g, '').trim().toUpperCase();
  if (u === 'F') {
    const miles = num / 1609.34;
    return `${miles.toFixed(1)} mi`;
  }
  const km = num / 1000;
  return `${km.toFixed(1)} km`;
}

export function getWindDirection(deg) {
  if (deg === null || deg === undefined || isNaN(deg)) return 'N/A';
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(((deg % 360) / 22.5)) % 16;
  return directions[index];
}

/**
 * Maps wind speed in km/h to Beaufort scale (0 - 12)
 */
export function getBeaufortScale(kmh) {
  if (!kmh || isNaN(kmh)) return 0;
  if (kmh < 1) return 0;
  if (kmh <= 5) return 1;
  if (kmh <= 11) return 2;
  if (kmh <= 19) return 3;
  if (kmh <= 28) return 4;
  if (kmh <= 38) return 5;
  if (kmh <= 49) return 6;
  if (kmh <= 61) return 7;
  if (kmh <= 74) return 8;
  if (kmh <= 88) return 9;
  if (kmh <= 102) return 10;
  if (kmh <= 117) return 11;
  return 12;
}

export const BEAUFORT_NAMES = [
  'Calm',
  'Light Air',
  'Light Breeze',
  'Gentle Breeze',
  'Moderate Breeze',
  'Fresh Breeze',
  'Strong Breeze',
  'High Wind',
  'Gale',
  'Strong Gale',
  'Storm',
  'Violent Storm',
  'Hurricane Force'
];

export function getBeaufortName(scale) {
  return BEAUFORT_NAMES[scale] || 'Moderate Breeze';
}

export function getUvRisk(uv) {
  if (uv === null || uv === undefined || isNaN(uv)) return { text: 'Unknown', color: '#94a3b8', level: 0 };
  const rounded = Math.round(uv * 10) / 10;
  if (rounded <= 2) return { text: 'Low', color: '#4ade80', level: 1, advice: 'Minimal sun protection needed' };
  if (rounded <= 5) return { text: 'Moderate', color: '#facc15', level: 2, advice: 'Wear sunglasses & SPF 30+' };
  if (rounded <= 7) return { text: 'High', color: '#fb923c', level: 3, advice: 'Seek shade during midday' };
  if (rounded <= 10) return { text: 'Very High', color: '#f87171', level: 4, advice: 'Extra protection required' };
  return { text: 'Extreme', color: '#c084fc', level: 5, advice: 'Avoid outdoor sun exposure' };
}

export function getAqiDetails(aqi) {
  if (aqi === null || aqi === undefined || isNaN(aqi)) {
    return { text: 'Good (Est.)', color: '#4ade80', description: 'Air quality is satisfactory.' };
  }
  if (aqi <= 50) return { text: 'Good', color: '#4ade80', description: 'Air quality is satisfactory with little or no risk.' };
  if (aqi <= 100) return { text: 'Moderate', color: '#facc15', description: 'Acceptable; sensitive individuals should take precautions.' };
  if (aqi <= 150) return { text: 'Unhealthy for Sensitive Groups', color: '#fb923c', description: 'Members of sensitive groups may experience health effects.' };
  if (aqi <= 200) return { text: 'Unhealthy', color: '#f87171', description: 'Some members of the general public may experience health effects.' };
  if (aqi <= 300) return { text: 'Very Unhealthy', color: '#a855f7', description: 'Health alert: risk of health effects is increased for everyone.' };
  return { text: 'Hazardous', color: '#e11d48', description: 'Health warning: emergency conditions.' };
}

export function formatTimeOnly(isoString) {
  if (!isoString) return '--';
  if (typeof isoString === 'string' && isoString.includes('T')) {
    const timePart = isoString.split('T')[1].slice(0, 5);
    if (timePart.length === 5) return timePart;
  }
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDayName(isoDate, isFirstDay = false) {
  if (!isoDate) return '--';
  if (isFirstDay) return 'Today';
  const dateStr = typeof isoDate === 'string' && isoDate.includes('T') ? isoDate.split('T')[0] : String(isoDate);
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return isNaN(date.getTime()) ? '--' : date.toLocaleDateString([], { weekday: 'short' });
  }
  const date = new Date(isoDate);
  return isNaN(date.getTime()) ? '--' : date.toLocaleDateString([], { weekday: 'short' });
}

export function formatDateString(isoString) {
  if (!isoString) return '';
  const dateStr = typeof isoString === 'string' && isoString.includes('T') ? isoString.split('T')[0] : String(isoString);
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }
  const date = new Date(isoString);
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

export function calculateSunPosition(sunriseIso, sunsetIso, currentTimeIso = null, isDayOverride = null) {
  if (!sunriseIso || !sunsetIso) {
    return { percent: 50, isDaytime: true, label: 'Daylight' };
  }

  const parseMinutes = (iso) => {
    if (!iso || typeof iso !== 'string') return null;
    const timeStr = iso.includes('T') ? iso.split('T')[1] : iso;
    const parts = timeStr.split(':');
    if (parts.length < 2) return null;
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  };

  const sunriseMin = parseMinutes(sunriseIso);
  const sunsetMin = parseMinutes(sunsetIso);

  let currentMin = parseMinutes(currentTimeIso);
  if (currentMin === null) {
    const now = new Date();
    currentMin = now.getHours() * 60 + now.getMinutes();
  }

  if (sunriseMin === null || sunsetMin === null) {
    return { percent: 50, isDaytime: true, label: 'Daylight' };
  }

  const isDaytime = isDayOverride !== null ? Boolean(isDayOverride) : (currentMin >= sunriseMin && currentMin <= sunsetMin);

  if (currentMin < sunriseMin) {
    const minsToRise = sunriseMin - currentMin;
    const hours = (minsToRise / 60).toFixed(1);
    return { percent: 0, isDaytime: false, label: `Sunrise in ${hours}h` };
  } else if (currentMin > sunsetMin) {
    const minsSinceSet = currentMin - sunsetMin;
    const hours = (minsSinceSet / 60).toFixed(1);
    return { percent: 100, isDaytime: false, label: `Sunset was ${hours}h ago` };
  } else {
    const totalDay = Math.max(sunsetMin - sunriseMin, 1);
    const elapsed = currentMin - sunriseMin;
    const percent = Math.min(100, Math.max(0, Math.round((elapsed / totalDay) * 100)));
    const remainingHours = ((sunsetMin - currentMin) / 60).toFixed(1);
    return { percent, isDaytime: true, label: `${remainingHours}h of daylight left` };
  }
}

/**
 * Calculates accurate current Moon Phase icon
 */
export function getMoonPhaseIcon() {
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  const day = now.getDate();

  let c = 0, e = 0, jd = 0, b = 0;
  if (month < 3) {
    year--;
    month += 12;
  }
  ++month;
  c = 365.25 * year;
  e = 30.6 * month;
  jd = c + e + day - 694039.09;
  jd /= 29.5305882;
  b = parseInt(jd);
  jd -= b;
  b = Math.round(jd * 8);
  if (b >= 8) b = 0;

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
  return moonPhases[b] || 'moon-full.svg';
}

/**
 * Maps iconKey & day/night status to Meteocons SVG files
 */
export function getMeteoconFileName(iconKey, isDay = true) {
  const period = isDay ? 'day' : 'night';
  switch (iconKey) {
    case 'clear':
      return `clear-${period}.svg`;
    case 'mainly-clear':
    case 'partly-cloudy':
      return `partly-cloudy-${period}.svg`;
    case 'overcast':
      return `overcast-${period}.svg`;
    case 'fog':
      return `fog-${period}.svg`;
    case 'drizzle':
    case 'drizzle-moderate':
    case 'drizzle-dense':
      return `partly-cloudy-${period}-drizzle.svg`;
    case 'rain-light':
      return `partly-cloudy-${period}-rain.svg`;
    case 'rain':
    case 'rain-heavy':
      return `rain.svg`;
    case 'freezing-rain':
      return `sleet.svg`;
    case 'snow-light':
      return `partly-cloudy-${period}-snow.svg`;
    case 'snow':
    case 'snow-heavy':
      return `snow.svg`;
    case 'thunderstorm':
      return `thunderstorms-${period}-rain.svg`;
    case 'thunderstorm-hail':
      return `thunderstorms-rain.svg`;
    default:
      return `clear-${period}.svg`;
  }
}

/**
 * Returns animated Meteocon SVG element
 */
export function getSvgIcon(iconKey, isDay = true, size = 48) {
  const fileName = getMeteoconFileName(iconKey, isDay);
  return `
    <img 
      src="/static/icons/${fileName}" 
      alt="${iconKey}" 
      width="${size}" 
      height="${size}" 
      class="weather-icon-img" 
      style="width:${size}px; height:${size}px; object-fit:contain; filter:drop-shadow(0 4px 10px rgba(0,0,0,0.18));"
      loading="eager"
      decoding="async"
    />
  `;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
