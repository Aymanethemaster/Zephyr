/**
 * Weather API Client
 * Supports both local Flask proxy endpoints and direct client-side fallback
 * for 100% zero-configuration static deployments (Vercel, GitHub Pages, Netlify).
 */

export class WeatherApi {
  /**
   * Shared Open-Meteo request definition, loaded from
   * /static/js/weather-params.json — the same file the Flask backend reads —
   * so the proxied and direct-client requests always ask for identical fields.
   * Falls back to a minimal built-in set if the file cannot be fetched.
   */
  static get _sharedParams() {
    return this._paramsCache || (this._paramsCache = this._loadParams());
  }

  static async _loadParams() {
    const fallback = {
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index',
      hourly: 'temperature_2m,relative_humidity_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,pressure_msl,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_speed_10m_max',
      forecast_days: 8
    };
    try {
      const resp = await fetch('/static/js/weather-params.json');
      if (resp.ok) {
        const data = await resp.json();
        return {
          current: (data.current || []).join(','),
          hourly: (data.hourly || []).join(','),
          daily: (data.daily || []).join(','),
          forecast_days: data.forecast_days || 8
        };
      }
    } catch (e) {}
    return fallback;
  }

  /**
   * Resets the shared parameter cache so that fresh configurations can be
   * re-fetched from /static/js/weather-params.json (e.g. after regaining internet).
   */
  static resetParamsCache() {
    this._paramsCache = null;
  }

  /**
   * Creates an AbortError DOMException or equivalent Error object
   */
  static _createAbortError(message = 'The operation was aborted') {
    if (typeof DOMException !== 'undefined') {
      return new DOMException(message, 'AbortError');
    }
    const err = new Error(message);
    err.name = 'AbortError';
    return err;
  }

  /**
   * Helper fetch with timeout and error handling.
   * Properly propagates user AbortError, checks pre-aborted signal,
   * cleans up event listeners, and distinguishes TimeoutError from cancellation.
   */
  static async _fetchWithTimeout(url, timeoutMs = 8000, signal = null) {
    if (signal?.aborted) {
      throw this._createAbortError();
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      return await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        if (signal?.aborted) {
          throw err;
        }
        if (controller.signal.aborted) {
          const timeoutErr = new Error('Request timed out. Please check your network connection.');
          timeoutErr.name = 'TimeoutError';
          throw timeoutErr;
        }
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  static async searchLocations(query, signal = null) {
    if (!query || typeof query !== 'string') return [];
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    const checkAbort = (e) => {
      if (e?.name === 'AbortError' || signal?.aborted) {
        throw e?.name === 'AbortError' ? e : this._createAbortError();
      }
    };

    // 1. Try local proxy first
    try {
      const resp = await this._fetchWithTimeout(`/api/geocoding?q=${encodeURIComponent(trimmed)}`, 4000, signal);
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          if (Array.isArray(data.results)) {
            return data.results;
          }
        }
      }
    } catch (e) {
      checkAbort(e);
      // Fallback to direct client API on non-abort errors (e.g. proxy failure, 502, network offline)
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 2. Direct client-side Open-Meteo Geocoding
    try {
      const omUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(trimmed)}&count=8&language=en&format=json`;
      const omResp = await this._fetchWithTimeout(omUrl, 5000, signal);
      if (omResp.ok) {
        const omData = await omResp.json();
        if (Array.isArray(omData.results) && omData.results.length > 0) {
          return omData.results.map(r => ({
            name: r.name,
            country: r.country || '',
            admin1: r.admin1 || '',
            latitude: r.latitude,
            longitude: r.longitude,
            timezone: r.timezone || 'auto'
          }));
        }
      }
    } catch (e) {
      checkAbort(e);
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 3. Fallback to OpenStreetMap Photon (for typo tolerance)
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=8&lang=en`;
      const pResp = await this._fetchWithTimeout(photonUrl, 5000, signal);
      if (pResp.ok) {
        const pData = await pResp.json();
        const features = pData.features || [];
        const nonGeoKeys = new Set(['amenity', 'craft', 'shop', 'tourism', 'leisure']);
        const nonGeoVals = new Set(['brewery', 'bar', 'cafe', 'pub', 'restaurant', 'hotel', 'hostel', 'nightclub', 'supermarket']);
        return features
          .filter(f => {
            const p = f.properties || {};
            if (nonGeoKeys.has(p.osm_key) && nonGeoVals.has(p.osm_value)) {
              return false;
            }
            return true;
          })
          .map(f => {
            const p = f.properties || {};
            const coords = (f.geometry && f.geometry.coordinates) || [0, 0];
            return {
              name: p.name || p.city || '',
              country: p.country || '',
              admin1: p.state || '',
              latitude: coords[1],
              longitude: coords[0],
              timezone: 'auto'
            };
          }).filter(r => r.name);
      }
    } catch (e) {
      checkAbort(e);
    }

    return [];
  }

  static async getIpLocation(signal = null) {
    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 1. Try local proxy first
    try {
      const resp = await this._fetchWithTimeout('/api/ip-location', 3500, signal);
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await resp.json();
          if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
            return data;
          }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e.name === 'AbortError' ? e : this._createAbortError();
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 2. Direct client-side BigDataCloud IP lookup
    try {
      const bdcUrl = 'https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=en';
      const resp = await this._fetchWithTimeout(bdcUrl, 4000, signal);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.latitude !== undefined && data.longitude !== undefined) {
          const city = data.city || data.locality || data.principalSubdivision || data.countryName || 'Current Location';
          return {
            name: city,
            admin1: data.principalSubdivision && data.principalSubdivision !== city ? data.principalSubdivision : '',
            country: data.countryName || '',
            country_code: (data.countryCode || '').toUpperCase(),
            latitude: parseFloat(data.latitude),
            longitude: parseFloat(data.longitude),
            timezone: 'auto'
          };
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e.name === 'AbortError' ? e : this._createAbortError();
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 3. Direct client-side GeoJS fallback
    try {
      const gResp = await this._fetchWithTimeout('https://get.geojs.io/v1/ip/geo.json', 3500, signal);
      if (gResp.ok) {
        const data = await gResp.json();
        if (data && data.latitude && data.longitude) {
          const city = data.city || data.region || data.country || 'Current Location';
          return {
            name: city,
            admin1: data.region && data.region !== city ? data.region : '',
            country: data.country || '',
            country_code: (data.country_code || '').toUpperCase(),
            latitude: parseFloat(data.latitude),
            longitude: parseFloat(data.longitude),
            timezone: data.timezone || 'auto'
          };
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e.name === 'AbortError' ? e : this._createAbortError();
    }

    return null;
  }

  static async reverseGeocode(lat, lon, signal = null) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) {
      throw new Error('Invalid geographic coordinates');
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 1. Try local proxy first
    try {
      const resp = await this._fetchWithTimeout(`/api/reverse-geocode?lat=${latNum}&lon=${lonNum}`, 4000, signal);
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await resp.json();
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e.name === 'AbortError' ? e : this._createAbortError();
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 2. Direct client-side BigDataCloud
    try {
      const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latNum}&longitude=${lonNum}&localityLanguage=en`;
      const resp = await this._fetchWithTimeout(bdcUrl, 5000, signal);
      if (resp.ok) {
        const data = await resp.json();
        const city = data.city || data.locality || data.principalSubdivision || data.countryName || `${latNum.toFixed(2)}°, ${lonNum.toFixed(2)}°`;
        return {
          name: city,
          country: data.countryName || '',
          country_code: (data.countryCode || '').toUpperCase(),
          admin1: data.principalSubdivision && data.principalSubdivision !== city ? data.principalSubdivision : '',
          latitude: latNum,
          longitude: lonNum
        };
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e.name === 'AbortError' ? e : this._createAbortError();
    }

    return {
      name: `${latNum.toFixed(2)}°, ${lonNum.toFixed(2)}°`,
      country: '',
      country_code: '',
      admin1: '',
      latitude: latNum,
      longitude: lonNum
    };
  }

  static async getWeather(lat, lon, timezone = 'auto', signal = null) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) {
      throw new Error('Invalid coordinates provided for weather forecast');
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 1. Try local proxy first
    try {
      const resp = await this._fetchWithTimeout(`/api/weather?lat=${latNum}&lon=${lonNum}&timezone=${encodeURIComponent(timezone)}`, 5000, signal);
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await resp.json();
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e.name === 'AbortError' ? e : this._createAbortError();
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 2. Direct client-side Open-Meteo (same field list as the backend proxy)
    const params = await WeatherApi._sharedParams;
    const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latNum}&longitude=${lonNum}` +
      `&current=${params.current}&hourly=${params.hourly}&daily=${params.daily}` +
      `&forecast_days=${params.forecast_days}&timezone=${encodeURIComponent(timezone)}`;
    const resp = await this._fetchWithTimeout(omUrl, 9000, signal);
    if (!resp.ok) {
      throw new Error(`Weather fetch failed (HTTP ${resp.status})`);
    }
    return await resp.json();
  }

  static async getAirQuality(lat, lon, signal = null) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (isNaN(latNum) || isNaN(lonNum)) return null;

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 1. Try local proxy first
    try {
      const resp = await this._fetchWithTimeout(`/api/air-quality?lat=${latNum}&lon=${lonNum}`, 4000, signal);
      if (resp.ok) {
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          return await resp.json();
        }
      }
    } catch (e) {
      if (e.name === 'AbortError' || signal?.aborted) throw e.name === 'AbortError' ? e : this._createAbortError();
    }

    if (signal?.aborted) {
      throw this._createAbortError();
    }

    // 2. Direct client-side Open-Meteo AQI
    try {
      const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latNum}&longitude=${lonNum}&current=us_aqi,european_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone`;
      const resp = await this._fetchWithTimeout(aqiUrl, 6000, signal);
      if (resp.ok) {
        return await resp.json();
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) throw err.name === 'AbortError' ? err : this._createAbortError();
      console.warn('Error fetching air quality:', err);
    }
    return null;
  }
}
