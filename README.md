# Zephyr
#### Video Demo: https://youtu.be/WSgSxj3xZZM
#### Description:

Zephyr is a lightweight, real-time weather web application and Progressive Web App (PWA) built with Python (Flask) on the backend and vanilla HTML, CSS, and modern JavaScript on the frontend. The application delivers comprehensive weather forecasts, atmospheric metrics, and astronomical calculations without requiring any user registration, API keys, or paid commercial subscriptions.

### Overview and Motivation

Most modern web applications rely heavily on massive frontend frameworks, complex build tooling, and external APIs protected by commercial paywalls or restrictive rate limits. The objective of Zephyr was to build an authentic, production-grade weather platform that remains fast, completely free of third-party API keys, and capable of operating both as a full-stack Flask application and as a standalone client-side single-page application.

Zephyr aggregates real-time meteorological observations, 24-hour hourly forecasts, and 7-day extended forecasts by communicating directly with open, public data endpoints. To ensure high resilience, the platform incorporates automated fallbacks across every layer of its architecture, including dual geocoding providers, dual IP lookup services, in-memory caching, client-side offline storage, and a Progressive Web App Service Worker.

The application operates in a hybrid architectural mode:
1. **Full-Stack Mode**: When hosted with the Python Flask backend, it provides server-side proxying, thread-safe in-memory caching, sliding-window rate limiting, and HTTP security headers.
2. **Decoupled Client Mode**: If deployed to a static host (such as GitHub Pages or Vercel) where the Python backend is absent, the client-side API layer automatically falls back to querying upstream public APIs directly without breaking functionality.

### Key Features and Functionality

- **Live Meteorological Observations**: Real-time display of current temperature, apparent feels-like temperature, condition summaries, relative humidity, wind velocity, and daily high and low ranges.
- **24-Hour Hourly Forecast**: A horizontal timeline strip detailing upcoming hourly temperatures, precipitation probabilities, condition summaries, and wind speeds, complete with left and right scroll navigation controls.
- **7-Day Daily Forecast**: An 8-day outlook featuring proportional temperature range bars that scale dynamically against the entire week's minimum and maximum recorded values, providing immediate visual contrast of temperature shifts.
- **Atmospheric and Environmental Metrics**:
  - **UV Index**: Live UV radiation rating with exposure safety advice, gauge fills, and color-coded risk levels.
  - **Wind & Beaufort Scale**: Wind direction degrees and cardinal names mapped directly to the international Beaufort wind force scale (0 to 12) with dedicated vector gauges.
  - **Humidity & Dew Point**: Relative moisture percentages accompanied by calculated dew point values and human comfort descriptions.
  - **Pressure & Visibility**: Barometric pressure readings and optical viewing distance estimates.
  - **Solar & Ephemeris**: Dynamic calculation of daylight progression percentages, sunrise and sunset times, and the current lunar phase using astronomical position algorithms.
  - **Air Quality Index (AQI)**: United States and European AQI metrics evaluating particulate matter (PM2.5, PM10, ozone, carbon monoxide, nitrogen dioxide) and environmental health safety.
- **Dual Location Services**: Automatic position detection prioritizing browser GPS coordinates with a silent fallback to IP address geolocation, alongside a global city search engine with typo-tolerant fuzzy matching.
- **Offline PWA Resilience**: Full Service Worker caching enabling instantaneous application shell loading and offline access to recently viewed weather forecasts.
- **User Personalization**: Instant toggle between Celsius and Fahrenheit units, persistent search history, and a star-based favorite locations system saved locally in the browser.

### Project Files and Architecture

Below is a detailed breakdown of the files developed for this project and their respective roles:

- **`app.py`**: The core Flask backend server. It exposes reverse-proxy endpoints (`/api/weather`, `/api/geocoding`, `/api/reverse-geocode`, `/api/ip-location`, `/api/air-quality`, `/api/health`). It attaches HTTP security headers (`nosniff`, `DENY` framing, strict referrer policies, permissions policies), handles thread-safe in-memory caching protected by mutex locks (`CACHE_LOCK`) to prevent upstream API abuse, and enforces a sliding-window rate limit per client IP address. It also includes automatic background pruning for stale cache entries and rate-limit tracking buckets to preserve memory.
- **`index.html`**: The semantic HTML5 foundation of the user interface. It defines the application layout, search combobox, hero cards, hourly timeline container, daily forecast list, and atmospheric gauge grids with full WAI-ARIA accessibility roles (`role="combobox"`, `role="listbox"`, `role="meter"`, `role="alert"`, `role="status"`).
- **`sw.js`**: The Progressive Web App Service Worker. It pre-caches core application assets and SVG vectors upon installation, applies a cache-first strategy for static files, and uses a network-first strategy with cache fallback for weather API calls.
- **`static/css/style.css`**: The complete visual design system. Written in vanilla CSS without external CSS frameworks, it implements a dark slate glassmorphism aesthetic, subtle ambient background glow animations, responsive breakpoints for desktop and mobile, and a `prefers-reduced-motion` media query for accessibility.
- **`static/js/app.js`**: The primary client-side application controller. It manages state transitions, keyboard shortcuts (`/` or `Ctrl+K` for search, `U` for units), event listeners, geolocation workflows, local storage persistence, and DOM updates. It includes a `SafeStorage` wrapper that prevents crashes in private browsing mode or storage quota limits.
- **`static/js/weather-api.js`**: The network client module. It orchestrates API communications by querying the local Flask proxy first and seamlessly falling back to direct public endpoints if running in a static environment. All requests implement `AbortController` timeouts and signal cancellation to prevent race conditions.
- **`static/js/utils.js`**: A modular collection of pure utility functions handling WMO weather code translations, unit conversions, lunar phase tracking, the Beaufort wind scale, and sun angle calculations.
- **`static/js/weather-params.json`**: A shared JSON configuration file defining the exact query parameters requested from Open-Meteo, guaranteeing data consistency between backend and frontend.
- **`static/manifest.json`**: The PWA web application manifest configuring theme colors, standalone display mode, and application launcher icons for mobile devices.
- **`tests/test_app.py`**: A comprehensive test suite containing 28 automated unit and integration tests using pytest. It validates caching logic, cache expiration, rate limiting, security headers, geocoding fallbacks, and error scenarios.
- **`requirements.txt` & `requirements-dev.txt`**: Dependency manifests listing production libraries (Flask, Requests, Gunicorn) and development testing packages (pytest).
- **`pytest.ini`**: Configuration file setting pythonpath and test directory discovery rules.
- **`Procfile` & `vercel.json`**: Deployment manifests facilitating cloud hosting on both Python WSGI platforms (Heroku, Render) and static hosting providers (Vercel).

### Design Choices and Trade-Offs

During the design and implementation of Zephyr, several architectural choices were evaluated:

1. **Vanilla JavaScript and CSS vs. Frameworks**: Rather than adopting React, Next.js, or Tailwind CSS, vanilla web standards were chosen. This decision eliminated heavy build tooling, kept bundle sizes minimal, allowed instant browser loading, and demonstrated mastery of core web technologies.
2. **In-Memory Caching vs. Database**: Because weather and geocoding data are ephemeral and externally sourced, an in-memory thread-safe dictionary with TTL expiration was selected over an external database like SQLite or PostgreSQL. This reduced latency to near-zero and eliminated operational database overhead.
3. **Dual-Mode Hybrid Architecture**: By enabling `weather-api.js` to communicate with both the Flask backend proxy and directly with public APIs, Zephyr achieves complete deployment independence. It can run as a secure full-stack server or as a static client-side web app without breaking functionality.
4. **Typo-Tolerant Geocoding Fallback**: Standard geocoding services often fail when user input contains minor spelling errors. Zephyr addresses this by attempting Open-Meteo prefix matching first and falling back to OpenStreetMap Photon for fuzzy multilingual resolution while excluding commercial points of interest.
5. **Accessibility and Motion Comfort**: The application provides keyboard accessibility, high-contrast readable text tokens conforming to WCAG standards, and a complete reduced-motion mode that eliminates ambient glow movement and transitions for sensitive users.

### Getting Started

#### Prerequisites

- Python 3.10 or higher
- pip package manager

#### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Aymanethemaster/Zephyr.git
   cd Zephyr
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the development server:
   ```bash
   python app.py
   ```

4. Open `http://127.0.0.1:5000` in your web browser.

#### Running Tests

To run the automated test suite:

```bash
pip install -r requirements-dev.txt
python -m pytest
```

### License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
