# Zephyr

A lightweight real-time weather web application built with Python (Flask) and vanilla HTML, CSS, and JavaScript. It uses public weather and geocoding services with no API keys required.

## Features

- Real-time weather, 24-hour hourly forecast, and 7-day daily forecast.
- Automatic location detection via IP address and browser GPS.
- Global city search with typo tolerance and multilingual support.
- Atmospheric metrics: UV index, wind speed/direction, humidity, dew point, pressure, visibility, sunrise/sunset, and air quality index (AQI).
- Offline support and asset caching via Service Worker.
- Unit switching between Celsius (°C) and Fahrenheit (°F).
- Saved favorite locations and search history stored locally.

## Tech Stack

- **Backend**: Python 3.10+, Flask
- **Frontend**: HTML5, Vanilla CSS, Vanilla JavaScript (ES6 Modules)
- **Data Sources**: Open-Meteo, BigDataCloud, OpenStreetMap Photon
- **Icons**: Meteocons 2.0 (SVG)

## Getting Started

### Prerequisites

- Python 3.10 or higher
- pip

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Aymanethemaster/Zephyr.git
   cd Zephyr
   ```

2. Create and activate a virtual environment:
   ```bash
   # Linux / macOS
   python3 -m venv venv
   source venv/bin/activate

   # Windows
   python -m venv venv
   venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Start the server:
   ```bash
   python app.py
   ```

5. Open http://127.0.0.1:5000 in your browser.

## Testing

Install test dependencies and run pytest:

```bash
pip install -r requirements-dev.txt
pytest tests/ -v
```

## API Endpoints

| Endpoint | Method | Parameters | Description |
| :--- | :--- | :--- | :--- |
| `/api/ip-location` | GET | None | Resolves client IP to location and coordinates |
| `/api/geocoding` | GET | `q` | Searches cities by name |
| `/api/reverse-geocode` | GET | `lat`, `lon` | Resolves coordinates to city and region |
| `/api/weather` | GET | `lat`, `lon`, `timezone` | Fetches weather forecast data |
| `/api/air-quality` | GET | `lat`, `lon` | Fetches air quality data |
| `/api/health` | GET | None | Health check endpoint |

## License

MIT License. See [LICENSE](LICENSE) for details.
