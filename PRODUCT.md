# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone who wants to check the weather without creating an account, entering an API key, or paying a subscription. General public users on desktop and mobile browsers who value speed, visual quality, and zero friction. No registration, no onboarding gate — open the page and get weather.

## Product Purpose

Zephyr is a free, zero-API-key weather web application that delivers real-time weather data with a rich atmospheric visual experience. It exists to prove that a genuinely useful, beautiful weather tool can be built and run without requiring users or operators to sign up for anything. Success means a visitor gets accurate, actionable weather information within seconds of landing — with an interface worth lingering in.

## Positioning

Zero friction is the non-negotiable differentiator: no API keys for operators, no signup for users, no cost, no ads. Every data source (Open-Meteo forecast, geocoding, air quality; BigDataCloud reverse geocoding) is free and keyless. The app works the moment it loads. Competing weather apps and widgets require tokens, accounts, or paid tiers for the same depth of data Zephyr provides for free.

## Operating Context

- Users arrive from a browser on any device — desktop, tablet, or phone.
- Primary workflow: opens automatically with live user location or search any city → view real-time conditions, 24-hour hourly strip, 7-day forecast, and atmospheric details.
- No login state, no user accounts, no server-side persistence. Client state (unit preference, last location) lives in localStorage.
- Backend is a thin Flask proxy that caches upstream API responses in-memory (weather: 10 min, AQI: 15 min, geocoding: 1 hr) to stay respectful of free-tier rate limits.

## Capabilities and Constraints

**Confirmed capabilities:**
- Automatic geolocation on startup with reverse-geocode city resolution
- Debounced worldwide city search with autocomplete (Open-Meteo Geocoding)
- Current conditions: temperature, feels-like, humidity, wind, weather code, cloud cover, pressure, UV
- 24-hour hourly forecast rendered as animated card strip
- 8-day daily forecast with proportional temperature range bars
- 6 atmospheric metric cards: UV index gauge, wind compass, humidity/dew point, visibility/pressure, solar cycle arc, air quality (US AQI)
- Instant °C/°F unit toggle (no reload)
- Consistent premium dark slate glassmorphism theme with ambient glow
- Meteocons 2.0.0 animated SVG weather icons (MIT licensed)

**Constraints:**
- Must remain zero-API-key and free — this is a binding product commitment.
- Data accuracy and freshness are limited by upstream Open-Meteo availability and the server cache TTLs.
- No offline support or service worker currently.
- No user accounts or server-side data persistence by design.

**Undecided:**
- Whether the vanilla JS / zero-npm-dependency frontend approach is a permanent constraint or a preference open to change.

## Brand Commitments

- **Name:** Zephyr
- **Tagline (from README):** "Zero-API-Key Weather Web App"
- **Typeface:** Inter (Google Fonts)
- **Icon set:** Meteocons 2.0.0 by Bas Milius (MIT license) — 122 production SVGs bundled in `static/icons/`
- **Visual identity:** "Dark Slate Glassmorphism" — translucent glass cards over deep slate gradient backgrounds with ambient glow orbs.

## Evidence on Hand

- Fully functional deployed codebase with all features listed above working end-to-end.
- Complete Meteocons 2.0.0 distribution in `meteocons-2.0.0/` (fill + line sets, design source files).
- No user testimonials, press, analytics, or case studies exist.
- No logo asset beyond the inline Meteocons `overcast-day.svg` used as a brand icon.

## Product Principles

1. **Zero friction above all.** No signup, no keys, no cost. If a feature requires the user to authenticate or the operator to pay, it doesn't ship.
2. **Instant utility.** Weather data must be visible within seconds of page load. Speed is a feature.
3. **Atmospheric craft.** The interface should reflect the weather it's showing — not as decoration, but as context that makes the data more intuitive.
4. **Respect upstream.** Cache aggressively, request conservatively. Free APIs stay free when everyone is a good citizen.
5. **Works everywhere.** Desktop, tablet, phone. Modern browsers, any screen size. No install required.
