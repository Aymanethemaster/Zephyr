/**
 * Main Weather Application Logic
 * Orchestrates API calls, state management, UI rendering, and theme transitions.
 * Pure real icons and data-driven typography, zero procedural generation.
 */

import { WeatherApi } from './weather-api.js';
import {
  getWeatherInfo,
  formatTemp,
  convertTemp,
  formatSpeed,
  formatPressure,
  formatVisibility,
  formatPrecipitation,
  getWindDirection,
  getUvRisk,
  getAqiDetails,
  formatTimeOnly,
  formatDayName,
  formatDateString,
  calculateSunPosition,
  getSvgIcon,
  getBeaufortScale,
  getBeaufortName,
  getMoonPhaseIcon,
  escapeHtml
} from './utils.js';

/**
 * Safe localStorage wrapper that handles private browsing mode, disabled storage,
 * and JSON parse corruption gracefully.
 */
const SafeStorage = {
  getItem(key, fallback = null) {
    try {
      const val = localStorage.getItem(key);
      if (val === null) return fallback;
      return JSON.parse(val);
    } catch {
      return fallback;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  getString(key, fallback = '') {
    try {
      return localStorage.getItem(key) || fallback;
    } catch {
      return fallback;
    }
  },
  setString(key, value) {
    try {
      localStorage.setItem(key, String(value));
      return true;
    } catch {
      return false;
    }
  }
};

class WeatherApp {
  constructor() {
    const savedUnit = SafeStorage.getString('weather_unit', 'C').replace(/["']/g, '').trim().toUpperCase();
    this.unit = savedUnit === 'F' ? 'F' : 'C';

    this.currentLocation = null;
    this.weatherData = null;
    this.airQualityData = null;

    this.searchDebounceTimer = null;
    this.searchAbortController = null;
    this.weatherAbortController = null;
    this.autocompleteResults = [];
    this.selectedIndex = -1;
    this.isLoading = false;

    this.initDOMElements();
    this.bindEvents();
    this.initNetworkListeners();
    this.initUserLocation();
  }

  initDOMElements() {
    // Search
    this.searchInput = document.getElementById('search-input');
    this.searchSpinner = document.getElementById('search-spinner');
    this.searchClearBtn = document.getElementById('search-clear');
    this.autocompleteDropdown = document.getElementById('autocomplete-dropdown');
    this.gpsBtn = document.getElementById('gps-btn');
    this.unitToggleBtns = document.querySelectorAll('.unit-btn');
    this.updateUnitToggleUI();
    this.toast = document.getElementById('toast');
    this.toastMsg = document.getElementById('toast-msg');

    // Hero Elements
    this.locationNameEl = document.getElementById('hero-location-name');
    this.locationSubEl = document.getElementById('hero-location-sub');
    this.heroTempEl = document.getElementById('hero-temp');
    this.heroConditionEl = document.getElementById('hero-condition');
    this.heroIconContainer = document.getElementById('hero-icon-container');
    this.heroHighLowEl = document.getElementById('hero-high-low');
    this.heroFeelsEl = document.getElementById('hero-feels');
    this.heroHumidityEl = document.getElementById('hero-humidity');
    this.heroWindEl = document.getElementById('hero-wind');
    this.heroFavoriteBtn = document.getElementById('hero-favorite-btn');
    this.heroErrorState = document.getElementById('hero-error-state');
    this.heroErrorTitle = document.getElementById('hero-error-title');
    this.heroErrorDesc = document.getElementById('hero-error-desc');
    this.heroRetryBtn = document.getElementById('hero-retry-btn');
    this.heroVisual = document.querySelector('.hero-visual');
    this.heroFooterStats = document.querySelector('.hero-footer-stats');

    // Hourly & Daily
    this.hourlyStripEl = document.getElementById('hourly-strip');
    this.hourlyStripContainer = document.getElementById('hourly-strip-container');
    this.hourlyScrollLeftBtn = document.getElementById('hourly-scroll-left');
    this.hourlyScrollRightBtn = document.getElementById('hourly-scroll-right');
    this.dailyListEl = document.getElementById('daily-list');

    // Metrics
    this.uvValEl = document.getElementById('uv-val');
    this.uvStatusEl = document.getElementById('uv-status');
    this.uvIconImg = document.getElementById('uv-icon-img');
    this.uvAdviceEl = document.getElementById('uv-advice');

    this.windValEl = document.getElementById('wind-val');
    this.windGustsEl = document.getElementById('wind-gusts');
    this.windDirectionEl = document.getElementById('wind-direction');
    this.windScaleNameEl = document.getElementById('wind-scale-name');
    this.windIconImg = document.getElementById('wind-icon-img');

    this.humidityValEl = document.getElementById('humidity-val');
    this.dewPointEl = document.getElementById('dew-point');
    this.humidityDescEl = document.getElementById('humidity-desc');

    this.visibilityValEl = document.getElementById('visibility-val');
    this.pressureValEl = document.getElementById('pressure-val');
    this.pressureIconImg = document.getElementById('pressure-icon-img');
    this.visibilityDescEl = document.getElementById('visibility-desc');

    this.sunriseValEl = document.getElementById('sunrise-val');
    this.sunsetValEl = document.getElementById('sunset-val');
    this.solarStatusEl = document.getElementById('solar-status');
    this.solarIconImg = document.getElementById('solar-icon-img');
    this.solarDescEl = document.getElementById('solar-desc');

    this.aqiValEl = document.getElementById('aqi-val');
    this.aqiStatusEl = document.getElementById('aqi-status');
    this.aqiIconImg = document.getElementById('aqi-icon-img');
    this.aqiDescEl = document.getElementById('aqi-desc');
  }

  bindEvents() {
    // Search input
    this.searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
    this.searchInput.addEventListener('focus', () => this.handleSearchFocus());
    this.searchInput.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
    this.searchClearBtn.addEventListener('click', () => {
      this.searchInput.value = '';
      this.searchClearBtn.classList.remove('visible');
      if (this.searchAbortController) {
        this.searchAbortController.abort();
        this.searchAbortController = null;
      }
      if (this.searchSpinner) {
        this.searchSpinner.classList.remove('active');
      }
      this.handleSearchFocus();
      this.searchInput.focus();
    });

    // Close autocomplete on click outside
    document.addEventListener('click', (e) => {
      if (!this.searchInput.contains(e.target) && !this.autocompleteDropdown.contains(e.target)) {
        this.closeAutocomplete();
      }
    });

    // Hero favorite toggle button
    if (this.heroFavoriteBtn) {
      this.heroFavoriteBtn.addEventListener('click', () => this.handleFavoriteToggle());
    }

    // Hourly forecast scroll arrows
    if (this.hourlyScrollLeftBtn) {
      this.hourlyScrollLeftBtn.addEventListener('click', () => this.scrollHourly(-320));
    }
    if (this.hourlyScrollRightBtn) {
      this.hourlyScrollRightBtn.addEventListener('click', () => this.scrollHourly(320));
    }
    if (this.hourlyStripContainer) {
      this.hourlyStripContainer.addEventListener('scroll', () => this.updateHourlyScrollArrows(), { passive: true });
      window.addEventListener('resize', () => this.updateHourlyScrollArrows(), { passive: true });
    }

    // Hero inline retry button
    if (this.heroRetryBtn) {
      this.heroRetryBtn.addEventListener('click', () => {
        if (this.currentLocation) {
          this.loadLocationWeather(this.currentLocation);
        }
      });
    }

    // GPS Geolocation
    this.gpsBtn.addEventListener('click', () => this.handleGeolocation());

    // Unit toggle
    if (this.unitToggleBtns) {
      this.unitToggleBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const targetUnit = (btn.dataset.unit || (btn.id === 'unit-f' ? 'F' : 'C')).toUpperCase();
          this.setUnit(targetUnit);
          this.showToast(`Switched units to °${this.unit}`);
        });
      });
    }

    // Global Keyboard Shortcuts: "/" or "Ctrl+K" (Search), "U" (Units)
    document.addEventListener('keydown', (e) => {
      const isInputActive = document.activeElement === this.searchInput || 
                            document.activeElement?.tagName === 'INPUT' || 
                            document.activeElement?.tagName === 'TEXTAREA';

      if (!isInputActive) {
        if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
          e.preventDefault();
          this.searchInput.focus();
          this.searchInput.select();
        } else if (e.key === 'u' || e.key === 'U') {
          e.preventDefault();
          this.setUnit(this.unit === 'C' ? 'F' : 'C');
          this.showToast(`Switched units to °${this.unit}`);
        }
      } else if (e.key === 'Escape' && document.activeElement === this.searchInput) {
        this.closeAutocomplete();
        this.searchInput.blur();
      }
    });
  }

  initNetworkListeners() {
    window.addEventListener('online', () => {
      this.showToast('Internet connection restored. Refreshing weather data...');
      if (this.currentLocation) {
        this.loadLocationWeather(this.currentLocation);
      }
    });

    window.addEventListener('offline', () => {
      this.showToast('You are currently offline. Showing cached weather observations.');
    });
  }

  showToast(message) {
    if (!this.toast || !this.toastMsg) return;
    this.toastMsg.textContent = message;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast.classList.remove('show');
    }, 3800);
  }

  updateUnitToggleUI() {
    if (!this.unitToggleBtns) return;
    this.unitToggleBtns.forEach(b => {
      const unitVal = (b.dataset.unit || (b.id === 'unit-f' ? 'F' : 'C')).toUpperCase();
      const isActive = unitVal === this.unit;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  setUnit(newUnit) {
    const normalized = String(newUnit).replace(/["']/g, '').trim().toUpperCase();
    this.unit = normalized === 'F' ? 'F' : 'C';
    SafeStorage.setString('weather_unit', this.unit);
    this.updateUnitToggleUI();
    if (this.weatherData) {
      this.renderAll();
    }
  }

  async initUserLocation() {
    // 1. If returning user has a previously loaded location, restore it immediately
    const savedLoc = SafeStorage.getItem('weather_last_loc');
    if (savedLoc && typeof savedLoc.latitude === 'number' && typeof savedLoc.longitude === 'number') {
      this.currentLocation = savedLoc;
      this.loadLocationWeather(this.currentLocation);

      // If geolocation permission was already granted in this browser, check silently in background
      if (navigator.permissions && navigator.geolocation) {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' });
          if (status.state === 'granted') {
            navigator.geolocation.getCurrentPosition(
              async (pos) => {
                const { latitude, longitude } = pos.coords;
                const dLat = Math.abs((this.currentLocation?.latitude ?? 0) - latitude);
                const dLon = Math.abs((this.currentLocation?.longitude ?? 0) - longitude);
                if (dLat > 0.15 || dLon > 0.15) {
                  try {
                    const locInfo = await WeatherApi.reverseGeocode(latitude, longitude);
                    this.currentLocation = {
                      name: locInfo.name || 'My Location',
                      admin1: locInfo.admin1 || '',
                      country: locInfo.country || '',
                      country_code: locInfo.country_code || '',
                      latitude: locInfo.latitude || latitude,
                      longitude: locInfo.longitude || longitude,
                      timezone: 'auto'
                    };
                    this.loadLocationWeather(this.currentLocation);
                  } catch {}
                }
              },
              () => {},
              { timeout: 8000, enableHighAccuracy: false, maximumAge: 300000 }
            );
          }
        } catch {}
      }
      return;
    }

    // 2. First-time user: Request GPS location cleanly without flashing an approximate IP location
    if (navigator.geolocation) {
      if (navigator.permissions && navigator.permissions.query) {
        try {
          const status = await navigator.permissions.query({ name: 'geolocation' });
          if (status.state === 'denied') {
            await this.fallbackToIpLocation();
            return;
          }
        } catch {}
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          try {
            const locInfo = await WeatherApi.reverseGeocode(latitude, longitude);
            this.currentLocation = {
              name: locInfo.name || 'My Location',
              admin1: locInfo.admin1 || '',
              country: locInfo.country || '',
              country_code: locInfo.country_code || '',
              latitude: locInfo.latitude || latitude,
              longitude: locInfo.longitude || longitude,
              timezone: 'auto'
            };
            this.loadLocationWeather(this.currentLocation);
            this.showToast(`Located: ${this.currentLocation.name} 📍`);
          } catch (err) {
            console.warn('Reverse geocode error:', err);
            this.currentLocation = {
              name: 'My Location',
              latitude,
              longitude,
              timezone: 'auto'
            };
            this.loadLocationWeather(this.currentLocation);
          }
        },
        async (err) => {
          console.info('GPS unavailable or denied, falling back to IP location:', err?.message || err);
          await this.fallbackToIpLocation();
        },
        { timeout: 12000, enableHighAccuracy: false, maximumAge: 60000 }
      );
    } else {
      await this.fallbackToIpLocation();
    }
  }

  async fallbackToIpLocation() {
    try {
      const ipLoc = await WeatherApi.getIpLocation();
      if (ipLoc && typeof ipLoc.latitude === 'number' && typeof ipLoc.longitude === 'number') {
        this.currentLocation = ipLoc;
        this.loadLocationWeather(this.currentLocation);
        return;
      }
    } catch (e) {
      console.warn('IP geolocation lookup warning:', e);
    }

    const defaultLoc = {
      name: 'New York',
      country: 'United States',
      latitude: 40.7128,
      longitude: -74.0060,
      timezone: 'America/New_York'
    };
    this.currentLocation = defaultLoc;
    this.loadLocationWeather(this.currentLocation);
  }

  async handleGeolocation() {
    if (!navigator.geolocation) {
      this.showToast('Geolocation is not supported by your browser.');
      return;
    }

    this.showToast('Locating your position...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const locInfo = await WeatherApi.reverseGeocode(latitude, longitude);
          this.currentLocation = {
            name: locInfo.name || 'My Location',
            admin1: locInfo.admin1 || '',
            country: locInfo.country || '',
            country_code: locInfo.country_code || '',
            latitude: locInfo.latitude || latitude,
            longitude: locInfo.longitude || longitude,
            timezone: 'auto'
          };
          this.loadLocationWeather(this.currentLocation);
          this.showToast(`Located: ${this.currentLocation.name} 📍`);
        } catch (err) {
          console.warn('Reverse geocode error:', err);
          this.loadLocationWeather({
            name: 'My Location',
            latitude,
            longitude,
            timezone: 'auto'
          });
        }
      },
      async (err) => {
        console.warn('Geolocation error:', err);
        // Fallback to IP location on manual click if GPS is denied or unavailable
        try {
          const ipLoc = await WeatherApi.getIpLocation();
          if (ipLoc) {
            this.currentLocation = ipLoc;
            this.loadLocationWeather(this.currentLocation);
            this.showToast(`Located via IP: ${ipLoc.name} 🌐`);
            return;
          }
        } catch {}

        let msg = 'Location access unavailable.';
        if (err.code === 1) {
          msg = 'Location permission denied. Please allow GPS access in your browser.';
        } else if (err.code === 2) {
          msg = 'Location position unavailable. Please search for your city.';
        } else if (err.code === 3) {
          msg = 'Location request timed out. Please try searching instead.';
        }
        this.showToast(msg);
      },
      { timeout: 9000, enableHighAccuracy: true, maximumAge: 0 }
    );
  }

  handleSearchInput(query) {
    clearTimeout(this.searchDebounceTimer);
    const trimmed = typeof query === 'string' ? query.trim() : '';

    if (trimmed.length > 0) {
      this.searchClearBtn.classList.add('visible');
    } else {
      this.searchClearBtn.classList.remove('visible');
    }

    if (trimmed.length < 2) {
      this.renderQuickAccessDropdown();
      return;
    }

    this.searchDebounceTimer = setTimeout(async () => {
      if (this.searchAbortController) {
        this.searchAbortController.abort();
      }
      this.searchAbortController = new AbortController();

      if (this.searchSpinner) this.searchSpinner.classList.add('active');
      try {
        const results = await WeatherApi.searchLocations(trimmed, this.searchAbortController.signal);
        this.autocompleteResults = results;
        this.selectedIndex = -1;
        this.renderAutocomplete(results);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Search query error:', err);
        }
      } finally {
        if (this.searchSpinner) this.searchSpinner.classList.remove('active');
      }
    }, 280);
  }

  renderAutocomplete(results) {
    this.autocompleteDropdown.innerHTML = '';
    if (!results || results.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'autocomplete-empty';
      emptyLi.setAttribute('role', 'option');
      emptyLi.setAttribute('aria-disabled', 'true');
      emptyLi.textContent = 'No matching cities found. Try another search.';
      this.autocompleteDropdown.appendChild(emptyLi);
      this.autocompleteDropdown.classList.add('show');
      this.searchInput.setAttribute('aria-expanded', 'true');
      return;
    }

    results.forEach((item, idx) => {
      const li = document.createElement('li');
      li.id = `autocomplete-opt-${idx}`;
      li.className = 'autocomplete-item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      const citySpan = document.createElement('span');
      citySpan.className = 'autocomplete-city';
      citySpan.textContent = item.name;

      const countrySpan = document.createElement('span');
      countrySpan.className = 'autocomplete-country';
      countrySpan.textContent = [item.admin1, item.country].filter(Boolean).join(', ');

      li.appendChild(citySpan);
      li.appendChild(countrySpan);

      li.addEventListener('click', () => {
        this.selectLocation(item);
      });
      this.autocompleteDropdown.appendChild(li);
    });

    this.autocompleteDropdown.classList.add('show');
    this.searchInput.setAttribute('aria-expanded', 'true');
  }

  handleSearchKeydown(e) {
    if (!this.autocompleteDropdown.classList.contains('show')) return;
    const items = this.autocompleteDropdown.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % items.length;
      this.updateSelectedItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + items.length) % items.length;
      this.updateSelectedItem(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.selectedIndex >= 0 && this.autocompleteResults[this.selectedIndex]) {
        this.selectLocation(this.autocompleteResults[this.selectedIndex]);
      } else if (this.autocompleteResults.length > 0) {
        this.selectLocation(this.autocompleteResults[0]);
      }
    } else if (e.key === 'Escape') {
      this.closeAutocomplete();
    }
  }

  updateSelectedItem(items) {
    items.forEach((it, idx) => {
      const isSelected = idx === this.selectedIndex;
      it.classList.toggle('selected', isSelected);
      it.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      if (isSelected) {
        it.scrollIntoView({ block: 'nearest' });
        this.searchInput.setAttribute('aria-activedescendant', it.id);
      }
    });
    if (this.selectedIndex === -1) {
      this.searchInput.removeAttribute('aria-activedescendant');
    }
  }

  closeAutocomplete() {
    this.autocompleteDropdown.classList.remove('show');
    this.autocompleteDropdown.innerHTML = '';
    this.selectedIndex = -1;
    this.searchInput.setAttribute('aria-expanded', 'false');
    this.searchInput.removeAttribute('aria-activedescendant');
  }

  selectLocation(item) {
    this.currentLocation = {
      name: item.name,
      admin1: item.admin1 || '',
      country: item.country || '',
      latitude: parseFloat(item.latitude),
      longitude: parseFloat(item.longitude),
      timezone: item.timezone || 'auto'
    };
    this.addRecentSearch(this.currentLocation);
    this.searchInput.value = '';
    this.searchClearBtn.classList.remove('visible');
    this.closeAutocomplete();
    this.loadLocationWeather(this.currentLocation);
  }

  // --- Favorites & Recent Searches Management ---

  getFavorites() {
    return SafeStorage.getItem('weather_favorites', []);
  }

  isFavorite(loc) {
    if (!loc) return false;
    const favs = this.getFavorites();
    return favs.some(f => 
      (f.name && loc.name && f.name.toLowerCase() === loc.name.toLowerCase()) ||
      (typeof f.latitude === 'number' && typeof loc.latitude === 'number' &&
       Math.abs(f.latitude - loc.latitude) < 0.05 && Math.abs(f.longitude - loc.longitude) < 0.05)
    );
  }

  handleFavoriteToggle() {
    if (!this.currentLocation) return;
    const favs = this.getFavorites();
    const locName = this.currentLocation.name || 'Location';
    const existsIdx = favs.findIndex(f => 
      (f.name && this.currentLocation.name && f.name.toLowerCase() === this.currentLocation.name.toLowerCase()) ||
      (typeof f.latitude === 'number' && typeof this.currentLocation.latitude === 'number' &&
       Math.abs(f.latitude - this.currentLocation.latitude) < 0.05 && Math.abs(f.longitude - this.currentLocation.longitude) < 0.05)
    );

    if (existsIdx >= 0) {
      favs.splice(existsIdx, 1);
      SafeStorage.setItem('weather_favorites', favs);
      this.updateFavoriteButtonUI();
      this.showToast(`Removed ${locName} from favorites`);
    } else {
      const newFav = {
        name: this.currentLocation.name || 'Location',
        admin1: this.currentLocation.admin1 || '',
        country: this.currentLocation.country || '',
        latitude: this.currentLocation.latitude,
        longitude: this.currentLocation.longitude,
        timezone: this.currentLocation.timezone || 'auto'
      };
      favs.unshift(newFav);
      if (favs.length > 12) favs.pop();
      SafeStorage.setItem('weather_favorites', favs);
      this.updateFavoriteButtonUI();
      this.showToast(`Saved ${locName} to favorites ⭐`);
    }

    if (this.autocompleteDropdown.classList.contains('show') && (!this.searchInput.value || this.searchInput.value.trim().length < 2)) {
      this.renderQuickAccessDropdown();
    }
  }

  updateFavoriteButtonUI() {
    if (!this.heroFavoriteBtn) return;
    const isFav = this.isFavorite(this.currentLocation);
    this.heroFavoriteBtn.classList.toggle('favorited', isFav);
    const locName = this.currentLocation?.name || 'Location';
    const label = isFav ? `Remove ${locName} from favorites` : `Save ${locName} to favorites`;
    this.heroFavoriteBtn.setAttribute('aria-label', label);
    this.heroFavoriteBtn.setAttribute('title', label);
  }

  removeFavorite(idx) {
    const favs = this.getFavorites();
    if (idx >= 0 && idx < favs.length) {
      const removed = favs.splice(idx, 1)[0];
      SafeStorage.setItem('weather_favorites', favs);
      this.updateFavoriteButtonUI();
      this.showToast(`Removed ${removed.name || 'city'} from favorites`);
      this.renderQuickAccessDropdown();
    }
  }

  getRecentSearches() {
    return SafeStorage.getItem('weather_recents', []);
  }

  addRecentSearch(loc) {
    if (!loc || !loc.name || isNaN(loc.latitude) || isNaN(loc.longitude)) return;
    let recents = this.getRecentSearches();
    recents = recents.filter(r => 
      !(r.name.toLowerCase() === loc.name.toLowerCase() &&
        Math.abs(r.latitude - loc.latitude) < 0.05 &&
        Math.abs(r.longitude - loc.longitude) < 0.05)
    );
    recents.unshift({
      name: loc.name,
      admin1: loc.admin1 || '',
      country: loc.country || '',
      latitude: loc.latitude,
      longitude: loc.longitude,
      timezone: loc.timezone || 'auto'
    });
    if (recents.length > 6) recents.pop();
    SafeStorage.setItem('weather_recents', recents);
  }

  removeRecentSearch(idx) {
    const recents = this.getRecentSearches();
    if (idx >= 0 && idx < recents.length) {
      recents.splice(idx, 1);
      SafeStorage.setItem('weather_recents', recents);
      this.renderQuickAccessDropdown();
    }
  }

  clearRecentSearches() {
    SafeStorage.setItem('weather_recents', []);
    this.showToast('Cleared recent searches');
    this.renderQuickAccessDropdown();
  }

  handleSearchFocus() {
    const val = typeof this.searchInput.value === 'string' ? this.searchInput.value.trim() : '';
    if (val.length < 2) {
      this.renderQuickAccessDropdown();
    }
  }

  renderQuickAccessDropdown() {
    const favorites = this.getFavorites();
    const recents = this.getRecentSearches();

    if (favorites.length === 0 && recents.length === 0) {
      this.closeAutocomplete();
      return;
    }

    this.autocompleteDropdown.innerHTML = '';

    // 1. Favorites Section
    if (favorites.length > 0) {
      const favHeader = document.createElement('li');
      favHeader.className = 'dropdown-section-header';
      favHeader.innerHTML = `<span>★ Saved Favorites</span><span class="dropdown-item-badge">${favorites.length}</span>`;
      this.autocompleteDropdown.appendChild(favHeader);

      favorites.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'autocomplete-item';
        li.setAttribute('role', 'option');
        const sub = [item.admin1, item.country].filter(Boolean).join(', ');
        li.innerHTML = `
          <span class="autocomplete-city">⭐ ${escapeHtml(item.name)}</span>
          <div class="dropdown-item-meta">
            ${sub ? `<span class="autocomplete-country">${escapeHtml(sub)}</span>` : ''}
            <button type="button" class="dropdown-delete-item-btn" title="Remove favorite" aria-label="Remove ${escapeHtml(item.name)} from favorites">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        `;
        li.addEventListener('click', (e) => {
          if (e.target.closest('.dropdown-delete-item-btn')) return;
          this.selectLocation(item);
        });
        const delBtn = li.querySelector('.dropdown-delete-item-btn');
        if (delBtn) {
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeFavorite(idx);
          });
        }
        this.autocompleteDropdown.appendChild(li);
      });
    }

    // 2. Recent Searches Section
    if (recents.length > 0) {
      const recHeader = document.createElement('li');
      recHeader.className = 'dropdown-section-header';
      recHeader.innerHTML = `
        <span>🕒 Recent Searches</span>
        <button type="button" class="dropdown-clear-btn" id="clear-recents-btn">Clear All</button>
      `;
      const clearBtn = recHeader.querySelector('#clear-recents-btn');
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.clearRecentSearches();
        });
      }
      this.autocompleteDropdown.appendChild(recHeader);

      recents.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'autocomplete-item';
        li.setAttribute('role', 'option');
        const sub = [item.admin1, item.country].filter(Boolean).join(', ');
        li.innerHTML = `
          <span class="autocomplete-city">${escapeHtml(item.name)}</span>
          <div class="dropdown-item-meta">
            ${sub ? `<span class="autocomplete-country">${escapeHtml(sub)}</span>` : ''}
            <button type="button" class="dropdown-delete-item-btn" title="Remove from recents" aria-label="Remove ${escapeHtml(item.name)} from recents">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        `;
        li.addEventListener('click', (e) => {
          if (e.target.closest('.dropdown-delete-item-btn')) return;
          this.selectLocation(item);
        });
        const delBtn = li.querySelector('.dropdown-delete-item-btn');
        if (delBtn) {
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeRecentSearch(idx);
          });
        }
        this.autocompleteDropdown.appendChild(li);
      });
    }

    this.autocompleteDropdown.classList.add('show');
    this.searchInput.setAttribute('aria-expanded', 'true');
  }

  async loadLocationWeather(location) {
    if (!location || isNaN(location.latitude) || isNaN(location.longitude)) {
      this.showToast('Invalid location coordinates.');
      return;
    }

    SafeStorage.setItem('weather_last_loc', location);

    // Cancel ongoing fetch
    if (this.weatherAbortController) {
      this.weatherAbortController.abort();
    }
    this.weatherAbortController = new AbortController();

    this.isLoading = true;
    try {
      const [weather, aqi] = await Promise.all([
        WeatherApi.getWeather(location.latitude, location.longitude, location.timezone, this.weatherAbortController.signal),
        WeatherApi.getAirQuality(location.latitude, location.longitude, this.weatherAbortController.signal)
      ]);

      this.weatherData = weather;
      this.airQualityData = aqi;

      // Hide error state and clear stale shroud on success
      if (this.heroErrorState) this.heroErrorState.style.display = 'none';
      if (this.heroVisual) this.heroVisual.style.display = 'flex';
      if (this.heroFooterStats) this.heroFooterStats.style.display = 'grid';
      document.querySelectorAll('.hourly-forecast-section, .daily-forecast-card, #metrics-grid').forEach(el => {
        el.classList.remove('forecast-stale');
      });

      this.renderAll();
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to load weather:', err);
        if (this.heroErrorState) {
          this.heroErrorState.style.display = 'flex';
          if (this.heroErrorDesc) {
            this.heroErrorDesc.textContent = err.message || 'Unable to fetch weather forecast. Please check your network connection.';
          }
        }
        if (this.heroVisual) this.heroVisual.style.display = 'none';
        if (this.heroFooterStats) this.heroFooterStats.style.display = 'none';
        // Shroud stale secondary cards so users know data is unrefreshed
        document.querySelectorAll('.hourly-forecast-section, .daily-forecast-card, #metrics-grid').forEach(el => {
          el.classList.add('forecast-stale');
        });
        this.showToast(err.message || 'Unable to fetch weather forecast.');
      }
    } finally {
      this.isLoading = false;
    }
  }

  renderAll() {
    if (!this.weatherData) return;
    this.renderHeroCard();
    this.renderHourlyForecast();
    this.renderDailyForecast();
    this.renderMetricsGrid();
  }

  renderHeroCard() {
    const current = this.weatherData?.current;
    const daily = this.weatherData?.daily;
    if (!current) return;
    const weatherInfo = getWeatherInfo(current.weather_code, current.is_day);

    this.locationNameEl.textContent = this.currentLocation.name || 'Location';
    const sub = [this.currentLocation.admin1, this.currentLocation.country].filter(Boolean).join(', ');
    this.locationSubEl.textContent = sub || formatDateString(current.time);

    this.heroTempEl.textContent = formatTemp(current.temperature_2m, this.unit);
    this.heroConditionEl.textContent = weatherInfo.desc;
    this.heroIconContainer.innerHTML = getSvgIcon(weatherInfo.iconKey, weatherInfo.isDay, 76);

    const maxTemp = daily?.temperature_2m_max?.[0];
    const minTemp = daily?.temperature_2m_min?.[0];
    this.heroHighLowEl.textContent = `H: ${formatTemp(maxTemp, this.unit)} · L: ${formatTemp(minTemp, this.unit)}`;

    this.heroFeelsEl.textContent = formatTemp(current.apparent_temperature, this.unit);
    this.heroHumidityEl.textContent = current.relative_humidity_2m !== undefined ? `${current.relative_humidity_2m}%` : '--%';
    this.heroWindEl.textContent = formatSpeed(current.wind_speed_10m, this.unit);
    this.updateFavoriteButtonUI();

    // Trigger subtle data reveal animation
    const heroCard = document.getElementById('hero-card');
    if (heroCard) {
      heroCard.classList.remove('hero-data-animate');
      void heroCard.offsetWidth; // Force reflow
      heroCard.classList.add('hero-data-animate');
    }
  }

  /**
   * Index into the hourly arrays matching the current hour in the location's
   * local time. Shared by the hourly strip and the metrics grid so both read
   * the same point in the forecast.
   */
  getCurrentHourIndex() {
    const hourly = this.weatherData?.hourly;
    const currentLocalTime = this.weatherData?.current?.time;
    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) return 0;
    if (currentLocalTime && typeof currentLocalTime === 'string') {
      const curHour = currentLocalTime.slice(0, 13);
      const idx = hourly.time.findIndex(t => typeof t === 'string' && t.startsWith(curHour));
      if (idx !== -1) return idx;
    }
    return 0;
  }

  renderHourlyForecast() {
    const hourly = this.weatherData?.hourly;
    if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0) return;

    const startIndex = this.getCurrentHourIndex();

    const next24Times = hourly.time.slice(startIndex, startIndex + 24);
    const next24Temps = (hourly.temperature_2m || []).slice(startIndex, startIndex + 24);
    const next24Precip = (hourly.precipitation_probability || []).slice(startIndex, startIndex + 24);
    const next24Codes = (hourly.weather_code || []).slice(startIndex, startIndex + 24);
    const next24IsDay = (hourly.is_day || []).slice(startIndex, startIndex + 24);
    const next24Winds = (hourly.wind_speed_10m || []).slice(startIndex, startIndex + 24);

    // Populate horizontal hourly cards
    this.hourlyStripEl.innerHTML = '';
    const formattedTimes = [];
    for (let i = 0; i < next24Times.length; i++) {
      const timeStr = i === 0 ? 'Now' : formatTimeOnly(next24Times[i]);
      formattedTimes.push(timeStr);
      const tempVal = formatTemp(next24Temps[i], this.unit);
      const rainChance = next24Precip[i] || 0;
      const info = getWeatherInfo(next24Codes[i], next24IsDay[i]);
      const windSpd = formatSpeed(next24Winds[i], this.unit);

      const item = document.createElement('div');
      item.className = `hourly-item ${i === 0 ? 'now' : ''}`;
      item.setAttribute('title', `${timeStr}: ${info.desc}, ${tempVal}`);
      item.innerHTML = `
        <span class="hourly-time">${timeStr}</span>
        <div class="hourly-icon">${getSvgIcon(info.iconKey, info.isDay, 36)}</div>
        <span class="hourly-temp">${tempVal}</span>
        <span class="hourly-condition-name" title="${escapeHtml(info.desc)}">${escapeHtml(info.desc)}</span>
        ${rainChance > 0 ? `<span class="hourly-rain"><img src="/static/icons/raindrop.svg" width="12" height="12" alt="" aria-hidden="true" style="width:12px; height:12px; display:inline-block; vertical-align:middle; margin-right:2px;" />${rainChance}%</span>` : `<span class="hourly-wind-sub">${windSpd}</span>`}
      `;
      this.hourlyStripEl.appendChild(item);
    }

    this.updateHourlyScrollArrows();
    setTimeout(() => this.updateHourlyScrollArrows(), 50);
  }

  renderDailyForecast() {
    const daily = this.weatherData?.daily;
    if (!daily || !Array.isArray(daily.time) || daily.time.length === 0) return;

    this.dailyListEl.innerHTML = '';

    const count = Math.min(8, daily.time.length);

    // Calculate global weekly min and max to proportionally scale the bars
    let weekMin = Infinity;
    let weekMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const minC = daily.temperature_2m_min?.[i];
      const maxC = daily.temperature_2m_max?.[i];
      if (typeof minC === 'number') {
        const val = convertTemp(minC, this.unit);
        if (val < weekMin) weekMin = val;
      }
      if (typeof maxC === 'number') {
        const val = convertTemp(maxC, this.unit);
        if (val > weekMax) weekMax = val;
      }
    }
    if (weekMin === Infinity) weekMin = 0;
    if (weekMax === -Infinity) weekMax = 10;
    const weekSpan = Math.max(weekMax - weekMin, 1);

    for (let i = 0; i < count; i++) {
      const dayName = formatDayName(daily.time[i], i === 0);
      const dateStr = formatDateString(daily.time[i]).split(',')[1]?.trim() || '';
      const info = getWeatherInfo(daily.weather_code?.[i], 1);
      const minValNum = convertTemp(daily.temperature_2m_min?.[i], this.unit);
      const maxValNum = convertTemp(daily.temperature_2m_max?.[i], this.unit);
      const minVal = `${minValNum}°`;
      const maxVal = `${maxValNum}°`;
      const precipProb = daily.precipitation_probability_max?.[i] || 0;

      // Calculate bar fill offset & width in percentage
      const barLeft = Math.max(0, Math.min(90, Math.round(((minValNum - weekMin) / weekSpan) * 100)));
      const barRight = Math.max(10, Math.min(100, Math.round(((maxValNum - weekMin) / weekSpan) * 100)));
      const barWidth = Math.max(10, barRight - barLeft);

      const row = document.createElement('div');
      row.className = 'daily-row';
      row.setAttribute('title', `${dayName}: ${info.desc}, Low ${minVal}, High ${maxVal}`);
      row.innerHTML = `
        <div class="daily-day-group">
          <span class="daily-day-name">${dayName}</span>
          <span class="daily-date-sub">${dateStr}</span>
        </div>
        <div class="daily-icon-col" title="${escapeHtml(info.desc)}">
          ${getSvgIcon(info.iconKey, true, 28)}
        </div>
        <div class="temp-bar-container" aria-label="Low ${minVal}, High ${maxVal}">
          <span class="daily-min">${minVal}</span>
          <div class="temp-bar-track">
            <div class="temp-bar-fill" style="left: ${barLeft}%; width: ${barWidth}%;"></div>
          </div>
          <span class="daily-max">${maxVal}</span>
        </div>
      `;
      this.dailyListEl.appendChild(row);
    }
  }

  renderMetricsGrid() {
    const current = this.weatherData?.current || {};
    const daily = this.weatherData?.daily || {};
    const hourly = this.weatherData?.hourly || {};

    // 1. UV Index
    const uvVal = current.uv_index !== undefined ? current.uv_index : (daily.uv_index_max?.[0] || 0);
    const uvRisk = getUvRisk(uvVal);
    this.uvValEl.textContent = typeof uvVal === 'number' ? uvVal.toFixed(1) : '--';
    this.uvStatusEl.textContent = uvRisk.text;
    this.uvStatusEl.style.color = uvRisk.color;
    this.uvAdviceEl.textContent = uvRisk.advice;
    if (this.uvIconImg) {
      if (typeof uvVal === 'number' && uvVal < 0.5) {
        this.uvIconImg.src = '/static/icons/uv-index.svg';
      } else {
        const uvNum = Math.min(11, Math.max(1, Math.round(uvVal)));
        this.uvIconImg.src = `/static/icons/uv-index-${uvNum}.svg`;
      }
    }
    const uvFill = document.getElementById('uv-gauge-fill');
    const uvMeter = document.getElementById('uv-meter');
    if (typeof uvVal === 'number') {
      if (uvFill) uvFill.style.transform = `scaleX(${Math.min(1, Math.max(0, uvVal / 11)).toFixed(3)})`;
      if (uvMeter) uvMeter.setAttribute('aria-valuenow', uvVal.toFixed(1));
    }

    // 2. Wind & Beaufort Scale
    this.windValEl.textContent = formatSpeed(current.wind_speed_10m, this.unit);
    const gusts = current.wind_gusts_10m ? formatSpeed(current.wind_gusts_10m, this.unit) : null;
    this.windGustsEl.textContent = gusts ? `Peak gusts up to ${gusts}` : 'Steady atmospheric flow';
    const directionStr = getWindDirection(current.wind_direction_10m);
    this.windDirectionEl.textContent = `${directionStr} ${current.wind_direction_10m || 0}°`;
    const beaufort = getBeaufortScale(current.wind_speed_10m);
    if (this.windScaleNameEl) {
      this.windScaleNameEl.textContent = getBeaufortName(beaufort);
    }
    if (this.windIconImg) {
      this.windIconImg.src = `/static/icons/wind-beaufort-${beaufort}.svg`;
    }
    const windFill = document.getElementById('wind-gauge-fill');
    const windMeter = document.getElementById('wind-meter');
    if (typeof beaufort === 'number') {
      if (windFill) windFill.style.transform = `scaleX(${Math.min(1, Math.max(0, beaufort / 12)).toFixed(3)})`;
      if (windMeter) windMeter.setAttribute('aria-valuenow', String(beaufort));
    }

    // 3. Humidity & Moisture
    this.humidityValEl.textContent = current.relative_humidity_2m !== undefined ? `${current.relative_humidity_2m}%` : '--%';
    const hourIdx = this.getCurrentHourIndex();
    const dewPoint = hourly?.dew_point_2m?.[hourIdx];
    this.dewPointEl.textContent = `Dew point ${formatTemp(dewPoint, this.unit)}`;
    if (current.relative_humidity_2m < 35) {
      this.humidityDescEl.textContent = 'Air feels dry and crisp.';
    } else if (current.relative_humidity_2m <= 65) {
      this.humidityDescEl.textContent = 'Comfortable moisture levels.';
    } else {
      this.humidityDescEl.textContent = 'High moisture, feels humid.';
    }
    const humidityFill = document.getElementById('humidity-gauge-fill');
    const humidityMeter = document.getElementById('humidity-meter');
    if (typeof current.relative_humidity_2m === 'number') {
      if (humidityFill) humidityFill.style.transform = `scaleX(${Math.min(1, Math.max(0, current.relative_humidity_2m / 100)).toFixed(3)})`;
      if (humidityMeter) humidityMeter.setAttribute('aria-valuenow', String(current.relative_humidity_2m));
    }

    // 4. Pressure & Visibility
    const visibilityMeters = hourly?.visibility?.[hourIdx] || 10000;
    this.visibilityValEl.textContent = formatVisibility(visibilityMeters, this.unit);
    const pressureVal = current.pressure_msl || current.surface_pressure;
    this.pressureValEl.textContent = formatPressure(pressureVal, this.unit);
    if (this.pressureIconImg) {
      this.pressureIconImg.src = (pressureVal && pressureVal >= 1013) ? '/static/icons/pressure-high.svg' : '/static/icons/barometer.svg';
    }
    if (visibilityMeters >= 9000) {
      this.visibilityDescEl.textContent = 'Perfect clear view.';
    } else {
      this.visibilityDescEl.textContent = 'Misty or hazy conditions.';
    }
    const pressureFill = document.getElementById('pressure-gauge-fill');
    const pressureMeter = document.getElementById('pressure-meter');
    if (pressureVal) {
      if (pressureFill) pressureFill.style.transform = `scaleX(${Math.min(1, Math.max(0, (pressureVal - 970) / (1050 - 970))).toFixed(3)})`;
      if (pressureMeter) pressureMeter.setAttribute('aria-valuenow', String(Math.round(pressureVal)));
    }

    // 5. Solar Ephemeris
    const sunrise = daily?.sunrise?.[0];
    const sunset = daily?.sunset?.[0];
    this.sunriseValEl.textContent = formatTimeOnly(sunrise);
    this.sunsetValEl.textContent = formatTimeOnly(sunset);

    const currentLocalTime = current.time || null;
    const isDay = current.is_day !== undefined ? current.is_day : null;
    const solarPos = calculateSunPosition(sunrise, sunset, currentLocalTime, isDay);
    this.solarStatusEl.textContent = solarPos.isDaytime ? 'Daylight' : 'Night';
    if (this.solarIconImg) {
      this.solarIconImg.src = `/static/icons/${solarPos.isDaytime ? 'sunrise.svg' : getMoonPhaseIcon()}`;
    }
    if (this.solarDescEl) {
      this.solarDescEl.textContent = solarPos.label;
    }
    const solarFill = document.getElementById('solar-gauge-fill');
    const solarMeter = document.getElementById('solar-meter');
    if (solarPos) {
      if (solarFill) {
        solarFill.classList.toggle('night', !solarPos.isDaytime);
        solarFill.style.transform = `scaleX(${Math.min(1, Math.max(0, solarPos.percent / 100)).toFixed(3)})`;
      }
      if (solarMeter) solarMeter.setAttribute('aria-valuenow', String(Math.round(solarPos.percent)));
    }

    // 6. Air Quality
    const aqiVal = this.airQualityData?.current?.us_aqi || this.airQualityData?.current?.european_aqi || null;
    const aqiInfo = getAqiDetails(aqiVal);
    this.aqiValEl.textContent = aqiVal !== null ? aqiVal : '--';
    this.aqiStatusEl.textContent = aqiInfo.text;
    this.aqiStatusEl.style.color = aqiInfo.color;
    if (this.aqiIconImg) {
      this.aqiIconImg.src = (aqiVal && aqiVal > 100) ? '/static/icons/dust-wind.svg' : '/static/icons/dust-day.svg';
    }
    this.aqiDescEl.textContent = aqiInfo.description;
    const aqiFill = document.getElementById('aqi-gauge-fill');
    const aqiMeter = document.getElementById('aqi-meter');
    if (typeof aqiVal === 'number') {
      if (aqiFill) aqiFill.style.transform = `scaleX(${Math.min(1, Math.max(0, aqiVal / 300)).toFixed(3)})`;
      if (aqiMeter) aqiMeter.setAttribute('aria-valuenow', String(Math.round(aqiVal)));
    }
  }

  // --- Hourly Strip Scrolling ---

  scrollHourly(amount) {
    if (!this.hourlyStripContainer) return;
    this.hourlyStripContainer.scrollBy({ left: amount, behavior: 'smooth' });
    setTimeout(() => this.updateHourlyScrollArrows(), 350);
  }

  updateHourlyScrollArrows() {
    if (!this.hourlyStripContainer || !this.hourlyScrollLeftBtn || !this.hourlyScrollRightBtn) return;
    const { scrollLeft, scrollWidth, clientWidth } = this.hourlyStripContainer;
    this.hourlyScrollLeftBtn.disabled = scrollLeft <= 4;
    this.hourlyScrollRightBtn.disabled = scrollLeft + clientWidth >= scrollWidth - 4;
  }
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WeatherApp();
});

// Register Service Worker for offline shell & asset caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('ServiceWorker registration error:', err);
    });
  });
}

