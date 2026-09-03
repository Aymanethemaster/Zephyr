# Zephyr
#### Video Demo: https://youtu.be/WSgSxj3xZZM
#### Description:

Zephyr is a lightweight, real-time weather web application and Progressive Web App (PWA) built with Python (Flask) and vanilla HTML, CSS, and JavaScript. The application delivers comprehensive weather forecasts and atmospheric intelligence without requiring any API keys, user registration, or paid third-party subscriptions.

### Overview

Weather applications often require complex build pipelines, heavy JavaScript frameworks, or proprietary API keys with strict usage quotas. Zephyr was designed to demonstrate that a responsive, aesthetically refined, and production-ready application can be created using standard web standards and open, public data sources.

The application operates in a hybrid architectural mode:
1. **Full-Stack Mode**: When hosted with the Python Flask backend, it provides server-side proxying, thread-safe in-memory caching, sliding-window rate limiting, and HTTP security headers.
2. **Decoupled Client Mode**: If deployed to a static host (such as GitHub Pages or Vercel) where the Python backend is absent, the client-side API layer automatically falls back to querying upstream public APIs directly.

### Key Features

- **Current Weather & Highlights**: Displays temperature, perceived feels-like temperature, conditions, humidity, wind velocity, and daily temperature ranges.
- **24-Hour Hourly Forecast**: A horizontally scrollable timeline showing hour-by-hour temperature, weather codes, precipitation probabilities, and wind speeds.
- **7-Day Daily Forecast**: An 8-day outlook featuring proportional temperature range bars that scale dynamically against the week's minimum and maximum values.
- **Atmospheric & Environmental Metrics**:
  - **UV Index**: Dynamic UV ratings with protective exposure recommendations and vector gauges.
  - **Wind & Beaufort Scale**: Wind direction degrees and names mapped directly to the Beaufort wind force scale (0 to 12).
  - **Humidity & Dew Point**: Relative humidity percentage and calculated dew point temperature.
  - **Atmospheric Pressure & Visibility**: Barometric pressure readings and viewing distance visibility.
  - **Solar & Ephemeris**: Real-time calculation of daylight progression, sunrise, sunset, and current lunar phase.
  - **Air Quality Index (AQI)**: United States and European AQI measurements with health risk indicators.
- **Location Detection & City Search**:
  - Automatic detection via browser GPS geolocation.
  - IP-based geolocation fallback for devices without GPS hardware or permissions.
  - Global city search powered by Open-Meteo and OpenStreetMap Photon for typo-tolerant matching.
- **Offline & PWA Capabilities**: Offline application shell caching via a Service Worker and local storage persistence for user preferences, search history, and saved favorites.
- **Unit Customization**: Dynamic conversion between metric (Celsius, km/h, mm, hPa) and imperial (Fahrenheit, mph, in, inHg) systems with instant UI updates.

### File Structure and Purpose

Below is a summary of the primary files in the repository:

- **`app.py`**: The core Flask backend. It defines API proxy routes (`/api/weather`, `/api/geocoding`, `/api/reverse-geocode`, `/api/ip-location`, `/api/air-quality`, `/api/health`), enforces security headers (nosniff, frame denial, strict referrer policy), handles thread-safe in-memory caching with TTLs, and implements a sliding-window rate limiter per client IP.
- **`index.html`**: The semantic HTML5 application layout. It includes accessible WAI-ARIA roles, search comboboxes, atmospheric metric cards, and placeholders for dynamic weather data.
- **`sw.js`**: The Service Worker powering offline capabilities. It pre-caches essential application assets (HTML, CSS, JavaScript, manifest, and SVG icons), provides cache-first serving for static files, and enables a network-first strategy with cache fallback for live weather requests.
- **`static/css/style.css`**: The design system stylesheet. Built with vanilla CSS variables, it implements a dark slate glassmorphism aesthetic, subtle ambient background glow animations, responsive breakpoints for desktop and mobile, and a `prefers-reduced-motion` media query for accessibility.
- **`static/js/app.js`**: The main frontend controller. It manages application state, orchestrates user events, coordinates geolocation retrieval, handles favorite locations, and updates all DOM elements.
- **`static/js/weather-api.js`**: The client-side API communication layer. It attempts requests through the local Flask proxy first and transparently falls back to direct client-side requests if the proxy is unavailable.
- **`static/js/utils.js`**: A pure utility library containing WMO weather code mappings, unit converters, the Beaufort scale calculator, astronomical sun position tracking, lunar phase algorithms, and SVG icon selectors.
- **`static/js/weather-params.json`**: A shared configuration file specifying the exact Open-Meteo fields requested by both `app.py` and `weather-api.js`, guaranteeing consistent data structures across backend and frontend.
- **`static/manifest.json`**: The Progressive Web App manifest defining standalone display settings, theme colors, and icons for mobile installation.
- **`tests/test_app.py`**: An automated test suite containing 28 unit and integration tests written for pytest. It validates caching logic, rate limiting, security headers, geocoding fallbacks, and error scenarios.
- **`requirements.txt` / `requirements-dev.txt`**: Dependency specifications for production (Flask, Requests, Gunicorn) and development/testing (pytest).
- **`pytest.ini`**: Pytest configuration file declaring test paths and module search settings.
- **`Procfile` / `vercel.json`**: Deployment configurations supporting both WSGI production environments (Gunicorn on Heroku/Render) and static deployment platforms (Vercel).

### Design and Implementation Decisions

1. **Vanilla Architecture**: Avoiding heavy frontend libraries such as React or Vue allowed the application to remain lightweight, load instantly, and run without Node.js build dependencies or asset bundlers.
2. **Single Source of Truth for Parameters**: Placing the Open-Meteo parameters into `weather-params.json` ensures that both the Python backend and JavaScript client always query identical fields, eliminating discrepancies during failovers.
3. **Multi-Tier Geocoding Fallbacks**: If the primary Open-Meteo geocoding service yields fewer than two results, the system queries OpenStreetMap Photon to provide fuzzy, typo-tolerant matching while filtering out non-city points of interest.
4. **Resilient Local Storage**: Browser local storage access is wrapped in error-handling utilities to safeguard against private browsing storage quotas and malformed cache records.
5. **Accessibility**: All interactive components are navigable via keyboard shortcuts (`/` or `Ctrl+K` to search, `U` to toggle units, arrow keys for autocomplete), and visual indicators include corresponding ARIA meter and live region attributes.

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
