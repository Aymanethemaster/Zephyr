# Zephyr

A lightweight, real-time weather web application and Progressive Web App (PWA) built with **Python (Flask)** and **vanilla HTML, CSS, and JavaScript**. Zero API keys, zero user tracking, and instant offline access.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://zephyr-mocha.vercel.app)
[![Video Demo](https://img.shields.io/badge/demo-youtube-red.svg)](https://youtu.be/WSgSxj3xZZM)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/)

---

## Highlights

- **Live & Extended Forecasts**: Current conditions, 24-hour hourly timeline, and 7-day outlook with proportional temperature range bars.
- **Atmospheric Intelligence**: UV Index risk scale, Beaufort wind force gauge, dew point humidity comfort, barometric pressure, lunar phase, and Air Quality Index (AQI).
- **Zero API Keys Required**: Powered entirely by open public endpoints (Open-Meteo, OpenStreetMap Photon, BigDataCloud, GeoJS).
- **Hybrid Architecture**:
  - **Full-Stack Mode**: Flask backend with thread-safe in-memory LRU cache, sliding-window rate limiting, and circuit breaker protection.
  - **Decoupled Client Mode**: Works as a standalone client-side PWA on static hosts (Vercel, GitHub Pages) with direct API fallbacks.
- **Offline PWA Support**: Service Worker with partitioned caches and full offline precache for 120+ animated weather SVG icons.
- **Accessible & Responsive**: Keyboard shortcuts (`/` or `Ctrl+K` for search, `U` for units), WAI-ARIA 1.2 combobox, WCAG 2.1 AA contrast, and reduced-motion support.

---

## Tech Stack

| Layer | Technologies |
|:---|:---|
| **Backend** | Python 3.10+, Flask, Requests (HTTP Pooling), Gunicorn |
| **Frontend** | Vanilla JavaScript (ES Modules), Vanilla CSS (Glassmorphism), Semantic HTML5 |
| **PWA** | Service Worker (Stale-While-Revalidate, Cache Partitioning), Web App Manifest |
| **APIs** | Open-Meteo (Weather & AQI), Photon Komoot (Fuzzy Geocoding), BigDataCloud & GeoJS (IP / Reverse Geo) |

---

## Quick Start

### Prerequisites
- Python 3.10 or higher
- pip

### 1. Clone the repository
```bash
git clone https://github.com/Aymanethemaster/Zephyr.git
cd Zephyr
```

### 2. Install dependencies
```bash
pip install -r requirements.txt
```

### 3. Run the application
```bash
python app.py
```
Open **http://127.0.0.1:5000** in your browser.

---

## Keyboard Shortcuts

| Shortcut | Action |
|:---|:---|
| `/` or `Ctrl + K` | Focus search bar |
| `U` | Toggle temperature units (°C / °F) |
| `↑` / `↓` | Navigate autocomplete suggestions |
| `Enter` | Select location |
| `Delete` / `Backspace` | Remove highlighted favorite or recent search |
| `Escape` | Close search dropdown |

---

## Configuration

All configuration is handled via optional environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `ALLOWED_ORIGINS` | Comma-separated list of allowed origins for `/api/*` | *(permissive for local dev)* |
| `BEHIND_PROXY` | Set to `1` when deployed behind a reverse proxy (e.g., Vercel, Render) | `0` |
| `PORT` | Local server port | `5000` |
| `FLASK_DEBUG` | Set to `1` for Flask debug mode | `0` |

---

## Running Tests

Zephyr includes automated test suites covering concurrency, caching, rate limiting, and accessibility:

```bash
# Python tests (70 tests)
pip install -r requirements-dev.txt
python -m pytest

# Node.js tests (35 tests)
node tests/test_utils.mjs
node tests/test_m2_stress.mjs
node tests/test_m2_sw_a11y_stress.mjs
```

---

## Author

Created by [**Aiman Mokhtari (@Aymanethemaster)**](https://github.com/Aymanethemaster).

Repository: [https://github.com/Aymanethemaster/Zephyr](https://github.com/Aymanethemaster/Zephyr)

---

## License

This project is licensed under the [MIT License](LICENSE).
