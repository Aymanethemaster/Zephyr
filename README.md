# 🌤️ Zephyr — Zero-API-Key Weather Web App

<div align="center">

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.0%2B-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![API Keys](https://img.shields.io/badge/API%20Keys-Zero%20Required-success?style=flat)](https://open-meteo.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Aymanethemaster-181717?logo=github&logoColor=white)](https://github.com/Aymanethemaster)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)]()

**A fast, modern, and responsive atmospheric weather web application built with Python (Flask) on the backend and pure Vanilla HTML5, CSS3, & Modern ES6+ JavaScript on the frontend.**

[Features](#-features) • [Quick Start](#-quick-start) • [Architecture](#-architecture) • [Deployment](#-deployment) • [API Reference](#-api-reference) • [License](#-license)

</div>

---

## 🌟 Highlights

- **100% Free & Zero API Keys**: Works immediately upon cloning — no account creation, tokens, or credit cards required.
- **Dynamic Atmospheric Glassmorphism**: Translucent frosted-glass cards with ambient glow lighting that dynamically shifts across 7 real-time weather themes (_Clear Day, Clear Night, Overcast, Rain, Snow, Fog, Thunderstorm_).
- **Instant Geolocation on Startup**: Automatically requests browser GPS on load, reverse-geocodes your coordinates, and renders your exact local weather in seconds.
- **Hybrid Global Search**: Typo-tolerant and multilingual city search powered by Open-Meteo and OpenStreetMap Photon (_e.g., handles international transliterations_).
- **Pure Meteocons 2.0.0 SVGs**: 122 animated, hardware-accelerated vector weather icons across every card and metric.
- **24-Hour & 7-Day Forecasts**: Animated hourly strip with precipitation probabilities, alongside a 7-day daily forecast with proportional temperature range bars.
- **Atmospheric Metrics Grid**:
  - ☀️ **UV Index** with color-coded exposure gauge & real-time safety recommendations.
  - 💨 **Wind Speed & Direction** with Beaufort scale tracking and animated direction indicators.
  - 💧 **Humidity & Dew Point** with moisture comfort analysis.
  - 👁️ **Visibility & Barometric Pressure** with clarity ratings.
  - 🌅 **Solar Ephemeris Arc** tracking live sun elevation, sunrise/sunset times, and calculated lunar phases.
  - 🍃 **Air Quality Index (AQI)** reporting US AQI levels and health guidance.
- **Seamless Unit Toggle**: Instant switching between Celsius (°C / km/h / mm) and Fahrenheit (°F / mph / in) with zero page reloads.

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/Aymanethemaster/zephyr.git
cd zephyr
```

### 2. Set Up Virtual Environment (Recommended)

```bash
# On macOS / Linux
python3 -m venv venv
source venv/bin/activate

# On Windows
python -m venv venv
venv\Scripts\activate
```

### 3. Install Dependencies

```bash
pip install -r requirements.txt
```

### 4. Run the Application

```bash
python app.py
```

Visit **[http://127.0.0.1:5000](http://127.0.0.1:5000)** in your web browser.

---

## 📁 Project Structure

```
zephyr/
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI automated testing pipeline
├── app.py                      # Flask backend proxy with in-memory TTL caching
├── index.html                  # Semantic HTML5 SPA layout
├── requirements.txt            # Minimal dependencies (Flask, Requests, Gunicorn)
├── Procfile                    # Production PaaS process file (Render/Railway/Heroku)
├── vercel.json                 # Vercel deployment configuration
├── .gitignore                  # Git ignore rules
├── LICENSE                     # MIT License
├── README.md                   # Project documentation
└── static/
    ├── css/
    │   └── style.css           # Glassmorphism design system & responsive tokens
    ├── icons/                  # 122 animated Meteocons 2.0.0 vector SVGs
    ├── manifest.json           # Progressive Web App (PWA) manifest
    └── js/
        ├── app.js              # Application controller, DOM & state manager
        ├── weather-api.js      # Backend API client with timeout protection
        └── utils.js            # WMO weather code dictionary, Meteocon mapping & math helpers
```

---

## 🛠️ Architecture & Tech Stack

```
   ┌────────────────────────────────────────────────────────┐
   │                    Client Browser                      │
   │  Vanilla ES6+ JS • CSS3 Glassmorphism • Meteocons SVGs │
   └───────────────────────────┬────────────────────────────┘
                               │ HTTP / JSON
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │                  Flask Backend (app.py)                │
   │  In-Memory TTL Cache • Rate-Limit Guard • Dual-Geocoder│
   └─────────────┬───────────────────────────┬──────────────┘
                 │                           │
                 ▼                           ▼
   ┌───────────────────────────┐ ┌───────────────────────────┐
   │     Open-Meteo APIs       │ │ OpenStreetMap Photon /    │
   │ Forecast • Geocoding • AQI│ │ BigDataCloud Reverse Geo │
   └───────────────────────────┘ └───────────────────────────┘
```

- **Backend**: Python 3.10+ & Flask 3.0+
- **Frontend**: Vanilla ES6 JavaScript (Zero npm dependencies / Zero build tool overhead)
- **Styling**: Pure Vanilla CSS with CSS Custom Properties, flexbox/grid, and backdrop-filter glassmorphism
- **Weather Engine**: [Open-Meteo](https://open-meteo.com/) (Forecast, Geocoding, Air Quality)
- **Reverse Geocoding**: [BigDataCloud](https://www.bigdatacloud.com/)
- **Fuzzy Search Fallback**: [Photon (OpenStreetMap)](https://photon.komoot.io/)
- **Icons**: [Meteocons 2.0.0](https://bas.dev/work/meteocons) by Bas Milius (MIT License)

---

## 📡 API Reference

The Flask backend provides clean, sanitized JSON proxy routes with automatic TTL caching:

| Endpoint                   | Parameters               | Description                                                  | Cache TTL  |
| :------------------------- | :----------------------- | :----------------------------------------------------------- | :--------- |
| `GET /api/geocoding`       | `q` _(string)_           | Searches cities worldwide with typo & multilingual fallback  | 1 hour     |
| `GET /api/reverse-geocode` | `lat`, `lon` _(float)_   | Resolves coordinates to city, region, and country name       | 1 hour     |
| `GET /api/weather`         | `lat`, `lon`, `timezone` | Fetches current conditions, 24-hr hourly, and 8-day forecast | 10 minutes |
| `GET /api/air-quality`     | `lat`, `lon`             | Returns US AQI, European AQI, PM2.5, PM10, and ozone         | 15 minutes |
| `GET /api/health`          | —                        | Health check service status                                  | None       |

---

## 🚢 Deployment

### Deploy to Vercel (Recommended — 100% Free & No Credit Card Required)

1. Push your repository to GitHub: `https://github.com/Aymanethemaster/zephyr`.
2. Go to **[vercel.com](https://vercel.com/)** and click **Continue with GitHub** (No credit card required).
3. Click **Add New...** ➔ **Project** ➔ Import your `zephyr` repository.
4. Click **Deploy** — Vercel reads `vercel.json` and goes live in ~30 seconds with a free global HTTPS domain.

---

### Deploy to PythonAnywhere (100% Free & No Credit Card Required)

1. Create a free account at **[pythonanywhere.com](https://www.pythonanywhere.com/)**.
2. Open a **Bash Console** and run:
   ```bash
   git clone https://github.com/Aymanethemaster/zephyr.git
   cd zephyr
   pip install -r requirements.txt
   ```
3. Go to the **Web** tab ➔ **Add a new web app** ➔ Select **Flask (Python 3.10+)** and point the WSGI file to `app.py`.

---

### Deploy with Docker

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
```

---

## 👨‍💻 Author

Crafted by **[@Aymanethemaster](https://github.com/Aymanethemaster)**

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — free to use, modify, and distribute for personal and commercial projects.

### Acknowledgements

- Meteorological data provided by [Open-Meteo](https://open-meteo.com/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Reverse geocoding provided by [BigDataCloud](https://www.bigdatacloud.com/).
- Animated weather icons by [Bas Milius (Meteocons)](https://github.com/basmilius/weather-icons) under the MIT License.
