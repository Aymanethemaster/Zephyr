/**
 * Weather API Client
 * Interacts with Flask backend proxy endpoints.
 * Includes timeout protection, parameter validation, and cancellation support.
 */

export class WeatherApi {
  /**
   * Helper fetch with timeout and error handling
   */
  static async _fetchWithTimeout(url, timeoutMs = 8000, signal = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Merge external abort signal if provided
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        if (signal && signal.aborted) {
          throw err;
        }
        const timeoutErr = new Error('Request timed out. Please check your network connection.');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw err;
    }
  }

  static async searchLocations(query, signal = null) {
    if (!query || typeof query !== 'string') return [];
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    try {
      const resp = await this._fetchWithTimeout(`/api/geocoding?q=${encodeURIComponent(trimmed)}`, 6000, signal);
      if (!resp.ok) throw new Error(`Geocoding HTTP error: ${resp.status}`);
      const data = await resp.json();
      return Array.isArray(data.results) ? data.results : [];
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Error searching locations:', err);
      }
      return [];
    }
  }

  static async reverseGeocode(lat, lon, signal = null) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) {
      throw new Error('Invalid geographic coordinates');
    }

    try {
      const resp = await this._fetchWithTimeout(`/api/reverse-geocode?lat=${latNum}&lon=${lonNum}`, 6000, signal);
      if (!resp.ok) throw new Error(`Reverse geocode HTTP error: ${resp.status}`);
      return await resp.json();
    } catch (err) {
      console.warn('Error reverse geocoding:', err);
      return {
        name: `${latNum.toFixed(2)}°, ${lonNum.toFixed(2)}°`,
        country: '',
        admin1: '',
        latitude: latNum,
        longitude: lonNum
      };
    }
  }

  static async getWeather(lat, lon, timezone = 'auto', signal = null) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) {
      throw new Error('Invalid coordinates provided for weather forecast');
    }

    const resp = await this._fetchWithTimeout(`/api/weather?lat=${latNum}&lon=${lonNum}&timezone=${encodeURIComponent(timezone)}`, 9000, signal);
    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      throw new Error(errorData.details || errorData.error || `Weather fetch failed (HTTP ${resp.status})`);
    }
    return await resp.json();
  }

  static async getAirQuality(lat, lon, signal = null) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) return null;

    try {
      const resp = await this._fetchWithTimeout(`/api/air-quality?lat=${latNum}&lon=${lonNum}`, 7000, signal);
      if (!resp.ok) return null;
      return await resp.json();
    } catch (err) {
      console.warn('Error fetching air quality:', err);
      return null;
    }
  }
}
