# Zephyr

A real-time weather web application built with Python (Flask) and vanilla HTML, CSS, and JavaScript. No API keys required.

## Features

- Current conditions, 24-hour hourly forecast, and 7-day daily forecast
- Automatic location detection (GPS and IP) and city search
- Atmospheric metrics: UV index, wind speed, humidity, pressure, and air quality
- Offline caching and PWA support
- Temperature unit switching (Celsius and Fahrenheit)
- Saved favorite locations and search history

## Quickstart

### Prerequisites

- Python 3.10+
- pip

### Installation

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

## Testing

Run tests with pytest:

```bash
pip install -r requirements-dev.txt
python -m pytest
```

## License

MIT License. See [LICENSE](LICENSE) for details.
