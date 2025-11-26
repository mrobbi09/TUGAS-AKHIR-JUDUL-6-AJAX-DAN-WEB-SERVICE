// KONFIGURASI URL (Tanpa API Key!)
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

// DOM ELEMENTS
const cityInput = document.getElementById('city-input');
const searchBtn = document.getElementById('search-btn');
const locationBtn = document.getElementById('location-btn');
const weatherContent = document.getElementById('weather-content');
const loader = document.getElementById('loader');
const themeToggle = document.getElementById('theme-toggle');
const unitToggle = document.getElementById('unit-toggle');
const refreshBtn = document.getElementById('refresh-btn');
const favBtn = document.getElementById('save-favorite-btn');
const favList = document.getElementById('favorites-list');
const suggestionsList = document.getElementById('city-suggestions');

// STATE
let currentCity = 'Yogyakarta'; // Default city
let currentLat = -7.797068;     // Default Lat
let currentLon = 110.370529;    // Default Lon
let isMetric = true; // true = Celsius, false = Fahrenheit
let autoUpdateInterval;

// --- EVENT LISTENERS ---
window.addEventListener('load', () => {
    loadTheme();
    loadFavorites();
    fetchWeatherData(currentLat, currentLon, currentCity);
    startAutoUpdate();
});

searchBtn.addEventListener('click', handleSearch);
cityInput.addEventListener('keypress', (e) => {
    if(e.key === 'Enter') handleSearch();
});

// Auto-complete suggestion (Debounce simple)
let timeoutId;
cityInput.addEventListener('input', () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(async () => {
        const query = cityInput.value;
        if (query.length > 2) {
            const suggestions = await getCitySuggestions(query);
            renderSuggestions(suggestions);
        }
    }, 500);
});

locationBtn.addEventListener('click', () => {
    if(navigator.geolocation) {
        showLoader(true);
        navigator.geolocation.getCurrentPosition(position => {
            const { latitude, longitude } = position.coords;
            // Reverse geocoding opsional, kita set nama sementara "Lokasi Saya"
            fetchWeatherData(latitude, longitude, "Lokasi Saya");
        }, () => {
            alert('Izin lokasi ditolak. Pastikan GPS aktif.');
            showLoader(false);
        });
    }
});

themeToggle.addEventListener('click', toggleTheme);
unitToggle.addEventListener('click', toggleUnits);
refreshBtn.addEventListener('click', () => fetchWeatherData(currentLat, currentLon, currentCity));
favBtn.addEventListener('click', toggleFavorite);

// --- MAIN FUNCTIONS ---

// 1. Handle Search (Geocoding first)
async function handleSearch() {
    const city = cityInput.value;
    if(!city) return;

    showLoader(true);
    try {
        // Fetch Lat/Lon dari nama kota
        const res = await fetch(`${GEO_URL}?name=${city}&count=1&language=id&format=json`);
        const data = await res.json();

        if(!data.results || data.results.length === 0) {
            throw new Error('Kota tidak ditemukan!');
        }

        const result = data.results[0];
        currentCity = result.name;
        currentLat = result.latitude;
        currentLon = result.longitude;

        await fetchWeatherData(currentLat, currentLon, currentCity);
        cityInput.value = ''; // Reset input
    } catch (error) {
        alert(error.message);
        showLoader(false);
    }
}

// 2. Fetch Weather Data (Open-Meteo)
async function fetchWeatherData(lat, lon, cityName) {
    showLoader(true);
    try {
        const unitParam = isMetric ? '' : '&temperature_unit=fahrenheit&windspeed_unit=mph';
        
        // Request Current Weather & Daily Forecast
        const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto${unitParam}`;
        
        const res = await fetch(url);
        const data = await res.json();

        // Tambahan data detail (humidity tidak ada di current_weather default open-meteo, perlu hourly)
        // Kita fetch terpisah atau ambil estimasi, tapi biar simpel kita fetch hourly untuk current hour
        const detailRes = await fetch(`${WEATHER_URL}?latitude=${lat}&longitude=${lon}&hourly=relativehumidity_2m&timezone=auto`);
        const detailData = await detailRes.json();
        const currentHour = new Date().getHours();
        const humidity = detailData.hourly.relativehumidity_2m[currentHour] || 60;

        updateCurrentUI(data, humidity, cityName);
        updateForecastUI(data.daily);
        updateFavoriteIcon(cityName);

    } catch (error) {
        console.error(error);
        alert('Gagal mengambil data cuaca.');
    } finally {
        showLoader(false);
    }
}

// 3. Helper: Get City Suggestions
async function getCitySuggestions(query) {
    try {
        const res = await fetch(`${GEO_URL}?name=${query}&count=5&language=id&format=json`);
        const data = await res.json();
        return data.results || [];
    } catch (e) { return []; }
}

function renderSuggestions(list) {
    suggestionsList.innerHTML = '';
    list.forEach(city => {
        const option = document.createElement('option');
        option.value = city.name;
        option.textContent = `${city.name}, ${city.country}`;
        suggestionsList.appendChild(option);
    });
}

// 4. UI Updates
function updateCurrentUI(data, humidity, cityName) {
    const current = data.current_weather;
    
    document.getElementById('city-name').textContent = cityName;
    document.getElementById('current-date').textContent = new Date().toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute:'2-digit' });
    
    document.getElementById('current-temp').textContent = `${Math.round(current.temperature)}${isMetric ? '°C' : '°F'}`;
    document.getElementById('wind-speed').textContent = `${current.windspeed} ${isMetric ? 'km/h' : 'mph'}`;
    document.getElementById('humidity').textContent = `${humidity}%`;

    // Mapping WMO Code to Icon & Desc
    const wmo = getWmoInfo(current.weathercode);
    document.getElementById('weather-desc').textContent = wmo.desc;
    
    // Update Icon Class (FontAwesome)
    const iconElem = document.getElementById('weather-icon');
    iconElem.className = `fa-solid ${wmo.icon}`;
    
    // Warnanya bisa diatur dinamis kalau mau
    iconElem.style.color = wmo.color;

    document.getElementById('last-updated').textContent = new Date().toLocaleTimeString('id-ID');
    weatherContent.classList.remove('hidden');
}

function updateForecastUI(daily) {
    const forecastContainer = document.getElementById('forecast-container');
    forecastContainer.innerHTML = '';

    // Open-Meteo returns arrays for daily data
    // Loop 5 hari (indeks 1 sampai 5, karena 0 adalah hari ini)
    for(let i = 1; i <= 5; i++) {
        if(!daily.time[i]) break;

        const date = new Date(daily.time[i]);
        const dayName = date.toLocaleDateString('id-ID', { weekday: 'short' });
        const dateNum = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
        const wmo = getWmoInfo(daily.weathercode[i]);
        
        const maxTemp = Math.round(daily.temperature_2m_max[i]);
        const minTemp = Math.round(daily.temperature_2m_min[i]);

        const card = document.createElement('div');
        card.classList.add('forecast-card');
        card.innerHTML = `
            <p style="font-weight:bold">${dayName}</p>
            <small>${dateNum}</small>
            <i class="fa-solid ${wmo.icon}" style="font-size:2rem; margin:10px 0; color:${wmo.color}"></i>
            <p style="font-weight:bold">${maxTemp}° / ${minTemp}°</p>
            <small>${wmo.desc}</small>
        `;
        forecastContainer.appendChild(card);
    }
}

// 5. Utility: WMO Code Interpreter (PENTING!)
function getWmoInfo(code) {
    // Open-Meteo menggunakan kode WMO. Kita mapping ke Icon & Warna.
    // 0: Clear, 1-3: Cloudy, 45-48: Fog, 51-67: Drizzle/Rain, 71-77: Snow, 95-99: Thunderstorm
    if (code === 0) return { icon: 'fa-sun', desc: 'Cerah', color: '#f1c40f' };
    if (code >= 1 && code <= 3) return { icon: 'fa-cloud-sun', desc: 'Berawan', color: '#ecf0f1' };
    if (code >= 45 && code <= 48) return { icon: 'fa-smog', desc: 'Berkabut', color: '#95a5a6' };
    if (code >= 51 && code <= 67) return { icon: 'fa-cloud-rain', desc: 'Hujan', color: '#3498db' };
    if (code >= 71 && code <= 77) return { icon: 'fa-snowflake', desc: 'Salju', color: '#ecf0f1' };
    if (code >= 80 && code <= 82) return { icon: 'fa-cloud-showers-heavy', desc: 'Hujan Lebat', color: '#2980b9' };
    if (code >= 95) return { icon: 'fa-bolt', desc: 'Badai Petir', color: '#f39c12' };
    
    return { icon: 'fa-cloud', desc: 'Mendung', color: '#bdc3c7' };
}

function showLoader(show) {
    if(show) {
        loader.classList.remove('hidden');
        weatherContent.classList.add('hidden');
    } else {
        loader.classList.add('hidden');
        weatherContent.classList.remove('hidden');
    }
}

// 6. Features Toggle
function toggleUnits() {
    isMetric = !isMetric;
    unitToggle.textContent = isMetric ? '°C / °F' : '°F / °C';
    fetchWeatherData(currentLat, currentLon, currentCity);
}

function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    themeToggle.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function loadTheme() {
    if(localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-theme');
        themeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
}

// 7. Favorites System
function toggleFavorite() {
    let favorites = JSON.parse(localStorage.getItem('favCoords')) || [];
    // Cek apakah kota sudah ada (berdasarkan nama)
    const exists = favorites.some(f => f.name === currentCity);
    
    if(exists) {
        favorites = favorites.filter(f => f.name !== currentCity);
        favBtn.classList.remove('active');
        favBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
    } else {
        favorites.push({ name: currentCity, lat: currentLat, lon: currentLon });
        favBtn.classList.add('active');
        favBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
    }
    localStorage.setItem('favCoords', JSON.stringify(favorites));
    renderFavorites();
}

function updateFavoriteIcon(cityName) {
    let favorites = JSON.parse(localStorage.getItem('favCoords')) || [];
    const exists = favorites.some(f => f.name === cityName);
    if(exists) {
        favBtn.classList.add('active');
        favBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
    } else {
        favBtn.classList.remove('active');
        favBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
    }
}

function renderFavorites() {
    let favorites = JSON.parse(localStorage.getItem('favCoords')) || [];
    favList.innerHTML = '';
    favorites.forEach(city => {
        const span = document.createElement('span');
        span.classList.add('fav-tag');
        span.textContent = city.name;
        // Saat diklik, load berdasarkan koordinat yang disimpan agar akurat
        span.onclick = () => {
            currentCity = city.name;
            currentLat = city.lat;
            currentLon = city.lon;
            fetchWeatherData(city.lat, city.lon, city.name);
        };
        favList.appendChild(span);
    });
}

function loadFavorites() {
    renderFavorites();
}

function startAutoUpdate() {
    if(autoUpdateInterval) clearInterval(autoUpdateInterval);
    autoUpdateInterval = setInterval(() => {
        fetchWeatherData(currentLat, currentLon, currentCity);
        console.log('Auto-updated');
    }, 300000); // 5 menit
}