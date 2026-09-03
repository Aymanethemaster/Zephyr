# Zephyr
#### Video Demo: https://youtu.be/WSgSxj3xZZM
#### Description:

Zephyr is a real-time weather web application built with Python (Flask) and vanilla HTML, CSS, and JavaScript. It provides accurate weather forecasts and atmospheric metrics using public data services, requiring no API keys or accounts.

### Features

- Real-time weather conditions, 24-hour hourly forecast, and 7-day daily forecast
- Automatic location detection via GPS and IP address, plus global city search
- Atmospheric metrics: UV index, wind speed, humidity, pressure, and air quality
- Offline support and asset caching via Service Worker (PWA)
- Unit switching between Celsius and Fahrenheit
- Saved favorite locations and search history

### Project Files

- `app.py`: Flask backend providing API proxy routes, caching, rate limiting, and security headers.
- `index.html`: Main HTML5 document defining the layout, cards, and accessible controls.
- `sw.js`: Service worker enabling offline caching and PWA functionality.
- `static/css/style.css`: Stylesheet implementing the dark glassmorphism theme and responsive design.
- `static/js/app.js`: Main JavaScript logic managing application state, user events, and UI rendering.
- `static/js/weather-api.js`: Client API module that handles data fetching with automatic fallback.
- `static/js/utils.js`: Helper utilities for weather codes, unit conversions, and calculations.
- `tests/test_app.py`: Automated test suite covering backend routes, caching, and rate limiting.

### Getting Started

#### Prerequisites

- Python 3.10+
- pip

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

3. Run the application:
   ```bash
   python app.py
   ```

4. Open `http://127.0.0.1:5000` in your browser.

#### Running Tests

```bash
pip install -r requirements-dev.txt
python -m pytest
```

### License

MIT License. See [LICENSE](LICENSE) for details.
