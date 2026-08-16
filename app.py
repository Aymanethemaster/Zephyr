import os
import time
import logging
import re
from flask import Flask, render_template, request, jsonify
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(
    __name__,
    template_folder=BASE_DIR,
    static_folder=os.path.join(BASE_DIR, "static"),
    static_url_path="/static"
)

# Simple in-memory cache to reduce external latency and respect API fairness
# Structure: { key: (expiry_timestamp, data) }
CACHE = {}
CACHE_TTL_WEATHER = 600       # 10 minutes
CACHE_TTL_GEOCODING = 3600    # 1 hour
CACHE_TTL_AQI = 900           # 15 minutes

def get_from_cache(key: str):
    if key in CACHE:
        expiry, data = CACHE[key]
        if time.time() < expiry:
            return data
        else:
            del CACHE[key]
    return None

def set_to_cache(key: str, data, ttl: int):
    # Periodically prune stale entries if cache gets large
    if len(CACHE) > 500:
        now = time.time()
        stale_keys = [k for k, (exp, _) in CACHE.items() if exp < now]
        for k in stale_keys:
            del CACHE[k]
    CACHE[key] = (time.time() + ttl, data)


def clean_location_name(name_str):
    if not name_str:
        return ""
    first = str(name_str).split("/")[0].split(";")[0].strip()
    latin = re.search(r"^[A-Za-z\u00C0-\u024F0-9\s\-\.\']+", first)
    if latin and len(latin.group(0).strip()) >= 2:
        return latin.group(0).strip()
    return first


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/geocoding")
def geocode():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"results": []})
    
    cache_key = f"geo:{query.lower()}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    results = []
    seen_coords = set()

    # 1. Primary: Open-Meteo Geocoding API (Fast prefix matching)
    try:
        url = "https://geocoding-api.open-meteo.com/v1/search"
        params = {
            "name": query,
            "count": 8,
            "language": "en",
            "format": "json"
        }
        resp = requests.get(url, params=params, timeout=5)
        if resp.ok:
            data = resp.json()
            if "results" in data and isinstance(data["results"], list):
                for item in data["results"]:
                    lat = item.get("latitude")
                    lon = item.get("longitude")
                    coord_key = (round(float(lat), 2), round(float(lon), 2))
                    if coord_key not in seen_coords:
                        seen_coords.add(coord_key)
                        results.append({
                            "id": item.get("id"),
                            "name": item.get("name"),
                            "latitude": lat,
                            "longitude": lon,
                            "country": item.get("country", ""),
                            "country_code": item.get("country_code", ""),
                            "admin1": item.get("admin1", ""),
                            "timezone": item.get("timezone", "auto")
                        })
    except Exception as e:
        logger.warning(f"Open-Meteo geocoding warning for query '{query}': {e}")

    # 2. Secondary / Fuzzy Fallback: Photon (OpenStreetMap multilingual & typo-tolerant)
    if len(results) < 2:
        try:
            p_url = "https://photon.komoot.io/api/"
            p_params = {"q": query, "limit": 8}
            p_headers = {"User-Agent": "ZephyrWeatherApp/1.0"}
            p_resp = requests.get(p_url, params=p_params, headers=p_headers, timeout=4.5)
            if p_resp.ok:
                p_data = p_resp.json()
                for feat in p_data.get("features", []):
                    props = feat.get("properties", {})
                    coords = feat.get("geometry", {}).get("coordinates", [])
                    if len(coords) >= 2:
                        lon = round(float(coords[0]), 4)
                        lat = round(float(coords[1]), 4)
                        coord_key = (round(lat, 2), round(lon, 2))
                        if coord_key not in seen_coords:
                            seen_coords.add(coord_key)
                            raw_name = props.get("name") or props.get("city") or props.get("district") or query
                            raw_country = props.get("country") or ""
                            raw_admin = props.get("state") or props.get("county") or ""
                            results.append({
                                "id": props.get("osm_id") or f"osm_{lat}_{lon}",
                                "name": clean_location_name(raw_name),
                                "latitude": lat,
                                "longitude": lon,
                                "country": clean_location_name(raw_country),
                                "country_code": (props.get("countrycode") or "").upper(),
                                "admin1": clean_location_name(raw_admin),
                                "timezone": "auto"
                            })
        except Exception as e:
            logger.warning(f"Photon fallback geocoding warning for query '{query}': {e}")

    result_payload = {"results": results}
    if results:
        set_to_cache(cache_key, result_payload, CACHE_TTL_GEOCODING)
    return jsonify(result_payload)


@app.route("/api/reverse-geocode")
def reverse_geocode():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Missing coordinates"}), 400

    try:
        lat_f = round(float(lat), 4)
        lon_f = round(float(lon), 4)
    except ValueError:
        return jsonify({"error": "Invalid coordinates format"}), 400

    cache_key = f"revgeo:{round(lat_f, 3)}:{round(lon_f, 3)}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    try:
        # Use BigDataCloud reverse geocode client (free, client-side friendly, no auth)
        url = "https://api.bigdatacloud.net/data/reverse-geocode-client"
        params = {
            "latitude": lat_f,
            "longitude": lon_f,
            "localityLanguage": "en"
        }
        resp = requests.get(url, params=params, timeout=3.5)
        resp.raise_for_status()
        data = resp.json()

        city = data.get("city") or data.get("locality") or data.get("principalSubdivision") or "Current Location"
        country = data.get("countryName") or ""
        country_code = data.get("countryCode") or ""
        admin1 = data.get("principalSubdivision") or ""

        payload = {
            "name": city,
            "admin1": admin1 if admin1 != city else "",
            "country": country,
            "country_code": country_code,
            "latitude": lat_f,
            "longitude": lon_f
        }
        set_to_cache(cache_key, payload, CACHE_TTL_GEOCODING)
        return jsonify(payload)
    except Exception as e:
        logger.warning(f"Reverse geocode fallback for ({lat_f}, {lon_f}): {e}")
        # Fallback payload with coordinates
        return jsonify({
            "name": f"{round(lat_f, 2)}°, {round(lon_f, 2)}°",
            "admin1": "",
            "country": "",
            "country_code": "",
            "latitude": lat_f,
            "longitude": lon_f
        })


@app.route("/api/weather")
def get_weather():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    timezone = request.args.get("timezone", "auto")

    if not lat or not lon:
        return jsonify({"error": "Latitude and longitude are required"}), 400

    try:
        lat_f = round(float(lat), 4)
        lon_f = round(float(lon), 4)
    except ValueError:
        return jsonify({"error": "Invalid coordinates format"}), 400

    cache_key = f"weather:{lat_f}:{lon_f}:{timezone}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    try:
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat_f,
            "longitude": lon_f,
            "current": [
                "temperature_2m",
                "relative_humidity_2m",
                "apparent_temperature",
                "is_day",
                "precipitation",
                "weather_code",
                "cloud_cover",
                "pressure_msl",
                "surface_pressure",
                "wind_speed_10m",
                "wind_direction_10m",
                "wind_gusts_10m",
                "uv_index"
            ],
            "hourly": [
                "temperature_2m",
                "relative_humidity_2m",
                "dew_point_2m",
                "apparent_temperature",
                "precipitation_probability",
                "precipitation",
                "weather_code",
                "pressure_msl",
                "visibility",
                "wind_speed_10m",
                "wind_direction_10m",
                "uv_index",
                "is_day"
            ],
            "daily": [
                "weather_code",
                "temperature_2m_max",
                "temperature_2m_min",
                "apparent_temperature_max",
                "apparent_temperature_min",
                "sunrise",
                "sunset",
                "uv_index_max",
                "precipitation_sum",
                "precipitation_hours",
                "precipitation_probability_max",
                "wind_speed_10m_max"
            ],
            "timezone": timezone,
            "forecast_days": 8
        }

        resp = requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        data = resp.json()

        set_to_cache(cache_key, data, CACHE_TTL_WEATHER)
        return jsonify(data)
    except requests.exceptions.RequestException as e:
        logger.error(f"Open-Meteo forecast API error: {e}")
        return jsonify({"error": "Failed to fetch weather forecast data", "details": str(e)}), 502
    except Exception as e:
        logger.error(f"Unexpected error in get_weather: {e}")
        return jsonify({"error": "Internal server error", "details": str(e)}), 500


@app.route("/api/air-quality")
def get_air_quality():
    lat = request.args.get("lat")
    lon = request.args.get("lon")
    if not lat or not lon:
        return jsonify({"error": "Missing coordinates"}), 400

    try:
        lat_f = round(float(lat), 4)
        lon_f = round(float(lon), 4)
    except ValueError:
        return jsonify({"error": "Invalid coordinates"}), 400

    cache_key = f"aqi:{lat_f}:{lon_f}"
    cached = get_from_cache(cache_key)
    if cached:
        return jsonify(cached)

    try:
        url = "https://air-quality-api.open-meteo.com/v1/air-quality"
        params = {
            "latitude": lat_f,
            "longitude": lon_f,
            "current": [
                "european_aqi",
                "us_aqi",
                "pm10",
                "pm2_5",
                "carbon_monoxide",
                "nitrogen_dioxide",
                "sulphur_dioxide",
                "ozone"
            ]
        }
        resp = requests.get(url, params=params, timeout=6)
        resp.raise_for_status()
        data = resp.json()

        set_to_cache(cache_key, data, CACHE_TTL_AQI)
        return jsonify(data)
    except Exception as e:
        logger.warning(f"Air quality fetch warning for ({lat}, {lon}): {e}")
        return jsonify({"current": {
            "us_aqi": None,
            "pm2_5": None,
            "pm10": None,
            "ozone": None
        }})


@app.route("/api/health")
def health():
    return jsonify({"status": "healthy", "service": "zephyr-weather-app"})


if __name__ == "__main__":
    logger.info("Starting Weather App on http://127.0.0.1:5000 ...")
    app.run(host="0.0.0.0", port=5000, debug=True)
