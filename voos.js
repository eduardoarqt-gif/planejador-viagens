/* Acompanhamento de voos (v62): status, atraso, portão, terminal e esteira de bagagem.
   Fonte: AeroDataBox (via RapidAPI ou API.Market). Os dois aceitam chamada direto do navegador (CORS liberado).
   A chave fica só neste aparelho (localStorage). Sem chave, o app funciona normalmente e só não mostra o status ao vivo. */

const KEY = "planejador-voos";
const PROVIDERS = {
  rapidapi: { label: "RapidAPI", base: "https://aerodatabox.p.rapidapi.com", headers: k => ({ "X-RapidAPI-Key": k, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" }) },
  market: { label: "API.Market", base: "https://prod.api.market/api/v1/aedbx/aerodatabox", headers: k => ({ "x-api-market-key": k }) }
};

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function flightCfg() {
  try { const c = JSON.parse(store()?.getItem(KEY) || "null"); return c && c.key && PROVIDERS[c.provider] ? c : null; } catch { return null; }
}
export function setFlightCfg(provider, key) {
  const s = store(); if (!s) return;
  const k = String(key || "").trim();
  if (!k) s.removeItem(KEY); else s.setItem(KEY, JSON.stringify({ provider: PROVIDERS[provider] ? provider : "rapidapi", key: k }));
}
export const providerLabel = p => PROVIDERS[p]?.label || "";

/** "la 3000" → "LA3000". Devolve "" se não parecer um número de voo. */
export function cleanFlightNo(text) {
  const s = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(s) ? s : "";
}

const pad = n => String(n).padStart(2, "0");
/** Aceita {utc, local} (formato novo) ou texto; devolve { hm, date, ms }. */
function parseTime(t) {
  if (!t) return null;
  const local = typeof t === "string" ? t : t.local || "";
  const utc = typeof t === "string" ? t : t.utc || "";
  const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(local || utc);
  const ms = Date.parse(String(utc || local).replace(" ", "T"));
  return m ? { hm: `${m[2]}:${m[3]}`, date: m[1], ms: Number.isNaN(ms) ? null : ms } : null;
}
const pick = (o, ...names) => { for (const n of names) if (o?.[n] != null && o[n] !== "") return o[n]; return undefined; };
const minsBetween = (a, b) => (a?.ms != null && b?.ms != null ? Math.round((b.ms - a.ms) / 60000) : null);

function side(s = {}) {
  const sched = parseTime(pick(s, "scheduledTime") ?? (s.scheduledTimeLocal || s.scheduledTimeUtc ? { local: s.scheduledTimeLocal, utc: s.scheduledTimeUtc } : null));
  const rev = parseTime(pick(s, "revisedTime", "predictedTime") ?? (s.revisedTimeLocal || s.revisedTimeUtc ? { local: s.revisedTimeLocal, utc: s.revisedTimeUtc } : null));
  const runway = parseTime(pick(s, "runwayTime") ?? (s.runwayTimeLocal || s.runwayTimeUtc ? { local: s.runwayTimeLocal, utc: s.runwayTimeUtc } : null));
  const real = rev || runway;
  const delay = sched && real ? minsBetween(sched, real) : null;
  const ap = s.airport || {};
  return {
    iata: ap.iata || "", city: ap.municipalityName || ap.shortName || ap.name || "",
    sched: sched?.hm || "", date: sched?.date || "", real: real && real.hm !== sched?.hm ? real.hm : "", delay,
    terminal: String(s.terminal || "").trim(), gate: String(s.gate || "").trim(),
    checkin: String(s.checkInDesk || "").trim(), belt: String(s.baggageBelt || "").trim()
  };
}

/** Escolhe, entre os resultados da API, o voo que sai no dia pedido (voos com código compartilhado repetem). */
export function normalizeFlight(raw, dateISO) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!list.length) return null;
  const f = list.find(x => side(x.departure).date === dateISO && x.codeshareStatus !== "IsCodeshared") || list.find(x => side(x.departure).date === dateISO) || list[0];
  return {
    no: String(f.number || "").replace(/\s+/g, ""), airline: f.airline?.name || "", status: f.status || "Unknown",
    dep: side(f.departure), arr: side(f.arrival), fetchedAt: Date.now()
  };
}

const STATUS = {
  Expected: ["ok", "No horário"], CheckIn: ["ok", "Check-in aberto"], Boarding: ["info", "Embarcando"], GateClosed: ["warn", "Portão fechado"],
  Departed: ["info", "Decolou"], EnRoute: ["info", "Em voo"], Approaching: ["info", "Chegando"], Arrived: ["ok", "Pousou"],
  Delayed: ["warn", "Atrasado"], Canceled: ["bad", "Cancelado"], CanceledUncertain: ["bad", "Possível cancelamento"], Diverted: ["bad", "Desviado"], Unknown: ["muted", "Sem informação"]
};

/** Resumo pronto para mostrar: rótulo, tom (ok/info/warn/bad/muted), atraso e se merece alerta. */
export function flightView(live) {
  if (!live || live.error) return null;
  const [tone0, label0] = STATUS[live.status] || STATUS.Unknown;
  const delay = live.dep.delay;
  const late = delay != null && delay >= 15 && ["Expected", "CheckIn", "Delayed", "Unknown"].includes(live.status);
  const tone = live.status === "Canceled" || live.status === "CanceledUncertain" || live.status === "Diverted" ? "bad" : late || live.status === "Delayed" ? "warn" : tone0;
  const label = late ? `Atrasado ${delay} min` : label0;
  const alert = tone === "bad" || tone === "warn" || ["Boarding", "GateClosed"].includes(live.status);
  return { tone, label, delay, alert };
}

export class FlightError extends Error { constructor(code, detail = "") { super(code); this.detail = detail; } }

export async function fetchFlight(flightNo, dateISO, cfg = flightCfg()) {
  const no = cleanFlightNo(flightNo);
  if (!cfg) throw new FlightError("chave");
  if (!no) throw new FlightError("numero");
  const p = PROVIDERS[cfg.provider];
  let res;
  try { res = await fetch(`${p.base}/flights/number/${no}/${dateISO}`, { headers: p.headers(cfg.key) }); }
  catch { throw new FlightError("rede"); }
  if (res.status === 401 || res.status === 403) throw new FlightError("chave", await res.text().catch(() => ""));
  if (res.status === 429) throw new FlightError("limite");
  if (res.status === 204 || res.status === 404) throw new FlightError("nao_encontrado");
  if (!res.ok) throw new FlightError("erro", `HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const flight = normalizeFlight(data, dateISO);
  if (!flight) throw new FlightError("nao_encontrado");
  return flight;
}

export const FLIGHT_ERRORS = {
  chave: "A chave não foi aceita. Confira o guia e cole de novo.", numero: "Número de voo inválido (ex.: LA3000).",
  rede: "Sem internet agora.", limite: "Limite de consultas do plano grátis atingido neste mês.",
  nao_encontrado: "Voo não encontrado para esta data (a API só conhece voos próximos; tente mais perto da viagem).", erro: "A consulta falhou."
};

/** Deve atualizar sozinho ao abrir o app? Só voos de ontem até daqui a 3 dias; a cada 30 min (perto) ou 6 h (mais longe). */
export function needsAuto(live, key, daysAway, now = Date.now()) {
  if (daysAway < -1 || daysAway > 3) return false;
  if (!live || live.key !== key) return true;
  if (live.status === "Arrived" || live.status === "Canceled") return false;
  const ttl = daysAway <= 1 ? 30 * 60000 : 6 * 3600000;
  return now - (live.fetchedAt || 0) > ttl;
}

export const legKey = (no, date) => `${cleanFlightNo(no)}|${date || ""}`;
export const fmtDelay = m => (m == null || m === 0 ? "" : `${m > 0 ? "+" : ""}${m} min`);
export { pad };
