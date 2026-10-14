/* Serviços externos gratuitos e sem chave: geocodificação, clima, câmbio e busca de locais. */
const TTL = 6 * 3600e3;
const cacheGet = key => { try { const v = JSON.parse(localStorage.getItem(key)); if (v && Date.now() - v.t < TTL) return v.d; } catch { /* sem cache */ } return null; };
const cacheSet = (key, d) => { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* cheio */ } };
const getJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); };

export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const todayISO = () => iso(new Date());
export const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
export const diffDays = (a, b) => Math.round((new Date(`${a}T12:00:00`) - new Date(`${b}T12:00:00`)) / 864e5);

/* cidade -> coordenadas (cache permanente) */
const plain = x => (x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
/* `country` desambigua cidades homônimas (ex.: Pipa, no Brasil, não é uma cidade da China). */
export async function geocodeCity(name, country = "") {
  const key = `geo2:${plain(name)}|${plain(country)}`;
  try { const c = JSON.parse(localStorage.getItem(key)); if (c) return c; } catch { /* segue */ }
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=pt`);
  const list = data.results || [];
  const want = plain(country);
  let hit = want ? list.find(h => plain(h.country) === want || plain(h.country).includes(want) || want.includes(plain(h.country))) : list[0];
  let geo = null;
  if (hit) geo = { lat: hit.latitude, lon: hit.longitude, country: hit.country || "" };
  else if (want) {
    /* a base de cidades não tem o lugar nesse país: tenta busca de lugares (praias, bairros, vilas) */
    const r = (await searchPlaces(name, country).catch(() => []))[0];
    if (r) geo = { lat: r.lat, lon: r.lon, country };
  }
  if (!geo && !want && list[0]) geo = { lat: list[0].latitude, lon: list[0].longitude, country: list[0].country || "" };
  if (!geo) return null;
  try { localStorage.setItem(key, JSON.stringify(geo)); } catch { /* ignora */ }
  return geo;
}

export function weatherIcon(code, rain) {
  if (code == null) return rain >= 60 ? "🌧️" : rain >= 40 ? "🌦️" : rain >= 20 ? "⛅" : "☀️";
  if (code === 0) return "☀️";
  if (code <= 2) return "⛅";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌧️";
  if (code <= 86) return "❄️";
  return "⛈️";
}

/** Clima de uma cidade para um intervalo de datas: previsão (até ~15 dias) ou média histórica. */
export async function cityWeather(geo, from, to) {
  const key = `wx:${geo.lat.toFixed(2)},${geo.lon.toFixed(2)}:${from}:${to}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const today = todayISO();
  const horizon = addDays(today, 15);
  const out = {};
  const forecastEnd = to < horizon ? to : horizon;
  const forecastStart = from > today ? from : today;
  if (forecastStart <= forecastEnd) {
    const d = (await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${forecastStart}&end_date=${forecastEnd}`)).daily;
    d.time.forEach((day, i) => {
      out[day] = { tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], rain: d.precipitation_probability_max[i], code: d.weathercode[i], hist: false };
    });
  }
  const histStart = from > horizon ? from : addDays(horizon, 1);
  if (histStart <= to) {
    const days = [];
    for (let day = histStart; day <= to; day = addDays(day, 1)) days.push(day);
    const years = [1, 2, 3];
    const samples = {};
    await Promise.all(years.map(async back => {
      const shift = day => `${Number(day.slice(0, 4)) - back}${day.slice(4)}`;
      try {
        const d = (await getJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${geo.lat}&longitude=${geo.lon}&start_date=${shift(histStart)}&end_date=${shift(to)}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`)).daily;
        d.time.forEach((day, i) => {
          const target = `${Number(day.slice(0, 4)) + back}${day.slice(4)}`;
          (samples[target] ||= []).push({ tmax: d.temperature_2m_max[i], tmin: d.temperature_2m_min[i], wet: d.precipitation_sum[i] >= 1 });
        });
      } catch { /* ano indisponível */ }
    }));
    for (const day of days) {
      const s = samples[day];
      if (!s?.length) continue;
      const avg = k => s.reduce((sum, x) => sum + x[k], 0) / s.length;
      out[day] = { tmax: avg("tmax"), tmin: avg("tmin"), rain: Math.round(100 * s.filter(x => x.wet).length / s.length), code: null, hist: true };
    }
  }
  cacheSet(key, out);
  return out;
}

/* câmbio: quanto vale 1 unidade da moeda em reais */
export async function fxRate(cur) {
  const code = String(cur || "").trim().toUpperCase();
  if (!code || code === "BRL") return 1;
  const key = `fx:${code}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await getJson(`https://open.er-api.com/v6/latest/${code}`);
  const rate = data?.rates?.BRL;
  if (!rate) throw new Error("sem cotação");
  cacheSet(key, rate);
  return rate;
}

/* busca de locais (OpenStreetMap) */
export async function searchPlaces(query, near) {
  const q = near ? `${query}, ${near}` : query;
  const data = await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=pt&q=${encodeURIComponent(q)}`);
  return data.map(r => ({ name: r.name || r.display_name.split(",")[0], label: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }));
}

let leafletPromise = null;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.append(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletPromise = null; reject(new Error("mapa indisponível")); };
    document.head.append(js);
  });
  return leafletPromise;
}
