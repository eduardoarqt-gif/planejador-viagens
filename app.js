import { parseMoneyExpression, calculateBalances, settle, expenseTotal } from "./core.js?v=31";
import { state, hooks, save, removeItem, setTemplate, replaceAll, normalizeTrip, syncLinkedCosts, BOOKING_CAT, uid, sync, syncToken, setSyncToken, getStatus, getFileBlob, DEFAULT_CHECKLIST } from "./data.js?v=31";
import { geocodeCity, geocodeOptions, cityWeather, weatherIcon, fxRate, searchPlaces, loadLeaflet, todayISO, addDays, diffDays } from "./services.js?v=31";
import { ask, toast, brl, esc, plural, num } from "./ui.js?v=31";

const CATEGORIES = ["Passagens", "Hospedagem", "Transporte", "Alimentação", "Passeios", "Compras", "Seguro", "Chip/Internet", "Câmbio e taxas", "Outros"];
const CAT_ICON = { Passagens: "✈️", Hospedagem: "🛏️", Transporte: "🚗", Alimentação: "🍽️", Passeios: "🎟️", Compras: "🛍️", Seguro: "🛡️", "Chip/Internet": "📶", "Câmbio e taxas": "💱", Outros: "•" };
const COST_STATUS = ["A orçar", "Estimado", "Reservado", "Pago"];
const ITEM_KINDS = [
  ["✈️ Passagem aérea", { type: "Voo" }], ["🛏️ Hospedagem", { type: "Hotel" }], ["🚗 Aluguel de carro", { type: "Carro" }],
  ["🚐 Transfer / transporte", { type: "Transfer" }], ["🎟️ Passeio / ingresso", { type: "Ingresso" }], ["🛡️ Seguro viagem", { type: "Seguro" }],
  ["💰 Outro custo (alimentação, compras, chip…)", null]
];
const CAT_BOOKING = { Passagens: "Voo", Hospedagem: "Hotel", Transporte: "Carro", Passeios: "Ingresso", Seguro: "Seguro" };
const CURRENCIES = ["BRL", "USD", "EUR", "GBP", "ARS", "CLP", "UYU", "PYG", "COP", "PEN", "MXN", "CAD", "AUD", "CHF", "JPY", "CNY", "THB", "SGD", "AED", "TRY", "ZAR"];
const curOptions = cur => (cur && !CURRENCIES.includes(cur) ? [cur, ...CURRENCIES] : CURRENCIES);
const CHECKIN = ["Ainda não", "Aberto", "Feito"];
const BOOKING_TYPES = ["Voo", "Hotel", "Carro", "Transfer", "Ingresso", "Seguro", "Outro"];
const BOOKING_ICON = { Voo: "✈️", Hotel: "🛏️", Carro: "🚗", Transfer: "🚐", Ingresso: "🎟️", Seguro: "🛡️", Outro: "📌" };
const TRIP_STATUS = { desejo: "Lista de desejos", rascunho: "Rascunho", planejada: "Planejada", andamento: "Em andamento", concluida: "Concluída" };
const statusKey = label => Object.entries(TRIP_STATUS).find(([, l]) => l === label)?.[0];

const ui = { tab: "cenarios", scenarioId: null, home: "viagens", tripId: null, hojeDay: null, mapCity: "", mapDay: "" };

/* ---------- consultas ---------- */
const route = () => location.hash.replace(/^#\/?/, "").split("/");
const currentTrip = () => { const r = route(); return r[0] === "t" ? state.trips.find(t => t.id === r[1]) : null; };
const currentDest = () => { const r = route(); return r[0] === "d" ? state.destinations.find(d => d.id === r[1]) : null; };
const chosenScenario = trip => trip.scenarios.find(s => s.id === trip.chosenId) || trip.scenarios[0];
const normName = x => (x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
/** Trecho da rota (cenário escolhido primeiro) que corresponde à cidade. */
const segOfCity = (trip, city) => {
  const order = [chosenScenario(trip), ...trip.scenarios];
  for (const sc of order) { const s = sc.segments.find(x => !x.transit && normName(x.city) === normName(city)); if (s && (s.country || s.lat != null)) return s; }
  return null;
};
/** País de um destino: o do trecho da rota; senão, o padrão da viagem. */
const countryOfCity = (trip, city) => segOfCity(trip, city)?.country || trip.country || "";
/** Países da viagem: padrão + todos os destinos da rota escolhida. */
const tripCountries = trip => [...new Map([
  ...countriesOf(trip.country),
  ...chosenScenario(trip).segments.filter(s => !s.transit && s.country).map(s => s.country.trim())
].filter(Boolean).map(c => [c.toLowerCase(), c])).values()];
async function geoOfCity(trip, city) {
  const s = segOfCity(trip, city);
  if (s && s.lat != null) return { lat: s.lat, lon: s.lon };
  return geocodeCity(city, countryOfCity(trip, city));
}
/** Pergunta qual lugar é (Pipa — RN, Brasil / Pipa — China) e grava país e coordenadas no trecho. */
async function pickPlaceFor(seg) {
  let opts = [];
  try { opts = await geocodeOptions(seg.city); } catch { return; }
  if (!opts.length) return;
  if (opts.length === 1) { Object.assign(seg, { country: opts[0].country, lat: opts[0].lat, lon: opts[0].lon }); return; }
  const labels = [...opts.map(o => o.label), "Nenhum desses / deixar sem país"];
  const v = await ask(`Qual "${seg.city}"?`, [{ name: "p", label: "Escolha o lugar certo", type: "select", options: labels, value: labels[0] }], { confirm: "Usar este" });
  if (!v) return;
  const o = opts[labels.indexOf(v.p)];
  if (o) Object.assign(seg, { country: o.country, lat: o.lat, lon: o.lon });
}
const activeScenario = trip => trip.scenarios.find(s => s.id === ui.scenarioId) || chosenScenario(trip);
const dayISO = (trip, i) => addDays(trip.start, i);
const fmtDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(".", "");
const fmtShort = iso => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");
const fmtMonthYear = iso => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");

function activeDayIndex(trip) {
  if (!trip.start || !["planejada", "andamento"].includes(trip.status)) return null;
  const i = diffDays(todayISO(), trip.start);
  return i >= 0 && i < trip.days ? i : null;
}
const activeTrip = () => state.trips.filter(t => activeDayIndex(t) != null).sort((a, b) => (b.status === "andamento") - (a.status === "andamento"))[0] || null;

/* Passagem é sempre valor por pessoa (viagens concluídas mantêm o que foi lançado na época). */
const isPerPerson = (cost, trip) => !!cost.perPerson || (cost.cat === "Passagens" && trip.status !== "concluida");
function costBrl(cost, trip) { return cost.amount * (cost.rate || 1) * (isPerPerson(cost, trip) ? trip.travelers.length : 1); }
function scenarioStats(sc, trip) {
  const total = sc.costs.reduce((s, c) => s + costBrl(c, trip), 0);
  const used = sc.segments.reduce((s, x) => s + x.days, 0);
  const cities = sc.segments.filter(s => !s.transit);
  return {
    total, used, days: trip.lockPeriod ? trip.days : (used || trip.days), free: trip.lockPeriod ? trip.days - used : 0, cities: cities.length,
    transitDays: sc.segments.filter(s => s.transit).reduce((s, x) => s + x.days, 0),
    hotelChanges: Math.max(0, cities.length - 1),
    perPerson: total / Math.max(1, trip.travelers.length),
    perDay: total / Math.max(1, trip.lockPeriod ? trip.days : (used || trip.days)),
    committed: sc.costs.filter(c => c.status !== "Estimado" && c.status !== "A orçar").reduce((s, c) => s + costBrl(c, trip), 0)
  };
}
function dayList(trip) {
  const sc = chosenScenario(trip);
  const days = [];
  for (const seg of sc.segments) for (let i = 0; i < seg.days; i += 1) days.push({ city: seg.city, transit: !!seg.transit });
  while (days.length < trip.days) days.push({ city: "A definir", transit: false });
  return days.slice(0, Math.max(trip.days, 1));
}
function bookingsForDay(trip, i) {
  if (!trip.start) return [];
  const d = dayISO(trip, i);
  return trip.bookings.filter(b => b.date && b.date <= d && d <= (b.dateEnd || b.date));
}
function tripCosts(trip) {
  const byCat = {};
  if (trip.pastCosts) Object.entries(trip.pastCosts).forEach(([c, v]) => { if (v > 0) byCat[c] = v; });
  else if (trip.status === "concluida" && trip.expenses.length) trip.expenses.forEach(e => { byCat[e.cat || "Outros"] = (byCat[e.cat || "Outros"] || 0) + expenseTotal(e); });
  else chosenScenario(trip).costs.forEach(c => { byCat[c.cat] = (byCat[c.cat] || 0) + costBrl(c, trip); });
  return { byCat, total: Object.values(byCat).reduce((s, v) => s + v, 0) };
}

/* Destino principal de viagens em planejamento = primeiro destino da rota escolhida (liga ao banco de destinos). */
function syncMainDest(t) {
  if (t.status === "concluida" || !t.scenarios?.length) return;
  const first = chosenScenario(t).segments.find(s => !s.transit && s.city && s.city !== "Destino" && s.city !== "A definir");
  if (first) t.destName = first.city;
}
/* A duração da viagem acompanha a rota do cenário escolhido (cada cenário pode ter duração diferente). */
function syncTripDays(t) {
  if (t.status === "concluida" || !t.scenarios?.length) return;
  if (t.lockPeriod) { if (t.baseStart != null) { t.start = t.baseStart; delete t.baseStart; } return; }
  /* data própria do cenário escolhido vale para a viagem; a data-base é guardada para os outros cenários */
  const own = chosenScenario(t).start;
  if (own) { if (t.baseStart == null) t.baseStart = t.start; t.start = own; }
  else if (t.baseStart != null) { t.start = t.baseStart; delete t.baseStart; }
  const used = chosenScenario(t).segments.reduce((s, x) => s + x.days, 0);
  if (used > 0) t.days = used;
}
const commit = (keepScroll = false) => { state.trips.forEach(t => { syncLinkedCosts(t); syncMainDest(t); syncTripDays(t); }); save(); render(keepScroll); };
state.trips.forEach(syncTripDays);

/* ---------- Home ---------- */
function tripCard(trip) {
  const sc = chosenScenario(trip);
  const st = scenarioStats(sc, trip);
  const cities = sc.segments.filter(s => !s.transit).map(s => s.city).join(" → ");
  const when = trip.start ? `${fmtShort(trip.start)} · ` : "";
  const cost = tripCosts(trip).total;
  return `<a class="trip-card ${trip.status}" href="#/t/${trip.id}" data-trip="${trip.id}">
    <div class="trip-card-top"><span class="pill ${trip.status}">${TRIP_STATUS[trip.status]}</span>${trip.scenarios.length > 1 ? `<span class="muted">${trip.scenarios.length} cenários</span>` : ""}</div>
    <h2>${esc(trip.name)}</h2>
    <p class="muted">${esc(cities || trip.destName || trip.country)}</p>
    <div class="trip-card-foot">
      <div><small>${when}${plural(trip.days, "dia", "dias")} · ${plural(trip.travelers.length, "pessoa", "pessoas")}</small></div>
      <div class="num"><small>${trip.status === "concluida" ? "gasto" : trip.status === "rascunho" || trip.status === "desejo" ? "estimativa" : "orçamento"}</small><strong>${brl(trip.status === "concluida" ? cost : st.total)}</strong></div>
    </div></a>`;
}

function upcomingDeadlines() {
  const today = todayISO();
  const out = [];
  for (const trip of state.trips) {
    if (["concluida", "desejo"].includes(trip.status)) continue;
    for (const b of trip.bookings) {
      if (b.done) continue;
      for (const [date, label] of [[b.freeCancelUntil, "Cancelamento grátis até"], [b.deadline, "Pagamento / prazo"]]) {
        if (!date) continue;
        const left = diffDays(date, today);
        if (left >= -1 && left <= 14) out.push({ trip, b, date, label, left });
      }
    }
  }
  return out.sort((a, b) => a.left - b.left);
}

function renderHome() {
  const act = activeTrip();
  const idx = act ? activeDayIndex(act) : null;
  const activeCard = act ? `<section class="today-card">
      <div class="today-top"><span class="pill chosen">Hoje na viagem</span><span class="wx" data-wx="${idx}"></span></div>
      <h2>${esc(dayList(act)[idx]?.city || act.name)}</h2>
      <p class="muted">${esc(act.name)} · dia ${idx + 1} de ${act.days} · ${fmtDay(dayISO(act, idx))}</p>
      <div class="inline-actions">
        <a class="btn primary" href="#/t/${act.id}" data-open-hoje="${act.id}">Abrir o dia</a>
        <button class="btn soft" data-act="exp-quick" data-trip="${act.id}">+ Despesa</button>
      </div></section>` : "";
  const dl = upcomingDeadlines();
  const deadlines = dl.length ? `<section class="alerts"><h3>Prazos próximos</h3>${dl.slice(0, 5).map(x => `<a href="#/t/${x.trip.id}" data-goto-tab="reservas" class="alert-row ${x.left <= 3 ? "urgent" : ""}"><span><b>${esc(x.b.desc)}</b><small>${x.label} ${fmtShort(x.date)} · ${esc(x.trip.name)}</small></span><b>${x.left <= 0 ? "hoje" : `${x.left} d`}</b></a>`).join("")}</section>` : "";

  const by = s => state.trips.filter(t => s.includes(t.status));
  const order = { andamento: 0, planejada: 1, rascunho: 2 };
  let body = "";
  if (ui.home === "viagens") {
    const list = by(["andamento", "planejada", "rascunho"]).sort((a, b) => order[a.status] - order[b.status] || (a.start || "9").localeCompare(b.start || "9"));
    body = list.map(tripCard).join("") || `<div class="empty big"><div class="empty-art">✈️</div><h2>Nenhuma viagem ainda</h2><p>Comece com um rascunho: monte cenários de rota, compare custos e depois confirme a melhor opção.</p><button class="btn primary" data-act="new-trip">Criar primeira viagem</button></div>`;
  } else if (ui.home === "desejos") {
    const list = by(["desejo"]);
    body = `<p class="muted">Viagens que você quer fazer, ainda sem data. Quando decidir, mude a situação para Rascunho.</p>${list.map(tripCard).join("") || `<div class="empty"><p>Sua lista de desejos está vazia.</p></div>`}`;
  } else if (ui.home === "historico") body = renderHistory();
  else body = renderDestinations();

  const addLabel = { viagens: "+ Nova viagem", desejos: "+ Desejo", historico: "+ Viagem passada", destinos: "+ Destino" }[ui.home];
  const addAct = { viagens: "new-trip", desejos: "new-wish", historico: "new-past", destinos: "dest-add" }[ui.home];
  return `<header class="home-head">
      <div><p class="eyebrow">Dudoo</p><h1>Trips</h1><button class="sync" data-act="sync-setup" data-sync></button></div>
      <button class="btn primary" data-act="${addAct}">${addLabel}</button>
    </header>
    ${activeCard}${deadlines}
    <nav class="seg-tabs">${[["viagens", "Viagens"], ["desejos", "Desejos"], ["historico", "Histórico"], ["destinos", "Destinos"]].map(([id, l]) => `<button class="${ui.home === id ? "active" : ""}" data-home="${id}">${l}</button>`).join("")}</nav>
    <main class="home">${body}</main>
    <footer class="home-foot">
      <button class="link" data-act="sync-setup">Sincronização</button>
      <button class="link" data-act="backup">Exportar backup</button>
      <button class="link" data-act="restore">Importar backup</button>
      <input type="file" id="restoreFile" accept="application/json" hidden>
    </footer>`;
}

/* ---------- Histórico e estatísticas ---------- */
/** Uma viagem pode ter vários países no campo "País", separados por vírgula, ponto e vírgula ou barra. */
const countriesOf = text => [...new Map(String(text || "").split(/\s*[,;\/]\s*/).map(c => c.trim()).filter(Boolean).map(c => [c.toLowerCase(), c])).values()];
function renderHistory() {
  const past = state.trips.filter(t => t.status === "concluida").sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  if (!past.length) return `<div class="empty"><p>Registre as viagens que você já fez para ver países visitados e custos médios.</p></div>`;
  const costs = past.map(t => ({ t, ...tripCosts(t) }));
  const withCost = costs.filter(c => c.total > 0);
  const countries = [...new Map(past.flatMap(t => tripCountries(t)).map(c => [c.toLowerCase(), c])).values()];
  const days = past.reduce((s, t) => s + t.days, 0);
  const avg = (fn) => withCost.length ? withCost.reduce((s, c) => s + fn(c), 0) / withCost.length : 0;
  const perDayAll = withCost.reduce((s, c) => s + c.total, 0) / Math.max(1, withCost.reduce((s, c) => s + c.t.days, 0));
  const count = key => Object.entries(past.reduce((m, t) => { for (const k of [].concat(key(t)).map(x => String(x || "").trim()).filter(Boolean)) m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const catAvg = CATEGORIES.map(cat => {
    const rows = costs.filter(c => c.byCat[cat] > 0);
    return rows.length ? { cat, avg: rows.reduce((s, c) => s + c.byCat[cat], 0) / rows.length, n: rows.length } : null;
  }).filter(Boolean);
  return `<div class="kpi-grid">
      <div class="kpi"><small>Viagens</small><strong>${past.length}</strong></div>
      <div class="kpi"><small>Países</small><strong>${countries.length}</strong></div>
      <div class="kpi"><small>Dias viajados</small><strong>${days}</strong></div>
      <div class="kpi"><small>Custo médio</small><strong>${brl(avg(c => c.total))}</strong></div>
      <div class="kpi"><small>Média por dia</small><strong>${brl(perDayAll)}</strong></div>
      <div class="kpi"><small>Média por pessoa</small><strong>${brl(avg(c => c.total / Math.max(1, c.t.travelers.length)))}</strong></div>
    </div>
    <section class="card"><h2>Onde mais viajei</h2>
      <div class="rank">${count(t => tripCountries(t)).map(([k, n]) => `<div><span>${esc(k)}</span><b>${plural(n, "viagem", "viagens")}</b></div>`).join("") || `<p class="muted">Informe o país em cada viagem.</p>`}</div>
      ${count(t => t.destName).length ? `<h3 class="sub">Destinos</h3><div class="rank">${count(t => t.destName).map(([k, n]) => `<div><span>${esc(k)}</span><b>${n}×</b></div>`).join("")}</div>` : ""}
    </section>
    ${catAvg.length ? `<section class="card"><h2>Média por categoria</h2><div class="rank">${catAvg.map(c => `<div><span>${CAT_ICON[c.cat]} ${c.cat}<small> · ${plural(c.n, "viagem", "viagens")}</small></span><b>${brl(c.avg)}</b></div>`).join("")}</div></section>` : ""}
    <h3 class="sub">Viagens realizadas</h3>
    ${past.map(t => { const c = tripCosts(t); return `<a class="row-link" href="#/t/${t.id}"><div><strong>${esc(t.name)}</strong><small>${[t.country, t.start ? fmtMonthYear(t.start) : "", plural(t.days, "dia", "dias")].filter(Boolean).join(" · ")}${t.wouldRepeat ? " · repetiria" : ""}</small></div><b>${c.total ? brl(c.total) : "—"}</b></a>`; }).join("")}`;
}

/* ---------- Destinos ---------- */
function renderDestinations() {
  const general = state.contacts.filter(c => !c.destId);
  const list = state.destinations.slice().sort((a, b) => a.name.localeCompare(b.name));
  return `<p class="muted">Guarde o que aprendeu sobre cada lugar: vale alugar carro, onde comer, perrengues e contatos.</p>
    ${list.map(d => `<a class="row-link" href="#/d/${d.id}"><div><strong>${esc(d.name)}</strong><small>${esc([d.country, d.repeat ? "repetiria" : ""].filter(Boolean).join(" · "))}</small></div><span>›</span></a>`).join("") || `<div class="empty"><p>Nenhum destino cadastrado.</p></div>`}
    <section class="card"><div class="card-head"><h2>Contatos gerais</h2><button class="btn soft sm" data-act="contact-add" data-dest="">+ Contato</button></div>
      ${general.map(contactRow).join("") || `<p class="muted tiny">Guias, agências e contatos sem destino específico.</p>`}</section>`;
}
const contactRow = c => `<button class="row" data-act="contact-edit" data-id="${c.id}"><div><strong>${esc(c.name)}</strong><small>${esc([c.phone, c.instagram ? `@${c.instagram.replace(/^@/, "")}` : "", c.note].filter(Boolean).join(" · "))}</small></div></button>`;

function renderDestPage(d) {
  const contacts = state.contacts.filter(c => c.destId === d.id);
  const related = state.trips.filter(t => t.destName && t.destName.toLowerCase() === d.name.toLowerCase());
  const sec = (title, act, content) => `<section class="card"><div class="card-head"><h2>${title}</h2><button class="btn soft sm" data-act="${act}" data-id="${d.id}">Editar</button></div>${content}</section>`;
  const val = v => v ? esc(v) : `<span class="muted">—</span>`;
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  return `<header class="trip-head">
      <div class="trip-head-top"><a class="back" href="#/" aria-label="Voltar">‹</a><button class="icon-btn" data-act="dest-menu" data-id="${d.id}" aria-label="Opções">⋯</button></div>
      <h1>${esc(d.name)}</h1><p class="muted">${esc(d.country || "País não informado")}</p>
      <label class="check big"><input type="checkbox" data-act="dest-repeat" data-id="${d.id}" ${d.repeat ? "checked" : ""}><span>Repetiria este destino</span></label>
    </header>
    <main class="tab-body">
      ${sec("Resumo", "dest-edit-summary", `${kv("Minha nota", d.rating != null && d.rating !== "" ? `${String(d.rating).replace(".", ",")} / 10` : val(""))}${kv("Melhor época", val(d.bestSeason))}${kv("Pontos fortes", val(d.pros))}${kv("Pontos fracos", val(d.cons))}${kv("Perrengues", val(d.perrengues))}`)}
      ${sec("Transporte", "dest-edit-transport", `${kv("O que usar", val(d.transport?.use))}${kv("Vale alugar carro?", val(d.transport?.car))}${kv("Tem metrô?", val(d.transport?.metro))}${d.transport?.notes ? kv("Notas", val(d.transport.notes)) : ""}`)}
      <section class="card"><div class="card-head"><h2>Pontos turísticos</h2><button class="btn soft sm" data-act="attr-add" data-id="${d.id}">+ Ponto</button></div>
        ${(d.attractions || []).map(a => `<div class="check-row ${a.visited ? "done" : ""}"><button class="check-btn" data-act="attr-toggle" data-id="${d.id}" data-a="${a.id}" aria-label="Marcar como conhecido">${a.visited ? "✓" : ""}</button><button class="check-text" data-act="attr-edit" data-id="${d.id}" data-a="${a.id}">${esc(a.name)}</button></div>`).join("") || `<p class="muted tiny">O que conhecer. Marque os que você já visitou.</p>`}
      </section>
      <section class="card"><div class="card-head"><h2>Alimentação</h2><button class="btn soft sm" data-act="food-add" data-id="${d.id}">+ Lugar</button></div>
        ${(d.food || []).map(f => `<button class="row" data-act="food-edit" data-id="${d.id}" data-a="${f.id}"><div><strong>${esc(f.name)}</strong><small>${esc(f.note || "")}</small></div></button>`).join("") || `<p class="muted tiny">Restaurantes e pratos para lembrar.</p>`}
      </section>
      ${sec("Hospedagem", "dest-edit-lodging", `${kv("Faixa de preço", val(d.lodging?.range))}${kv("Opções disponíveis", val(d.lodging?.options))}${d.lodging?.notes ? kv("Notas", val(d.lodging.notes)) : ""}`)}
      ${sec("Visto", "dest-edit-visa", `${kv("Precisa?", val(d.visa?.needed))}${kv("Requisitos", val(d.visa?.requirements))}`)}
      <section class="card"><div class="card-head"><h2>Contatos úteis</h2><button class="btn soft sm" data-act="contact-add" data-dest="${d.id}">+ Contato</button></div>
        ${contacts.map(contactRow).join("") || `<p class="muted tiny">Guias, agências locais, telefone e Instagram.</p>`}</section>
      ${related.length ? `<section class="card"><h2>Viagens</h2>${related.map(t => `<a class="row-link" href="#/t/${t.id}"><div><strong>${esc(t.name)}</strong><small>${TRIP_STATUS[t.status]}</small></div><span>›</span></a>`).join("")}</section>` : ""}
    </main>`;
}

/* ---------- Viagem ---------- */
function renderTrip(trip) {
  const sc = activeScenario(trip);
  const official = chosenScenario(trip);
  const st = scenarioStats(official, trip);
  const isActive = activeDayIndex(trip) != null;
  const tabs = [...(isActive ? [["hoje", "Hoje"]] : []), ["cenarios", "Cenários"], ["custos", "Custos"], ["roteiro", "Roteiro"], ["mapa", "Mapa"], ["reservas", "Reservas"], ["despesas", "Despesas"], ["bagagem", "Bagagem"]];
  if (!tabs.some(t => t[0] === ui.tab)) ui.tab = tabs[0][0];
  const content = { hoje: tabHoje, cenarios: tabScenarios, custos: tabCosts, roteiro: tabItinerary, mapa: tabMap, reservas: tabBookings, despesas: tabExpenses, bagagem: tabChecklist }[ui.tab](trip, sc);
  const dateLine = trip.start ? `${fmtDay(dayISO(trip, 0))} → ${fmtDay(dayISO(trip, trip.days - 1))}` : "Sem data definida";
  return `<header class="trip-head">
      <div class="trip-head-top">
        <a class="back" href="#/" aria-label="Voltar">‹</a>
        <button class="icon-btn" data-act="trip-menu" aria-label="Opções da viagem">⋯</button>
      </div>
      <span class="pill ${trip.status}">${TRIP_STATUS[trip.status]}</span>
      <h1>${esc(trip.name)}</h1>
      <p class="muted">${[tripCountries(trip).join(", "), dateLine, plural(trip.days, "dia", "dias"), plural(trip.travelers.length, "pessoa", "pessoas")].filter(Boolean).join(" · ")}</p>
      <div class="kpis">
        <div><small>${trip.scenarios.length > 1 ? `Total · ${esc(official.name)} ✓` : "Total"}</small><strong>${brl(st.total)}</strong></div>
        <div><small>Por pessoa</small><strong>${brl(st.perPerson)}</strong></div>
        <div><small>Por dia</small><strong>${brl(st.perDay)}</strong></div>
      </div>
    </header>
    <nav class="tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" class="${ui.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}</nav>
    <main class="tab-body">${content}</main>
    ${["andamento", "planejada"].includes(trip.status) ? `<button class="fab" data-act="exp-quick" data-trip="${trip.id}" aria-label="Lançar despesa">+ Despesa</button>` : ""}`;
}

/* --- Hoje --- */
function bookingAttachButtons(b) {
  return (b.attachments || []).map(a => `<button class="mini" data-act="open-file" data-id="${a.id}" data-name="${esc(a.name)}" data-type="${esc(a.type || "")}" title="${esc(a.name)}">${(a.type || "").startsWith("image/") ? "🖼️" : "📄"}</button>`).join("");
}
function cancelTag(b) {
  if (!b.freeCancelUntil) return "";
  const left = diffDays(b.freeCancelUntil, todayISO());
  return `<span class="tag ${left < 0 ? "Pago" : left <= 7 ? "Estimado" : "Reservado"}">${left < 0 ? "cancelamento grátis expirou" : `cancela grátis até ${fmtShort(b.freeCancelUntil)}`}</span>`;
}
function dayBody(trip, i) {
  const items = (trip.itinerary[i] || []).slice().sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const places = trip.places.filter(p => p.day === i);
  const res = bookingsForDay(trip, i);
  return `${items.length ? `<ul class="acts">${items.map(a => `<li><button data-act="act-edit" data-day="${i}" data-id="${a.id}">
        <span class="time">${esc(a.time || "—")}</span>
        <span class="act-main"><strong>${esc(a.title)}</strong>${a.note ? `<small>${esc(a.note)}</small>` : ""}</span>
        ${a.cost ? `<span class="act-cost">${brl(a.cost)}</span>` : ""}</button></li>`).join("")}</ul>` : `<p class="muted tiny">Sem atividades.</p>`}
    ${places.length ? `<div class="day-places"><b>Atrações no mapa</b>${places.map((p, n) => `<span>${n + 1}. ${esc(p.name)}</span>`).join("")}</div>` : ""}
    <div class="inline-actions"><button class="btn soft sm" data-act="act-add" data-day="${i}">+ Atividade</button><button class="btn ghost sm" data-act="map-day" data-day="${i}">Mapa do dia</button></div>
    ${res.length ? `<details class="res"><summary>Reservas do dia <span class="count">${res.length}</span></summary>${res.map(b => `<div class="res-row">
        <button class="res-main" data-act="book-edit" data-id="${b.id}"><strong>${BOOKING_ICON[b.type] || "📌"} ${esc(b.desc)}</strong><small>${[b.type, b.locator ? `Localizador ${esc(b.locator)}` : ""].filter(Boolean).join(" · ")}</small>${cancelTag(b)}</button>
        <div class="res-actions">${b.link ? `<a class="mini" href="${esc(b.link)}" target="_blank" rel="noopener" title="Abrir documento">🔗</a>` : ""}${bookingAttachButtons(b)}</div></div>`).join("")}</details>` : ""}`;
}
function tabHoje(trip) {
  const days = dayList(trip);
  const today = activeDayIndex(trip);
  const i = Math.min(days.length - 1, Math.max(0, ui.hojeDay ?? today ?? 0));
  const spent = trip.expenses.filter(e => e.date === dayISO(trip, i)).reduce((s, e) => s + expenseTotal(e), 0);
  const done = trip.checklist.filter(c => c.done).length;
  return `<article class="card day-hero">
      <div class="day-nav"><button class="icon-btn" data-act="hoje-nav" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Dia anterior">‹</button>
        <div class="day-title"><span class="eyebrow">${i === today ? "Hoje" : `Dia ${i + 1}`}</span><h2>${esc(days[i].city)}</h2><small>Dia ${i + 1} de ${trip.days} · ${fmtDay(dayISO(trip, i))}</small></div>
        <button class="icon-btn" data-act="hoje-nav" data-d="1" ${i === days.length - 1 ? "disabled" : ""} aria-label="Próximo dia">›</button></div>
      <div class="wx big" data-wx="${i}"></div>
    </article>
    <article class="card">${dayBody(trip, i)}</article>
    <div class="quick-grid">
      <button class="quick" data-act="exp-quick" data-trip="${trip.id}"><b>${brl(spent)}</b><small>gasto no dia · lançar despesa</small></button>
      <button class="quick" data-tab="bagagem"><b>${done}/${trip.checklist.length}</b><small>itens da bagagem</small></button>
    </div>`;
}

/* --- Cenários --- */
function tabScenarios(trip) {
  const cards = trip.scenarios.map(sc => {
    const st = scenarioStats(sc, trip);
    const chosen = sc.id === trip.chosenId;
    const from = trip.lockPeriod ? trip.start : (sc.start || trip.baseStart || trip.start);
    const dates = from && st.used ? ` · ${fmtShort(from)} → ${fmtShort(addDays(from, st.used - 1))}` : "";
    const note = trip.lockPeriod
      ? (st.free === 0 ? `<span class="ok">✓ ${plural(trip.days, "dia", "dias")} distribuídos</span>` : st.free > 0 ? `<span class="warn">${plural(st.free, "dia livre", "dias livres")}</span>` : `<span class="bad">${plural(-st.free, "dia", "dias")} acima do período</span>`)
      : `<span class="ok">${plural(st.used, "dia", "dias")}${dates}</span>`;
    const bar = sc.segments.map(s => `<i class="${s.transit ? "transit" : ""}" style="flex:${s.days}" title="${esc(s.city)}"></i>`).join("") + (trip.lockPeriod && st.free > 0 ? `<i class="free" style="flex:${st.free}"></i>` : "");
    const rows = sc.segments.map((s, i) => `
      <div class="seg ${s.transit ? "transit" : ""}">
        <button class="seg-name" data-act="seg-edit" data-sc="${sc.id}" data-i="${i}">${s.transit ? "↝ " : ""}${esc(s.city)}</button>
        <div class="stepper">
          <button data-act="seg-days" data-d="-1" data-sc="${sc.id}" data-i="${i}" aria-label="Menos um dia">−</button>
          <span>${plural(s.days, "dia", "dias")}</span>
          <button data-act="seg-days" data-d="1" data-sc="${sc.id}" data-i="${i}" aria-label="Mais um dia">+</button>
        </div>
        <div class="seg-tools">
          <button data-act="seg-move" data-d="-1" data-sc="${sc.id}" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Subir">↑</button>
          <button data-act="seg-move" data-d="1" data-sc="${sc.id}" data-i="${i}" ${i === sc.segments.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button>
          <button data-act="seg-del" data-sc="${sc.id}" data-i="${i}" ${sc.segments.length === 1 ? "disabled" : ""} aria-label="Remover">×</button>
        </div>
      </div>`).join("");
    return `<article class="card scenario ${chosen ? "chosen" : ""}">
      <div class="card-head"><div><h2>${esc(sc.name)}</h2>${note}</div><div class="head-actions"><button class="btn primary sm" data-act="sc-add-item" data-sc="${sc.id}">+ Item</button>${chosen ? `<span class="pill chosen">Escolhido</span>` : ""}</div></div>
      <div class="routebar" aria-hidden="true">${bar}</div>
      <div class="route-text">${sc.segments.map(s => `${esc(s.city)} <b>${s.days}</b>`).join(" · ")}</div>
      <div class="segs">${rows}</div>
      <div class="inline-actions">
        <button class="btn soft sm" data-act="seg-add" data-sc="${sc.id}">+ Destino</button>
        <button class="btn soft sm" data-act="seg-add-transit" data-sc="${sc.id}">+ Deslocamento</button>
      </div>
      <dl class="metrics">
        <div><dt>Total</dt><dd>${brl(st.total)}</dd></div><div><dt>Por pessoa</dt><dd>${brl(st.perPerson)}</dd></div>
        <div><dt>Destinos</dt><dd>${st.cities}</dd></div><div><dt>Trocas de hotel</dt><dd>${st.hotelChanges}</dd></div>
      </dl>
      <div class="card-actions">
        ${chosen ? "" : `<button class="btn primary sm" data-act="sc-choose" data-sc="${sc.id}">Escolher este</button>`}
        <button class="btn ghost sm" data-act="sc-open-costs" data-sc="${sc.id}">Custos</button>
        <button class="btn ghost sm" data-act="sc-dup" data-sc="${sc.id}">Duplicar</button>
        ${trip.lockPeriod ? "" : `<button class="btn ghost sm" data-act="sc-dates" data-sc="${sc.id}">Datas</button>`}
        <button class="btn ghost sm" data-act="sc-rename" data-sc="${sc.id}">Renomear</button>
        ${trip.scenarios.length > 1 ? `<button class="btn ghost sm danger-text" data-act="sc-del" data-sc="${sc.id}">Excluir</button>` : ""}
      </div></article>`;
  }).join("");
  return `<div class="section-head"><p class="muted">Monte rotas diferentes dentro do mesmo período e compare lado a lado.</p><button class="btn soft" data-act="sc-new">+ Novo cenário</button></div>
    <div class="cards">${cards}</div>${trip.scenarios.length > 1 ? renderCompare(trip) : ""}`;
}
function renderCompare(trip) {
  const stats = trip.scenarios.map(sc => ({ sc, st: scenarioStats(sc, trip) }));
  const cheapest = Math.min(...stats.map(x => x.st.total));
  const row = (label, fn, best) => `<tr><th>${label}</th>${stats.map(({ sc, st }) => `<td class="${best && best(st) ? "best" : ""}">${fn(st, sc)}</td>`).join("")}</tr>`;
  return `<section class="card compare"><h2>Comparação</h2><div class="table-scroll"><table>
    <thead><tr><th></th>${stats.map(({ sc }) => `<th>${esc(sc.name)}${sc.id === trip.chosenId ? " ✓" : ""}</th>`).join("")}</tr></thead>
    <tbody>
      ${row("Total", st => brl(st.total), st => st.total === cheapest)}
      ${row("Por pessoa", st => brl(st.perPerson))}${row("Por dia", st => brl(st.perDay))}
      ${row("Destinos", st => st.cities)}${row("Trocas de hotel", st => st.hotelChanges)}
      ${row("Dias em deslocamento", st => st.transitDays)}${row("Duração", st => plural(st.used, "dia", "dias"))}${trip.lockPeriod ? row("Dias sem destino", st => st.free > 0 ? st.free : "—") : ""}${row("Período", (st, sc) => { const f = trip.lockPeriod ? trip.start : (sc.start || trip.baseStart || trip.start); return f && st.used ? `${fmtShort(f)} → ${fmtShort(addDays(f, st.used - 1))}` : "—"; })}
      ${row("Já reservado/pago", st => brl(st.committed))}
    </tbody></table></div></section>`;
}

/* --- Custos --- */
function tabCosts(trip, sc) {
  const st = scenarioStats(sc, trip);
  const picker = trip.scenarios.length > 1 ? `<div class="chips scroll">${trip.scenarios.map(s => `<button class="chip-btn ${s.id === sc.id ? "active" : ""}" data-act="sc-view" data-sc="${s.id}">${esc(s.name)}${s.id === trip.chosenId ? " ✓" : ""}</button>`).join("")}</div>` : "";
  const groups = CATEGORIES.map(cat => {
    const items = sc.costs.filter(c => c.cat === cat);
    if (!items.length) return "";
    return `<section class="group"><div class="group-head"><span>${CAT_ICON[cat]} ${cat}</span><div class="group-total"><strong>${brl(items.reduce((s, c) => s + costBrl(c, trip), 0))}</strong>${trip.travelers.length > 1 ? `<small>${brl(items.reduce((s, c) => s + costBrl(c, trip), 0) / trip.travelers.length)} por pessoa</small>` : ""}</div></div>
      ${items.map(c => {
        const seg = c.segId ? sc.segments.find(s => s.id === c.segId) : null;
        const foreign = c.cur && c.cur !== "BRL";
        const unit = isPerPerson(c, trip) ? trip.travelers.length : 1;
        const linked = c.bookingId ? trip.bookings.find(b => b.id === c.bookingId) : null;
        const detail = [linked ? "🔗 reserva" : "", seg ? seg.city : "Geral", isPerPerson(c, trip) ? `por pessoa × ${trip.travelers.length}` : "", c.refundable === false ? "não reembolsável" : ""].filter(Boolean).join(" · ");
        return `<button class="row" data-act="cost-edit" data-sc="${sc.id}" data-id="${c.id}">
          <div><strong>${esc(c.desc)}</strong><small>${esc(detail)}</small></div>
          <div class="row-right"><b>${c.status === "A orçar" && !c.amount ? "—" : brl(costBrl(c, trip))}</b>${trip.travelers.length > 1 && c.amount ? `<small>${brl(costBrl(c, trip) / trip.travelers.length)} por pessoa${isPerPerson(c, trip) ? "" : " (dividido)"}</small>` : ""}${foreign ? `<small>${(c.amount * unit).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${esc(c.cur)} · cot. ${num(c.rate)}</small>` : ""}<span class="tag ${c.status}">${c.status}</span></div></button>`;
      }).join("")}</section>`;
  }).join("");
  const REMIND = ["Passagens", "Hospedagem", "Transporte", "Passeios", "Alimentação", "Seguro"];
  const todo = REMIND.filter(cat => !sc.costs.some(c => c.cat === cat));
  const quick = todo.length ? `<div class="remind"><small class="muted">Lembrar de orçar (sem valor ainda):</small><div class="chips scroll">${todo.map(cat => `<button class="chip-btn" data-act="cost-quick" data-sc="${sc.id}" data-cat="${cat}">+ ${CAT_ICON[cat]} ${cat}</button>`).join("")}</div></div>` : "";
  return `${picker}
    <div class="section-head"><p class="muted">Custos de <b>${esc(sc.name)}</b>. Aceita cálculos: <code>2.400 ÷ 4</code> ou <code>180 x 7</code>.</p><button class="btn primary" data-act="sc-add-item" data-sc="${sc.id}">+ Item</button></div>
    ${quick}
    ${groups || `<div class="empty"><p>Nenhum custo neste cenário ainda.</p></div>`}
    ${sc.costs.length ? `<div class="card total-card"><div><small>Total do cenário</small><strong>${brl(st.total)}</strong></div><div><small>Por pessoa</small><strong>${brl(st.perPerson)}</strong></div><div><small>Por dia</small><strong>${brl(st.perDay)}</strong></div></div>` : ""}`;
}

/* --- Roteiro --- */
function tabItinerary(trip) {
  const days = dayList(trip);
  const orphan = Object.entries(trip.itinerary).filter(([k, list]) => Number(k) >= days.length && list?.length).reduce((n, [, l]) => n + l.length, 0);
  const sc = chosenScenario(trip);
  let last = null;
  const html = days.map((day, i) => {
    const header = day.city !== last ? `<div class="city-sep">${esc(day.city)}</div>` : "";
    last = day.city;
    return `${header}<article class="day">
      <div class="day-head"><div><span class="day-n">Dia ${i + 1}</span>${trip.start ? `<span class="muted"> · ${fmtDay(dayISO(trip, i))}</span>` : ""}</div><span class="wx" data-wx="${i}"></span></div>
      ${dayBody(trip, i)}</article>`;
  }).join("");
  return `${orphan ? `<p class="notice">${orphan} ${orphan === 1 ? "atividade está" : "atividades estão"} em dias além da rota atual. Ficam guardadas e voltam se a rota ganhar esses dias.</p>` : ""}${trip.status === "rascunho" ? `<p class="notice">Roteiro do cenário escolhido (<b>${esc(sc.name)}</b>). Ele pode mudar enquanto a viagem for rascunho.</p>` : ""}
    ${!trip.start ? `<p class="notice">Defina a data de saída nas opções da viagem para ver previsão do tempo e reservas por dia.</p>` : ""}
    <div class="days">${html}</div>`;
}

/* --- Mapa --- */
function mapPlaces(trip) {
  return trip.places.filter(p => (!ui.mapCity || p.city === ui.mapCity) && (ui.mapDay === "" || p.day === Number(ui.mapDay)));
}
function tabMap(trip) {
  const cities = [...new Set(chosenScenario(trip).segments.filter(s => !s.transit).map(s => s.city))];
  const list = mapPlaces(trip);
  const dayOpts = dayList(trip).map((d, i) => `<option value="${i}" ${String(i) === String(ui.mapDay) ? "selected" : ""}>Dia ${i + 1}${trip.start ? ` · ${fmtDay(dayISO(trip, i))}` : ""}</option>`).join("");
  const scSel = chosenScenario(trip);
  const missIdx = scSel.segments.findIndex(s => !s.transit && s.city && s.city !== "A definir" && !s.country && s.lat == null && !trip.country);
  const noCountry = missIdx >= 0 ? `<p class="notice">Para achar "${esc(scSel.segments[missIdx].city)}" no lugar certo, informe o país do destino. <button class="btn soft sm" data-act="seg-edit" data-sc="${scSel.id}" data-i="${missIdx}">Informar país</button></p>` : "";
  return `${noCountry}<div class="chips scroll"><button class="chip-btn ${ui.mapCity === "" ? "active" : ""}" data-act="map-city" data-city="">Todas</button>${cities.map(c => `<button class="chip-btn ${ui.mapCity === c ? "active" : ""}" data-act="map-city" data-city="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="section-head"><select id="mapDaySel" aria-label="Filtrar por dia"><option value="">Todos os dias</option>${dayOpts}</select><button class="btn primary" data-act="place-add">+ Local</button></div>
    <div id="map" class="map" role="application" aria-label="Mapa de atrações"></div>
    ${list.length ? `<div class="inline-actions"><a class="btn soft sm" target="_blank" rel="noopener" href="${gmapsRoute(list)}">Abrir rota no Google Maps</a></div>` : ""}
    <div class="card list" id="placeList">${list.map((p, n) => `<div class="place ${p.visited ? "done" : ""}" draggable="true" data-pid="${p.id}">
        <span class="grip" aria-hidden="true">⋮⋮</span><span class="num-badge">${n + 1}</span>
        <button class="place-main" data-act="place-edit" data-id="${p.id}"><strong>${esc(p.name)}</strong><small>${[p.city, p.day != null ? `Dia ${p.day + 1}` : ""].filter(Boolean).join(" · ")}</small></button>
        <div class="seg-tools"><button data-act="place-move" data-id="${p.id}" data-d="-1" ${n === 0 ? "disabled" : ""} aria-label="Subir">↑</button><button data-act="place-move" data-id="${p.id}" data-d="1" ${n === list.length - 1 ? "disabled" : ""} aria-label="Descer">↓</button></div>
      </div>`).join("") || `<div class="empty"><p>Pesquise um local para colocar o primeiro pin.</p></div>`}</div>
    <p class="muted tiny">Arraste os pins no mapa para ajustar a posição e arraste a lista (ou use ↑ ↓) para definir a ordem do percurso.</p>`;
}
const gmapsRoute = list => {
  if (list.length === 1) return `https://www.google.com/maps/search/?api=1&query=${list[0].lat},${list[0].lon}`;
  const pt = p => `${p.lat},${p.lon}`;
  const mid = list.slice(1, -1).map(pt).join("|");
  return `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${pt(list[0])}&destination=${pt(list.at(-1))}${mid ? `&waypoints=${encodeURIComponent(mid)}` : ""}`;
};
let mapRef = null;
async function initMap(trip) {
  const el = document.getElementById("map");
  if (!el) return;
  try {
    const L = await loadLeaflet();
    if (!document.getElementById("map")) return;
    mapRef?.remove();
    const list = mapPlaces(trip);
    const map = L.map(el, { zoomControl: true, attributionControl: true });
    mapRef = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    const pts = [];
    list.forEach((p, n) => {
      const icon = L.divIcon({ className: "pin", html: `<span>${n + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = L.marker([p.lat, p.lon], { draggable: true, icon, title: p.name }).addTo(map);
      marker.bindTooltip(p.name);
      marker.on("dragend", () => { const ll = marker.getLatLng(); p.lat = ll.lat; p.lon = ll.lng; save(); });
      pts.push([p.lat, p.lon]);
    });
    if (list.length > 1) L.polyline(pts, { color: "#2B2A27", weight: 2, dashArray: "5 6", opacity: .6 }).addTo(map);
    if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    else {
      const city = ui.mapCity || chosenScenario(trip).segments.find(s => !s.transit)?.city;
      const geo = city ? await geoOfCity(trip, city).catch(() => null) : null;
      map.setView(geo ? [geo.lat, geo.lon] : [20, 0], geo ? 12 : 2);
    }
  } catch {
    el.innerHTML = `<p class="map-off">Mapa indisponível sem internet. A lista abaixo continua valendo.</p>`;
  }
}

/* --- Reservas --- */
/** Texto do valor pago de uma reserva (informativo: os totais da viagem vêm de Despesas e Custos). */
function bookingPrice(b) {
  if (b.amount == null || b.amount === "") return "";
  const cur = (b.cur || "BRL").toUpperCase();
  const base = cur === "BRL" ? brl(b.amount) : `${cur} ${num(b.amount)} (≈ ${brl(b.amount * (b.rate || 1))})`;
  return `Valor ${base}${b.type === "Voo" ? " por pessoa" : ""}${b.paidBy && b.paidBy !== "—" ? ` por ${esc(b.paidBy)}` : ""}`;
}
const bookingBrl = (b, trip) => (b.amount == null || b.amount === "" ? 0 : Number(b.amount) * (b.rate || 1) * (b.type === "Voo" && trip.status !== "concluida" ? trip.travelers.length : 1));

function bookingExtras(b, trip) {
  const inBudget = chosenScenario(trip).costs.some(c => c.bookingId === b.id);
  const bits = [b.confirmed ? "✓ Confirmada" : "", b.checkin ? `Check-in: ${b.checkin.toLowerCase()}` : "", b.seat ? `Assento ${esc(b.seat)}` : "", b.baggage ? `Bagagem: ${esc(b.baggage)}` : "", b.supplier ? `Contato: ${esc(b.supplier)}` : "", inBudget ? "🔗 no orçamento" : ""].filter(Boolean);
  return `${bits.length ? `<small class="muted">${bits.join(" · ")}</small>` : ""}${b.notes ? `<small class="policy">${esc(b.notes)}</small>` : ""}`;
}

/* O que ainda falta reservar: cruza a rota do cenário escolhido com as reservas existentes. */
function missingBookings(trip) {
  const sc = chosenScenario(trip);
  const out = [];
  const norm = x => (x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const mentions = (b, city) => !!city && norm(`${b.desc} ${b.notes || ""}`).includes(norm(city));
  /* [a, z) em datas: a saída (checkout) não ocupa a noite seguinte */
  const inRange = (b, a, z) => { if (!trip.start || !b.date || !a) return false; return b.dateEnd ? b.date < z && b.dateEnd > a : b.date >= a && b.date < z; };
  const bks = trip.bookings;
  let day = 0;
  const segs = sc.segments.map(s => { const r = { ...s, from: day, to: day + s.days - 1 }; day += s.days; return r; });
  const cities = segs.filter(s => !s.transit && s.city && s.city !== "A definir");
  for (const s of cities) {
    const a = trip.start ? dayISO(trip, s.from) : "", z = trip.start ? dayISO(trip, s.to + 1) : "";
    if (!bks.some(b => b.type === "Hotel" && (mentions(b, s.city) || inRange(b, a, z)))) {
      out.push({ type: "Hotel", desc: `Hotel em ${s.city}`, date: a, label: `Hospedagem em ${s.city} (${s.days} ${s.days === 1 ? "dia" : "dias"})` });
    }
  }
  for (let i = 1; i < cities.length; i += 1) {
    const from = cities[i - 1], to = cities[i];
    const d = trip.start ? dayISO(trip, to.from) : "", dPrev = trip.start ? dayISO(trip, Math.max(0, to.from - 1)) : "";
    if (!bks.some(b => ["Voo", "Transfer", "Carro", "Outro"].includes(b.type) && (mentions(b, to.city) || inRange(b, dPrev, addDays(d, 1))))) {
      out.push({ type: "Voo", desc: `${from.city} → ${to.city}`, date: d, label: `Transporte ${from.city} → ${to.city}` });
    }
  }
  if (cities.length && !bks.some(b => b.type === "Voo")) out.push({ type: "Voo", desc: "Passagens de ida e volta", date: trip.start || "", label: "Passagens de ida e volta" });
  if (cities.length && !bks.some(b => b.type === "Seguro")) out.push({ type: "Seguro", desc: "Seguro viagem", date: trip.start || "", label: "Seguro viagem" });
  return out;
}

function tabBookings(trip) {
  const missing = trip.status === "concluida" ? [] : missingBookings(trip);
  const missingHtml = missing.length ? `<section class="alerts"><h3>O que falta reservar</h3>${missing.map((m, i) => `<button class="alert-row" data-act="book-add" data-miss="${i}"><span><b>${esc(m.label)}</b><small>Toque para cadastrar</small></span><b>+</b></button>`).join("")}</section>` : "";
  const sorted = trip.bookings.slice().sort((a, b) => (a.date || "9").localeCompare(b.date || "9"));
  const open = sorted.filter(b => !b.done), done = sorted.filter(b => b.done);
  const item = b => `<div class="booking ${b.done ? "done" : ""}">
    <button class="check-btn" data-act="book-toggle" data-id="${b.id}" aria-label="Marcar como feito">${b.done ? "✓" : ""}</button>
    <button class="booking-main" data-act="book-edit" data-id="${b.id}">
      <strong>${BOOKING_ICON[b.type] || "📌"} ${esc(b.desc)}</strong>
      <small>${[b.type, b.date ? fmtShort(b.date) + (b.dateEnd ? ` a ${fmtShort(b.dateEnd)}` : "") : "", b.locator ? `Localizador ${esc(b.locator)}` : "", b.deadline ? `Prazo ${fmtShort(b.deadline)}` : ""].filter(Boolean).join(" · ")}</small>
      ${bookingPrice(b) ? `<small class="price"><b>${bookingPrice(b)}</b></small>` : ""}
      ${bookingExtras(b, trip)}
      ${cancelTag(b)}${b.cancelPolicy ? `<small class="policy">Condições: ${esc(b.cancelPolicy)}</small>` : ""}${b.changePolicy ? `<small class="policy">Remarcação: ${esc(b.changePolicy)}</small>` : ""}
    </button>
    <div class="res-actions">${b.link ? `<a class="mini" href="${esc(b.link)}" target="_blank" rel="noopener" title="Abrir documento">🔗</a>` : ""}${bookingAttachButtons(b)}</div></div>`;
  const pricedTotal = trip.bookings.reduce((sum, b) => sum + bookingBrl(b, trip), 0);
  return `<div class="section-head"><p class="muted">Reservas, localizadores, condições de cancelamento e prazos.</p><button class="btn primary" data-act="book-add">+ Reserva</button></div>
    ${pricedTotal ? `<div class="card"><div class="bal"><span>Valor das reservas com preço <small class="muted">(já no orçamento do cenário escolhido)</small></span><b>${brl(pricedTotal)}</b></div></div>` : ""}
    ${missingHtml}
    ${open.length ? `<div class="card list">${open.map(item).join("")}</div>` : `<div class="empty"><p>Nada pendente.</p></div>`}
    ${done.length ? `<h3 class="sub">Concluídas</h3><div class="card list">${done.map(item).join("")}</div>` : ""}`;
}

/* --- Despesas --- */
function tabExpenses(trip) {
  const balances = calculateBalances(trip.expenses, trip.travelers);
  const moves = settle(balances);
  const pending = trip.expenses.filter(e => !e.participants.length && !e.shares);
  const total = trip.expenses.reduce((s, e) => s + expenseTotal(e), 0);
  const card = trip.expenses.filter(e => e.card);
  const cardTotal = card.reduce((s, e) => s + expenseTotal(e), 0);
  const cards = card.reduce((m, e) => { const k = e.cardName || "Cartão de crédito"; m[k] = (m[k] || 0) + expenseTotal(e); return m; }, {});
  const balRows = Object.entries(balances).map(([name, v]) => `<div class="bal"><span>${esc(name)}</span><b class="${v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""}">${v > 0.005 ? "recebe " : v < -0.005 ? "deve " : "quitado "}${Math.abs(v) > 0.005 ? brl(Math.abs(v)) : ""}</b></div>`).join("");
  return `<div class="section-head"><p class="muted">Lance o que foi pago e quem divide. Aceita cálculos: <code>2.400 ÷ 4</code>.</p><button class="btn primary" data-act="exp-add">+ Despesa</button></div>
    ${trip.expenses.length ? `<div class="kpi-grid two"><div class="kpi"><small>Total gasto</small><strong>${brl(total)}</strong></div><div class="kpi"><small>No cartão de crédito</small><strong>${brl(cardTotal)}</strong></div></div>
    ${Object.keys(cards).length > 1 ? `<div class="card"><h3 class="sub">Por cartão</h3>${Object.entries(cards).map(([k, v]) => `<div class="bal"><span>${esc(k)}</span><b>${brl(v)}</b></div>`).join("")}</div>` : ""}
    <section class="card"><h2>Saldos</h2>${balRows}
      ${moves.length ? `<div class="moves">${moves.map(m => `<p><b>${esc(m.from)}</b> paga <b>${brl(m.amount)}</b> a <b>${esc(m.to)}</b></p>`).join("")}</div>` : ""}
      ${pending.length ? `<p class="notice">${plural(pending.length, "despesa aguardando divisão", "despesas aguardando divisão")}.</p>` : ""}</section>
    <section class="card list"><div class="group-head"><span>Lançamentos</span><strong>${brl(total)}</strong></div>
      ${trip.expenses.slice().reverse().map(e => {
        const who = e.shares ? "valores individuais" : e.participants.length ? (e.participants.length === 1 && e.participants[0] === e.paidBy ? "só pagador" : `${brl(expenseTotal(e) / e.participants.length)} × ${e.participants.length}`) : "dividir depois";
        const foreign = e.cur && e.cur !== "BRL";
        return `<button class="row" data-act="exp-edit" data-id="${e.id}"><div><strong>${CAT_ICON[e.cat] || ""} ${esc(e.desc)}</strong><small>${[e.date ? fmtShort(e.date) : "", `pago por ${esc(e.paidBy)}`, who, e.tipPct ? `gorjeta ${e.tipPct}%` : "", e.card ? "💳 cartão" : ""].filter(Boolean).join(" · ")}</small></div>
          <div class="row-right"><b>${brl(expenseTotal(e))}</b>${foreign ? `<small>${e.orig.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${esc(e.cur)}</small>` : ""}</div></button>`;
      }).join("")}</section>
    <div class="inline-actions"><button class="btn ghost sm" data-act="exp-csv">Exportar CSV</button></div>`
    : `<div class="empty"><p>Nenhuma despesa lançada.</p></div>`}`;
}

/* --- Bagagem --- */
function tabChecklist(trip) {
  const groups = [...new Set(trip.checklist.map(i => i.group || "Outros"))];
  const done = trip.checklist.filter(i => i.done).length;
  return `<div class="section-head"><p class="muted"><b>${done}/${trip.checklist.length}</b> itens conferidos nesta viagem.</p><button class="btn primary" data-act="chk-add">+ Item</button></div>
    ${groups.map(g => `<section class="card list"><div class="group-head"><span>${esc(g)}</span><small>${trip.checklist.filter(i => (i.group || "Outros") === g && i.done).length}/${trip.checklist.filter(i => (i.group || "Outros") === g).length}</small></div>
      ${trip.checklist.filter(i => (i.group || "Outros") === g).map(i => `<div class="check-row ${i.done ? "done" : ""}"><button class="check-btn" data-act="chk-toggle" data-id="${i.id}" aria-label="Conferir">${i.done ? "✓" : ""}</button><button class="check-text" data-act="chk-toggle" data-id="${i.id}">${esc(i.text)}</button><button class="mini" data-act="chk-edit" data-id="${i.id}" aria-label="Editar">⋯</button></div>`).join("")}</section>`).join("")}
    <div class="inline-actions">
      <button class="btn ghost sm" data-act="chk-reset">Desmarcar tudo</button>
      <button class="btn ghost sm" data-act="chk-save-template">Salvar como lista padrão</button>
      <button class="btn ghost sm" data-act="chk-load-template">Trazer itens da lista padrão</button>
    </div>`;
}

/* ---------- clima ---------- */
async function fillWeather(trip) {
  if (!trip.start) return;
  const days = dayList(trip);
  const byCity = {};
  days.forEach((d, i) => { if (!d.transit && d.city && d.city !== "A definir" && document.querySelector(`[data-wx="${i}"]`)) (byCity[d.city] ||= []).push(i); });
  for (const [city, idxs] of Object.entries(byCity)) {
    try {
      const geo = await geoOfCity(trip, city);
      if (!geo) continue;
      const w = await cityWeather(geo, dayISO(trip, idxs[0]), dayISO(trip, idxs.at(-1)));
      idxs.forEach(i => {
        const info = w[dayISO(trip, i)];
        document.querySelectorAll(`[data-wx="${i}"]`).forEach(el => {
          el.innerHTML = info ? `<span>${weatherIcon(info.code, info.rain)} ${Math.round(info.tmin)}° / ${Math.round(info.tmax)}°</span><small>${info.rain != null ? `chuva ${info.rain}%` : ""}${info.hist ? " · média histórica" : ""}</small>` : "";
        });
      });
    } catch { /* sem internet: segue sem clima */ }
  }
}

/* ---------- renderização geral ---------- */
function render(keepScroll = false) {
  const app = document.querySelector("#app");
  const r = route();
  const trip = currentTrip();
  const dest = currentDest();
  if ((r[0] === "t" && !trip) || (r[0] === "d" && !dest)) { location.hash = "#/"; return; }
  if (trip && ui.tripId !== trip.id) { ui.tripId = trip.id; ui.tab = activeDayIndex(trip) != null ? "hoje" : "cenarios"; ui.hojeDay = null; ui.mapCity = ""; ui.mapDay = ""; }
  app.innerHTML = trip ? renderTrip(trip) : dest ? renderDestPage(dest) : renderHome();
  if (!keepScroll) window.scrollTo(0, 0);
  updateStatus(getStatus());
  if (trip) {
    if (["hoje", "roteiro"].includes(ui.tab)) fillWeather(trip);
    if (ui.tab === "mapa") initMap(trip);
  } else if (!dest) {
    const act = activeTrip();
    if (act) fillWeather(act);
  }
}
const STATUS_TEXT = { off: "Sem sincronização", syncing: "Sincronizando…", ok: "Sincronizado", error: "Erro ao sincronizar", offline: "Offline" };
function updateStatus(value) {
  document.querySelectorAll("[data-sync]").forEach(el => { el.textContent = STATUS_TEXT[value] || ""; el.dataset.state = value; });
}
hooks.render = render;
hooks.status = updateStatus;
hooks.toast = toast;

/* ---------- editores ---------- */
const trip0 = () => currentTrip() || {};
const findSc = el => currentTrip().scenarios.find(s => s.id === el.dataset.sc);
const findSeg = el => findSc(el).segments[Number(el.dataset.i)];
function cloneScenario(src) {
  const copy = structuredClone(src);
  const idMap = {};
  copy.id = uid();
  copy.segments.forEach(s => { const old = s.id; s.id = uid(); idMap[old] = s.id; });
  copy.costs.forEach(c => { c.id = uid(); if (c.segId) c.segId = idMap[c.segId] || ""; });
  return copy;
}
function money2(raw) {
  try { return parseMoneyExpression(raw); } catch { toast("Valor ou cálculo inválido."); return null; }
}
async function rateFor(cur, typed) {
  const code = (cur || "BRL").trim().toUpperCase();
  if (code === "BRL") return { code, rate: 1 };
  if (typed) { const r = money2(typed); return r ? { code, rate: r } : null; }
  try { return { code, rate: Math.round((await fxRate(code)) * 10000) / 10000 }; } catch { toast("Sem cotação automática. Informe a cotação em reais."); return null; }
}
const dayOptions = trip => ["—", ...dayList(trip).map((d, i) => `Dia ${i + 1}${trip.start ? ` · ${fmtDay(dayISO(trip, i))}` : ""} · ${d.city}`)];
const dayFromOption = label => (label && label.startsWith("Dia ") ? Number(label.split(" ")[1]) - 1 : null);

async function editCost(sc, cost) {
  const trip = currentTrip();
  const places = ["Geral (viagem toda)", ...sc.segments.map(s => s.city)];
  const segName = cost?.segId ? sc.segments.find(s => s.id === cost.segId)?.city : null;
  const linked = cost?.bookingId ? trip.bookings.find(b => b.id === cost.bookingId) : null;
  const bookingLabel = b => `${BOOKING_ICON[b.type] || "📌"} ${b.desc}${b.date ? ` · ${fmtShort(b.date)}` : ""}`;
  const free = trip.bookings.filter(b => !sc.costs.some(c => c.bookingId === b.id && c !== cost));
  const bookingOpts = ["— nenhuma —", ...free.map(bookingLabel)];
  const v = await ask(cost ? "Editar custo" : "Novo custo", [
    { name: "cat", label: "Categoria", type: "select", options: CATEGORIES, value: cost?.cat || "Hospedagem" },
    ...(linked ? [{ name: "_l", type: "note", label: `🔗 Ligado à reserva "${linked.desc}". Descrição e valor são editados na aba Reservas.` }] : [
      { name: "desc", label: "Descrição", value: cost?.desc, required: true, placeholder: "Ex.: Hotel em Paris" },
      { name: "amount", label: "Valor ou cálculo (pode deixar vazio: fica \"a orçar\")", type: "money", value: cost?.amount ? num(cost.amount) : "", placeholder: "Ex.: 2.400 ou 180 x 7" },
      { name: "cur", label: "Moeda", type: "select", options: curOptions(cost?.cur), value: cost?.cur || "BRL", hint: "A cotação em reais é buscada sozinha." },
      { name: "rate", label: "Cotação em reais (opcional)", type: "money", value: cost?.rate && cost.rate !== 1 ? num(cost.rate) : "", placeholder: "Deixe vazio para usar a cotação do dia" }
    ]),
    { name: "perPerson", label: `Valor é por pessoa (× ${trip.travelers.length})`, type: "checkbox", value: !!cost?.perPerson },
    { name: "where", label: "Vinculado a", type: "select", options: places, value: segName || places[0] },
    { name: "status", label: "Situação", type: "select", options: COST_STATUS, value: cost?.status || "Estimado" },
    { name: "refundable", label: "Reembolsável", type: "checkbox", value: cost ? cost.refundable !== false : true },
    ...(linked ? [{ name: "openBook", label: "Editar a reserva (valor, datas, assento…)", type: "checkbox", value: false }, { name: "unlink", label: "Desligar da reserva", type: "checkbox", value: false }]
      : trip.bookings.length ? [{ name: "book", label: "Ligar a uma reserva já cadastrada", type: "select", options: bookingOpts, value: bookingOpts[0], hint: "A reserva passa a ser a fonte do valor e da descrição." }] : []),
    ...(cost ? [{ name: "del", label: "Excluir este custo", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  if (v.del) { sc.costs = sc.costs.filter(c => c.id !== cost.id); commit(); return; }
  const seg = sc.segments.find(s => s.city === v.where);
  const common = { cat: v.cat, perPerson: v.perPerson, segId: seg?.id || "", status: v.status, refundable: v.refundable };
  if (linked) {
    Object.assign(cost, common);
    if (v.unlink) delete cost.bookingId;
    commit();
    if (v.openBook && !v.unlink) await editBooking(linked, { sc });
    return;
  }
  let amount = 0;
  if (v.amount) { amount = money2(v.amount); if (amount == null) return; }
  const fx = amount ? await rateFor(v.cur, v.rate) : { code: v.cur || "BRL", rate: 1 };
  if (!fx) return;
  if (!amount) common.status = "A orçar";
  else if (common.status === "A orçar") common.status = "Estimado";
  const data = { ...common, desc: v.desc.trim(), amount, cur: fx.code, rate: fx.rate };
  const bi = v.book ? bookingOpts.indexOf(v.book) - 1 : -1;
  if (bi >= 0) {
    const b = free[bi];
    data.bookingId = b.id;
    if (b.amount == null || b.amount === "") { b.amount = amount; b.cur = fx.code; b.rate = fx.rate; b.updatedAt = Date.now(); }
  }
  if (cost) Object.assign(cost, data); else sc.costs.push({ id: uid(), ...data });
  commit();
}

async function editActivity(day, act) {
  const trip = currentTrip();
  const v = await ask(act ? "Editar atividade" : `Nova atividade · Dia ${day + 1}`, [
    { name: "time", label: "Horário", type: "time", value: act?.time },
    { name: "title", label: "Atividade", value: act?.title, required: true, placeholder: "Ex.: Torre Eiffel" },
    { name: "cost", label: "Valor previsto em reais (opcional)", type: "money", value: act?.cost ? num(act.cost) : "" },
    { name: "note", label: "Endereço, link ou observações", type: "textarea", value: act?.note },
    ...(act ? [{ name: "del", label: "Excluir esta atividade", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  const list = trip.itinerary[day] ||= [];
  if (v.del) { trip.itinerary[day] = list.filter(a => a.id !== act.id); commit(); return; }
  let cost = 0;
  if (v.cost) { cost = money2(v.cost); if (cost == null) return; }
  const data = { time: v.time, title: v.title.trim(), cost, note: v.note.trim() };
  if (act) Object.assign(act, data); else list.push({ id: uid(), ...data });
  commit();
}

async function editBooking(b, pre = {}) {
  const trip = currentTrip();
  const sc = pre.sc || chosenScenario(trip);
  const v = await ask(b ? "Editar reserva" : "Nova reserva", [
    { name: "type", label: "Tipo", type: "select", options: BOOKING_TYPES, value: b?.type || pre.type || "Hotel" },
    { name: "desc", label: "Descrição", value: b?.desc ?? pre.desc, required: true, placeholder: "Ex.: Hotel Marais" },
    { name: "amount", label: "Valor (opcional) — entra no orçamento; passagem: valor por pessoa", type: "money", value: b?.amount != null ? num(b.amount) : "", placeholder: "Ex.: 800 ou 2.609" },
    { name: "cur", label: "Moeda do valor", type: "select", options: curOptions(b?.cur), value: b?.cur || "BRL", hint: "O valor vira um custo ligado no cenário escolhido." },
    { name: "paidBy", label: "Quem pagou", type: "select", options: ["—", ...trip.travelers], value: b?.paidBy || "—" },
    { name: "date", label: "Data (início / entrada)", type: "date", value: b?.date ?? pre.date },
    { name: "dateEnd", label: "Data final (saída), se houver", type: "date", value: b?.dateEnd },
    { name: "locator", label: "Localizador / confirmação", value: b?.locator },
    { name: "confirmed", label: "Confirmação recebida", type: "checkbox", value: !!b?.confirmed },
    { name: "checkin", label: "Check-in online", type: "select", options: CHECKIN, value: b?.checkin || CHECKIN[0], showIf: ["type", "Voo"] },
    { name: "seat", label: "Assento(s)", value: b?.seat, placeholder: "Ex.: 14A, 14B", showIf: ["type", "Voo"] },
    { name: "baggage", label: "Bagagem", value: b?.baggage, placeholder: "Ex.: 1 despachada de 23 kg + mão", showIf: ["type", "Voo"] },
    { name: "supplier", label: "Contato do fornecedor", value: b?.supplier, placeholder: "Telefone, e-mail ou site" },
    { name: "link", label: "Link do documento (OneDrive, e-mail…)", value: b?.link, placeholder: "https://…" },
    { name: "attachments", label: "Anexos (voucher, PDF, print)", type: "attach", value: b?.attachments || [] },
    { name: "freeCancelUntil", label: "Cancelamento grátis até", type: "date", value: b?.freeCancelUntil },
    { name: "cancelPolicy", label: "Condições de cancelamento / alteração", type: "textarea", value: [b?.cancelPolicy, b?.changePolicy].filter(Boolean).join("
"), placeholder: "Ex.: grátis até 48 h antes; depois, 1ª diária. Remarcação com taxa de 10%" },
    { name: "deadline", label: "Prazo de pagamento", type: "date", value: b?.deadline },
    { name: "notes", label: "Observações (sala VIP, passageiros, extras)", type: "textarea", value: b?.notes },
    ...(b ? [{ name: "del", label: "Excluir esta reserva", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  if (v.del) { trip.bookings = trip.bookings.filter(x => x.id !== b.id); trip.scenarios.forEach(s => s.costs.forEach(c => { if (c.bookingId === b.id) delete c.bookingId; })); commit(); return; }
  let amount = null, cur = "BRL", rate = 1;
  if (v.amount) {
    amount = money2(v.amount);
    if (amount == null) return;
    const fx = await rateFor(v.cur, "");
    if (!fx) return;
    cur = fx.code; rate = fx.rate;
  }
  const data = {
    amount, cur, rate, paidBy: v.paidBy === "—" ? "" : v.paidBy,
    confirmed: v.confirmed, checkin: v.type === "Voo" && v.checkin !== CHECKIN[0] ? v.checkin : "",
    seat: v.type === "Voo" ? (v.seat || "").trim() : (b?.seat || ""), baggage: v.type === "Voo" ? (v.baggage || "").trim() : (b?.baggage || ""),
    supplier: (v.supplier || "").trim(), notes: (v.notes || "").trim(),
    desc: v.desc.trim(), type: v.type, date: v.date, dateEnd: v.dateEnd, locator: v.locator.trim(), link: v.link.trim(),
    attachments: v.attachments, freeCancelUntil: v.freeCancelUntil, cancelPolicy: v.cancelPolicy.trim(), changePolicy: "", deadline: v.deadline
  };
  let book = b;
  if (b) Object.assign(b, data); else { book = { id: uid(), done: false, ...data }; trip.bookings.push(book); }
  const origin = pre.costId ? sc.costs.find(c => c.id === pre.costId) : null;
  if (origin) {
    origin.bookingId = book.id;
    origin.cat = BOOKING_CAT[book.type] || origin.cat;
    if (book.amount != null) { origin.status = origin.status === "A orçar" ? "Reservado" : origin.status; book.costSynced = true; }
  }
  /* a reserva é o lugar único do valor: gera o custo ligado no cenário escolhido */
  const firstSync = book.amount != null && !book.costSynced;
  if (book.amount != null) book.costSynced = true;
  if (firstSync && !trip.scenarios.some(s => s.costs.some(c => c.bookingId === book.id))) {
    sc.costs.push({ id: uid(), desc: book.desc, cat: BOOKING_CAT[book.type] || "Outros", amount: book.amount, cur: book.cur, rate: book.rate, perPerson: false, segId: "", status: "Reservado", refundable: true, bookingId: book.id });
  }
  commit();
}

async function editExpense(e, trip) {
  const names = trip.travelers;
  const mode0 = e ? (e.shares ? "Valores individuais" : !e.participants.length ? "Dividir depois" : e.participants.length === 1 && e.participants[0] === e.paidBy && names.length > 1 ? "Só eu" : "Dividir igual") : (names.length > 1 ? "Dividir igual" : "Só eu");
  const v = await ask(e ? "Editar despesa" : "Lançar despesa", [
    { name: "desc", label: "O que foi", value: e?.desc, required: true, placeholder: "Ex.: Jantar no Marais" },
    { name: "amount", label: "Valor ou cálculo", type: "money", value: e ? num(e.orig ?? e.amount) : "", placeholder: "Ex.: 85,50 ou 2.400 ÷ 4" },
    { name: "cur", label: "Moeda", type: "select", options: curOptions(e?.cur), value: e?.cur || "BRL", hint: "Em moeda estrangeira, o valor em reais é calculado pela cotação do dia." },
    { name: "rate", label: "Cotação em reais (opcional)", type: "money", value: e?.cur && e.cur !== "BRL" ? num(e.rate) : "" },
    { name: "cat", label: "Categoria", type: "select", options: CATEGORIES, value: e?.cat || "Alimentação" },
    { name: "paidBy", label: "Quem pagou", type: "select", options: names, value: e?.paidBy || names[0] },
    { name: "split", label: "Divisão", type: "select", options: ["Dividir igual", "Só eu", "Valores individuais", "Dividir depois"], value: mode0 },
    { name: "participants", label: "Dividir entre", type: "checks", options: names, value: e?.participants?.length ? e.participants : names, showIf: ["split", "Dividir igual"] },
    { name: "_n", type: "note", label: "Informe quanto cada pessoa deve. O total é a soma.", showIf: ["split", "Valores individuais"] },
    ...names.map((n, i) => ({ name: `share${i}`, label: n, type: "money", value: e?.shares?.[n] != null ? num(e.shares[n] / (e.rate || 1)) : "", showIf: ["split", "Valores individuais"] })),
    { name: "tip", label: "Gorjeta (%) — opcional", type: "number", value: e?.tipPct || "", min: 0, step: "0.5" },
    { name: "card", label: "Paguei no cartão de crédito", type: "checkbox", value: !!e?.card },
    { name: "cardName", label: "Qual cartão (opcional)", value: e?.cardName },
    { name: "date", label: "Data", type: "date", value: e?.date || todayISO() },
    ...(e ? [{ name: "del", label: "Excluir esta despesa", type: "checkbox", value: false }] : [])
  ], { confirm: e ? "Salvar" : "Lançar" });
  if (!v) return;
  if (v.del) { trip.expenses = trip.expenses.filter(x => x.id !== e.id); commit(); return; }
  const fx = await rateFor(v.cur, v.rate);
  if (!fx) return;
  let orig, shares = null, participants = [];
  if (v.split === "Valores individuais") {
    shares = {};
    let sum = 0;
    for (let i = 0; i < names.length; i += 1) {
      const raw = v[`share${i}`];
      if (!raw) continue;
      const n = money2(raw);
      if (n == null) return;
      shares[names[i]] = Math.round(n * fx.rate * 100) / 100;
      sum += n;
    }
    if (!sum) { toast("Informe ao menos um valor individual."); return; }
    orig = sum;
  } else {
    orig = money2(v.amount);
    if (orig == null) return;
    if (v.split === "Só eu") participants = [v.paidBy];
    else if (v.split === "Dividir igual") {
      participants = v.participants;
      if (!participants.length) { toast("Escolha ao menos um viajante."); return; }
    }
  }
  const data = {
    desc: v.desc.trim(), orig, cur: fx.code, rate: fx.rate, amount: Math.round(orig * fx.rate * 100) / 100,
    cat: v.cat, paidBy: v.paidBy, participants, shares, tipPct: Number(v.tip) || 0, card: v.card, cardName: v.cardName.trim(), date: v.date
  };
  if (e) Object.assign(e, data); else trip.expenses.push({ id: uid(), ...data });
  commit();
  toast("Despesa lançada.");
}

async function editPlace(p) {
  const trip = currentTrip();
  const cities = [...new Set(chosenScenario(trip).segments.filter(s => !s.transit).map(s => s.city))];
  const opts = dayOptions(trip);
  const v = await ask("Local", [
    { name: "name", label: "Nome", value: p.name, required: true },
    { name: "city", label: "Cidade", type: "select", options: cities.length ? cities : [p.city || "—"], value: p.city },
    { name: "day", label: "Visitar no dia", type: "select", options: opts, value: p.day != null ? opts[p.day + 1] : "—" },
    { name: "visited", label: "Já visitei", type: "checkbox", value: !!p.visited },
    { name: "del", label: "Excluir este local", type: "checkbox", value: false }
  ]);
  if (!v) return;
  const trip2 = currentTrip();
  if (v.del) { trip2.places = trip2.places.filter(x => x.id !== p.id); commit(); return; }
  Object.assign(p, { name: v.name.trim(), city: v.city, day: dayFromOption(v.day), visited: v.visited });
  commit();
}
async function addPlace() {
  const trip = currentTrip();
  const cities = [...new Set(chosenScenario(trip).segments.filter(s => !s.transit).map(s => s.city))];
  const q = await ask("Buscar local", [
    { name: "query", label: "Nome do lugar", required: true, placeholder: "Ex.: Torre Eiffel" },
    { name: "city", label: "Cidade", type: "select", options: cities.length ? cities : ["—"], value: ui.mapCity || cities[0] }
  ], { confirm: "Buscar" });
  if (!q) return;
  let results = [];
  try { results = await searchPlaces(q.query, [q.city === "—" ? "" : q.city, countryOfCity(trip, q.city)].filter(Boolean).join(", ")); } catch { toast("Não consegui buscar. Verifique a internet."); return; }
  if (!results.length) { toast("Nada encontrado. Tente outro nome."); return; }
  const labels = results.map((r, i) => `${i + 1}. ${r.name} — ${r.label.split(",").slice(1, 3).join(",").trim()}`);
  const pick = await ask("Escolha o local", [{ name: "r", label: "Resultados", type: "select", options: labels, value: labels[0] }], { confirm: "Colocar pin" });
  if (!pick) return;
  const r = results[labels.indexOf(pick.r)];
  currentTrip().places.push({ id: uid(), name: r.name, city: q.city === "—" ? "" : q.city, lat: r.lat, lon: r.lon, day: ui.mapDay !== "" ? Number(ui.mapDay) : null, visited: false });
  commit();
}

/* destino / contatos */
async function editDest(d) {
  const v = await ask(d ? "Editar destino" : "Novo destino", [
    { name: "name", label: "Destino", value: d?.name, required: true, placeholder: "Ex.: Paris" },
    { name: "country", label: "País", value: d?.country },
    ...(d ? [{ name: "del", label: "Excluir este destino", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  if (v.del) { removeItem("destinations", d.id); location.hash = "#/"; return; }
  if (d) Object.assign(d, { name: v.name.trim(), country: v.country.trim() });
  else {
    const nd = { id: uid(), name: v.name.trim(), country: v.country.trim(), repeat: false, attractions: [], food: [] };
    state.destinations.push(nd);
    save();
    location.hash = `#/d/${nd.id}`;
    return;
  }
  commit();
}
async function editContact(c, destId) {
  const v = await ask(c ? "Editar contato" : "Novo contato", [
    { name: "name", label: "Nome (guia, agência…)", value: c?.name, required: true },
    { name: "phone", label: "Telefone / WhatsApp", value: c?.phone },
    { name: "instagram", label: "Instagram", value: c?.instagram, placeholder: "@perfil" },
    { name: "note", label: "Observação", value: c?.note },
    ...(c ? [{ name: "del", label: "Excluir este contato", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  if (v.del) { removeItem("contacts", c.id); render(true); return; }
  const data = { name: v.name.trim(), phone: v.phone.trim(), instagram: v.instagram.trim(), note: v.note.trim() };
  if (c) Object.assign(c, data); else state.contacts.push({ id: uid(), destId: destId || "", ...data });
  commit(true);
}

/* ---------- ações ---------- */
function newTripObject({ name, days, travelers, start }) {
  const scenario = { id: uid(), name: "Cenário 1", segments: [{ id: uid(), city: "Destino", days }], costs: [] };
  return normalizeTrip({ id: uid(), name, days, start: start || "", travelers, status: "rascunho", scenarios: [scenario], chosenId: scenario.id });
}
const parseNames = text => { const n = String(text || "").split(",").map(s => s.trim()).filter(Boolean); return n.length ? n : ["Eu"]; };
const tripForAction = el => state.trips.find(t => t.id === el?.dataset?.trip) || currentTrip() || activeTrip();
const placeById = id => currentTrip().places.find(p => p.id === id);
const destById = id => state.destinations.find(d => d.id === id);

const actions = {
  /* viagens */
  async "new-trip"() {
    const v = await ask("Nova viagem", [
      { name: "name", label: "Nome", required: true, placeholder: "Ex.: Europa 2027" },
      { name: "days", label: "Duração (dias)", type: "number", value: 15, min: 1, required: true },
      { name: "start", label: "Data de saída (opcional)", type: "date" },
      { name: "travelers", label: "Viajantes", value: "Eu", hint: "Separe por vírgula. Ex.: Eduardo, Ana", required: true }
    ], { confirm: "Criar rascunho" });
    if (!v) return;
    const trip = newTripObject({ name: v.name.trim(), days: Math.max(1, Number(v.days)), travelers: parseNames(v.travelers), start: v.start });
    state.trips.push(trip);
    ui.tripId = null; ui.scenarioId = null;
    save();
    location.hash = `#/t/${trip.id}`;
  },
  async "new-wish"() {
    const v = await ask("Nova viagem desejada", [
      { name: "name", label: "Para onde?", required: true, placeholder: "Ex.: Japão" },
      { name: "days", label: "Quantos dias (aproximado)", type: "number", value: 10, min: 1 },
      { name: "travelers", label: "Viajantes", value: "Eu" }
    ], { confirm: "Salvar desejo" });
    if (!v) return;
    const trip = newTripObject({ name: v.name.trim(), days: Math.max(1, Number(v.days) || 7), travelers: parseNames(v.travelers), start: "" });
    trip.status = "desejo";
    state.trips.push(trip);
    commit();
  },
  async "new-past"() {
    const v = await ask("Registrar viagem passada", [
      { name: "name", label: "Nome da viagem", required: true, placeholder: "Ex.: Tailândia 2020" },
      { name: "country", label: "País", placeholder: "Ex.: Tailândia" },
      { name: "destName", label: "Destino principal", placeholder: "Ex.: Bangkok" },
      { name: "start", label: "Data de saída (aproximada)", type: "date" },
      { name: "days", label: "Dias", type: "number", value: 10, min: 1 },
      { name: "travelers", label: "Viajantes", value: "Eu" },
      { name: "total", label: "Custo total em reais (se não detalhar abaixo)", type: "money" },
      { name: "_n", type: "note", label: "Ou detalhe por categoria (opcional):" },
      ...CATEGORIES.map((c, i) => ({ name: `c${i}`, label: c, type: "money" })),
      { name: "wouldRepeat", label: "Repetiria este destino", type: "checkbox", value: false }
    ], { confirm: "Registrar" });
    if (!v) return;
    const trip = newTripObject({ name: v.name.trim(), days: Math.max(1, Number(v.days) || 1), travelers: parseNames(v.travelers), start: v.start });
    trip.status = "concluida";
    trip.country = v.country.trim();
    trip.destName = v.destName.trim();
    trip.wouldRepeat = v.wouldRepeat;
    chosenScenario(trip).segments[0].city = trip.destName || trip.name;
    const byCat = {};
    for (let i = 0; i < CATEGORIES.length; i += 1) {
      if (!v[`c${i}`]) continue;
      const n = money2(v[`c${i}`]);
      if (n == null) return;
      byCat[CATEGORIES[i]] = n;
    }
    if (!Object.keys(byCat).length && v.total) {
      const t = money2(v.total);
      if (t == null) return;
      byCat.Outros = t;
    }
    trip.pastCosts = byCat;
    state.trips.push(trip);
    ui.home = "historico";
    commit();
  },
  async "trip-menu"() {
    const trip = currentTrip();
    const v = await ask("Opções da viagem", [
      { name: "name", label: "Nome", value: trip.name, required: true },
      ...(trip.status === "concluida" ? [
        { name: "country", label: "País", value: trip.country },
        { name: "destName", label: "Destino principal", value: trip.destName, hint: "Liga a viagem ao banco de destinos e às estatísticas." }
      ] : [{ name: "_dest", type: "note", label: "País e destino ficam em cada destino da rota (aba Cenários → + Destino / tocar no nome)." }]),
      { name: "start", label: "Data de saída", type: "date", value: trip.start },
      { name: "end", label: "Data de retorno", type: "date", value: trip.start ? addDays(trip.start, trip.days - 1) : "", hint: "Informe a volta ou os dias: um calcula o outro." },
      { name: "days", label: "Duração (dias)", type: "number", value: trip.days, min: 1 },
      ...(trip.status === "concluida" ? [] : [{ name: "lock", label: "Usar este mesmo período em todos os cenários", type: "checkbox", value: !!trip.lockPeriod, hint: "Desmarcado, cada cenário pode ter duração e data próprias (botão Datas no cenário)." }]),
      { name: "travelers", label: "Viajantes", value: trip.travelers.join(", ") },
      { name: "status", label: "Situação", type: "select", options: Object.values(TRIP_STATUS), value: TRIP_STATUS[trip.status] },
      { name: "wouldRepeat", label: "Repetiria este destino", type: "checkbox", value: !!trip.wouldRepeat },
      { name: "del", label: "Excluir esta viagem", type: "checkbox", value: false }
    ]);
    if (!v) return;
    if (v.del) { removeItem("trips", trip.id); location.hash = "#/"; return; }
    Object.assign(trip, {
      name: v.name.trim() || trip.name, country: v.country != null ? v.country.trim() : trip.country, destName: v.destName != null ? v.destName.trim() : trip.destName,
      travelers: parseNames(v.travelers), status: statusKey(v.status) || trip.status, wouldRepeat: v.wouldRepeat
    });
    /* retorno informado manda sobre os dias; senão, valem os dias */
    const oldEnd = trip.start ? addDays(trip.start, trip.days - 1) : "";
    let newDays = Math.max(1, Number(v.days) || trip.days);
    if (v.end && v.start && v.end !== oldEnd) newDays = Math.max(1, diffDays(v.end, v.start) + 1);
    const wasLocked = !!trip.lockPeriod;
    if (v.lock != null) trip.lockPeriod = !!v.lock;
    const own = chosenScenario(trip);
    if (trip.lockPeriod || trip.status === "concluida") {
      trip.start = v.start; trip.days = newDays;
      if (!wasLocked && trip.baseStart != null) delete trip.baseStart;
    } else {
      if (own.start) own.start = v.start; else trip.start = v.start;
      /* sem trava: a mudança de dias ajusta o último destino do cenário escolhido */
      const delta = newDays - trip.days;
      const last = [...own.segments].reverse().find(x => !x.transit) || own.segments.at(-1);
      if (delta && last) last.days = Math.max(1, last.days + delta);
    }
    commit();
  },
  backup() {
    const blob = new Blob([JSON.stringify({ trips: state.trips, destinations: state.destinations, contacts: state.contacts, deleted: state.deleted, checklistTemplate: state.checklistTemplate }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `viagens-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  restore() { document.querySelector("#restoreFile").click(); },
  async "sync-setup"() {
    const v = await ask("Sincronização", [
      { name: "token", label: "Token de acesso do GitHub", value: syncToken(), placeholder: "github_pat_…", hint: "Use o mesmo token em cada aparelho. Ele fica guardado só neste aparelho. Deixe vazio para desligar." }
    ], { confirm: "Salvar e sincronizar" });
    if (!v) return;
    try { setSyncToken(v.token.trim()); } catch { toast("Não consegui guardar o token."); return; }
    if (!v.token.trim()) { updateStatus("off"); return; }
    save();
    await sync();
    toast(getStatus() === "ok" ? "Sincronizado." : "Não consegui sincronizar. Confira o token.");
  },

  /* cenários */
  async "sc-new"() {
    const trip = currentTrip();
    const base = chosenScenario(trip);
    const v = await ask("Novo cenário", [
      { name: "name", label: "Nome", value: `Cenário ${trip.scenarios.length + 1}`, required: true },
      { name: "copy", label: `Copiar rota e custos de "${base.name}"`, type: "checkbox", value: true }
    ], { confirm: "Criar" });
    if (!v) return;
    const sc = v.copy ? cloneScenario(base) : { id: uid(), segments: [{ id: uid(), city: "Destino", days: trip.days }], costs: [] };
    sc.name = v.name.trim();
    trip.scenarios.push(sc);
    commit();
  },
  "sc-dup"(el) {
    const trip = currentTrip();
    const src = trip.scenarios.find(s => s.id === el.dataset.sc);
    const sc = cloneScenario(src);
    sc.name = `${src.name} (cópia)`;
    trip.scenarios.push(sc);
    commit(); toast("Cenário duplicado.");
  },
  async "sc-dates"(el) {
    const sc = findSc(el), trip = currentTrip();
    const v = await ask(`Datas · ${sc.name}`, [
      { name: "start", label: "Data de saída deste cenário", type: "date", value: sc.start || trip.baseStart || trip.start, hint: "Deixe igual à da viagem se não mudar. A volta é calculada pelos dias da rota." }
    ]);
    if (!v) return;
    if (v.start && v.start !== (trip.baseStart || trip.start)) sc.start = v.start; else delete sc.start;
    commit();
  },
  async "sc-rename"(el) {
    const sc = findSc(el);
    const v = await ask("Renomear cenário", [{ name: "name", label: "Nome", value: sc.name, required: true }]);
    if (v) { sc.name = v.name.trim(); commit(); }
  },
  async "sc-del"(el) {
    const trip = currentTrip();
    const sc = findSc(el);
    const ok = await ask("Excluir cenário", [{ name: "x", label: `Excluir "${sc.name}" com rota e custos?`, type: "checkbox", value: false }], { confirm: "Excluir", danger: true });
    if (!ok?.x) return;
    trip.scenarios = trip.scenarios.filter(s => s.id !== sc.id);
    if (trip.chosenId === sc.id) trip.chosenId = trip.scenarios[0].id;
    if (ui.scenarioId === sc.id) ui.scenarioId = null;
    commit();
  },
  "sc-choose"(el) { currentTrip().chosenId = el.dataset.sc; ui.scenarioId = null; commit(); toast("Cenário escolhido."); },
  "sc-view"(el) { ui.scenarioId = el.dataset.sc; render(); },
  "sc-open-costs"(el) { ui.scenarioId = el.dataset.sc; ui.tab = "custos"; render(); },
  "seg-days"(el) { const seg = findSeg(el); seg.days = Math.max(1, seg.days + Number(el.dataset.d)); commit(true); },
  "seg-move"(el) {
    const sc = findSc(el);
    const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
    [sc.segments[i], sc.segments[j]] = [sc.segments[j], sc.segments[i]];
    commit(true);
  },
  "seg-del"(el) {
    const sc = findSc(el);
    const seg = sc.segments[Number(el.dataset.i)];
    sc.segments.splice(Number(el.dataset.i), 1);
    sc.costs.forEach(c => { if (c.segId === seg.id) c.segId = ""; });
    commit(true);
  },
  async "seg-edit"(el) {
    const seg = findSeg(el);
    const v = await ask("Trecho da rota", [
      { name: "city", label: "Destino", value: seg.city, required: true },
      { name: "country", label: "País (opcional)", value: seg.country || "", placeholder: trip0().country || "Ex.: Brasil", hint: "Deixe vazio para escolher na lista de lugares." },
      { name: "days", label: "Dias", type: "number", value: seg.days, min: 1 }
    ]);
    if (!v) return;
    const city = v.city.trim(), country = v.country.trim();
    const changed = normName(city) !== normName(seg.city) || country !== (seg.country || "");
    seg.city = city; seg.days = Math.max(1, Number(v.days) || 1);
    if (changed) { seg.country = country; delete seg.lat; delete seg.lon; if (!seg.transit && !country) await pickPlaceFor(seg); }
    commit(true);
  },
  async "seg-add"(el) {
    const sc = findSc(el);
    const v = await ask("Novo destino", [
      { name: "city", label: "Destino", required: true, placeholder: "Ex.: Paris" },
      { name: "country", label: "País (opcional)", placeholder: trip0().country || "Ex.: França", hint: "Deixe vazio para escolher na lista de lugares." },
      { name: "days", label: "Dias", type: "number", value: 3, min: 1 }
    ], { confirm: "Adicionar" });
    if (!v) return;
    const seg = { id: uid(), city: v.city.trim(), days: Math.max(1, Number(v.days) || 1) };
    if (v.country.trim()) seg.country = v.country.trim(); else await pickPlaceFor(seg);
    sc.segments.push(seg);
    commit(true);
  },
  "seg-add-transit"(el) { findSc(el).segments.push({ id: uid(), city: "Deslocamento", days: 1, transit: true }); commit(true); },

  /* custos, roteiro, reservas */
  async "sc-add-item"(el) {
    const sc = findSc(el);
    const trip = currentTrip();
    const v = await ask("Adicionar item", [
      { name: "kind", label: "O que você quer lançar?", type: "select", options: ITEM_KINDS.map(k => k[0]), value: ITEM_KINDS[0][0] },
      { name: "desc", label: "Descrição (opcional)", placeholder: "Ex.: Gol SP → Natal" },
      { name: "amount", label: "Valor em reais (opcional) — passagem: por pessoa", type: "money", placeholder: "Ex.: 1.200 ou 600 x 2", hint: "Com valor, entra direto no orçamento. Sem valor, fica na lista de Custos como \"a orçar\" (lembrete); toque nele depois para lançar reserva e valor." }
    ], { confirm: "Continuar" });
    if (!v) return;
    const kind = ITEM_KINDS.find(k => k[0] === v.kind);
    const label = v.kind.replace(/^\S+\s/, "").replace(/ \(.*\)$/, "");
    let amount = null;
    if (v.amount) { amount = money2(v.amount); if (amount == null) return; }
    ui.scenarioId = sc.id;
    if (amount == null) {
      if (!kind || !kind[1]) { await editCost(sc, null); return; }
      /* sem valor: entra na lista de Custos como "a orçar" (lembrete); ao tocar, abre a reserva ligada */
      sc.costs.push({ id: uid(), desc: v.desc.trim() || label, cat: BOOKING_CAT[kind[1].type] || "Outros", bookType: kind[1].type, amount: 0, cur: "BRL", rate: 1, perPerson: false, segId: "", status: "A orçar", refundable: true });
      ui.tab = "custos";
      commit();
      toast(`${label}: na lista de custos, a orçar.`);
      return;
    }
    const desc = v.desc.trim() || label;
    const cost = { id: uid(), desc, cat: "Outros", amount, cur: "BRL", rate: 1, perPerson: false, segId: "", status: "Estimado", refundable: true };
    if (kind && kind[1]) {
      const book = { id: uid(), done: false, type: kind[1].type, desc, amount, cur: "BRL", rate: 1, paidBy: "", date: "", dateEnd: "", locator: "", link: "", attachments: [], costSynced: true };
      trip.bookings.push(book);
      cost.bookingId = book.id;
      cost.cat = BOOKING_CAT[book.type] || "Outros";
    }
    sc.costs.push(cost);
    commit();
    toast("Item lançado no orçamento.");
  },
  "cost-quick"(el) {
    const sc = findSc(el), cat = el.dataset.cat;
    sc.costs.push({ id: uid(), desc: cat, cat, amount: 0, cur: "BRL", rate: 1, perPerson: false, segId: "", status: "A orçar", refundable: true });
    commit(true);
    toast(`${cat}: marcado para orçar.`);
  },
  async "cost-add"(el) { await editCost(findSc(el), null); },
  async "cost-edit"(el) {
    const sc = findSc(el), cost = sc.costs.find(c => c.id === el.dataset.id);
    const type = cost.bookType || CAT_BOOKING[cost.cat];
    if (cost.status === "A orçar" && !cost.amount && !cost.bookingId && type) { await editBooking(null, { type, desc: cost.desc !== cost.cat ? cost.desc : "", sc, costId: cost.id }); return; }
    await editCost(sc, cost);
  },
  async "act-add"(el) { await editActivity(Number(el.dataset.day), null); },
  async "act-edit"(el) {
    const day = Number(el.dataset.day);
    await editActivity(day, (currentTrip().itinerary[day] || []).find(a => a.id === el.dataset.id));
  },
  "hoje-nav"(el) {
    const trip = currentTrip();
    const cur = ui.hojeDay ?? activeDayIndex(trip) ?? 0;
    ui.hojeDay = Math.min(trip.days - 1, Math.max(0, cur + Number(el.dataset.d)));
    render(true);
  },
  async "book-add"(el) { const m = el?.dataset?.miss != null ? missingBookings(currentTrip())[Number(el.dataset.miss)] : null; await editBooking(null, m || {}); },
  async "book-edit"(el) { await editBooking(currentTrip().bookings.find(b => b.id === el.dataset.id)); },
  "book-toggle"(el) { const b = currentTrip().bookings.find(x => x.id === el.dataset.id); b.done = !b.done; commit(true); },
  async "open-file"(el) {
    toast("Abrindo…");
    const att = { id: el.dataset.id, name: el.dataset.name, type: el.dataset.type };
    const blob = await getFileBlob(att);
    if (!blob) { toast("Arquivo ainda não está neste aparelho. Conecte-se para baixar."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  },

  /* despesas */
  async "exp-add"() { await editExpense(null, currentTrip()); },
  async "exp-quick"(el) {
    const trip = tripForAction(el);
    if (!trip) { toast("Crie uma viagem primeiro."); return; }
    await editExpense(null, trip);
  },
  async "exp-edit"(el) { const t = currentTrip(); await editExpense(t.expenses.find(e => e.id === el.dataset.id), t); },
  "exp-csv"() {
    const trip = currentTrip();
    const rows = [["Data", "Descrição", "Categoria", "Valor (R$)", "Moeda", "Valor original", "Gorjeta %", "Pago por", "Cartão", "Participantes"], ...trip.expenses.map(e => [e.date || "", e.desc, e.cat || "", expenseTotal(e).toFixed(2).replace(".", ","), e.cur || "BRL", String(e.orig ?? e.amount).replace(".", ","), e.tipPct || 0, e.paidBy, e.card ? "sim" : "", e.shares ? Object.keys(e.shares).join("; ") : e.participants.join("; ") || "Dividir depois"])];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${trip.name}-despesas.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  /* mapa */
  "map-city"(el) { ui.mapCity = el.dataset.city; render(true); },
  "map-day"(el) { ui.mapDay = el.dataset.day; ui.mapCity = ""; ui.tab = "mapa"; render(); },
  async "place-add"() { await addPlace(); },
  async "place-edit"(el) { await editPlace(placeById(el.dataset.id)); },
  "place-move"(el) {
    const trip = currentTrip();
    const list = mapPlaces(trip);
    const i = list.findIndex(p => p.id === el.dataset.id);
    const j = i + Number(el.dataset.d);
    if (j < 0 || j >= list.length) return;
    const a = trip.places.indexOf(list[i]), b = trip.places.indexOf(list[j]);
    [trip.places[a], trip.places[b]] = [trip.places[b], trip.places[a]];
    commit(true);
  },

  /* bagagem */
  "chk-toggle"(el) { const i = currentTrip().checklist.find(c => c.id === el.dataset.id); i.done = !i.done; commit(true); },
  async "chk-add"() {
    const trip = currentTrip();
    const groups = [...new Set(trip.checklist.map(i => i.group || "Outros")), "Outros"];
    const v = await ask("Novo item", [
      { name: "text", label: "Item", required: true },
      { name: "group", label: "Grupo", type: "select", options: [...new Set(groups)], value: groups[0] }
    ], { confirm: "Adicionar" });
    if (v) { trip.checklist.push({ id: uid(), group: v.group, text: v.text.trim(), done: false }); commit(true); }
  },
  async "chk-edit"(el) {
    const trip = currentTrip();
    const item = trip.checklist.find(c => c.id === el.dataset.id);
    const v = await ask("Editar item", [
      { name: "text", label: "Item", value: item.text, required: true },
      { name: "group", label: "Grupo", value: item.group },
      { name: "del", label: "Excluir este item", type: "checkbox", value: false }
    ]);
    if (!v) return;
    if (v.del) trip.checklist = trip.checklist.filter(c => c.id !== item.id);
    else Object.assign(item, { text: v.text.trim(), group: v.group.trim() || "Outros" });
    commit(true);
  },
  "chk-reset"() { currentTrip().checklist.forEach(c => { c.done = false; }); commit(true); },
  "chk-save-template"() {
    setTemplate(currentTrip().checklist.map(c => ({ group: c.group, text: c.text })));
    toast("Lista padrão atualizada. Novas viagens vão usá-la.");
  },
  "chk-load-template"() {
    const trip = currentTrip();
    const have = new Set(trip.checklist.map(c => c.text.toLowerCase()));
    state.checklistTemplate.filter(t => !have.has(t.text.toLowerCase())).forEach(t => trip.checklist.push({ id: uid(), group: t.group, text: t.text, done: false }));
    commit(true);
  },

  /* destinos */
  async "dest-add"() { await editDest(null); },
  async "dest-menu"(el) { await editDest(destById(el.dataset.id)); },
  "dest-repeat"(el) { destById(el.dataset.id).repeat = el.checked; save(); },
  async "dest-edit-summary"(el) {
    const d = destById(el.dataset.id);
    const v = await ask("Resumo do destino", [
      { name: "rating", label: "Minha nota (0 a 10)", type: "number", value: d.rating ?? "", min: 0, step: "0.5" },
      { name: "bestSeason", label: "Melhor época para ir", value: d.bestSeason, placeholder: "Ex.: novembro a fevereiro" },
      { name: "pros", label: "Pontos fortes", type: "textarea", value: d.pros },
      { name: "cons", label: "Pontos fracos", type: "textarea", value: d.cons },
      { name: "perrengues", label: "Perrengues", type: "textarea", value: d.perrengues }
    ]);
    if (v) {
      const nota = v.rating === "" || v.rating == null ? null : Math.min(10, Math.max(0, Number(v.rating)));
      Object.assign(d, { rating: Number.isFinite(nota) ? nota : null, bestSeason: (v.bestSeason || "").trim(), pros: v.pros.trim(), cons: v.cons.trim(), perrengues: v.perrengues.trim() });
      commit(true);
    }
  },
  async "dest-edit-transport"(el) {
    const d = destById(el.dataset.id);
    const t = d.transport || {};
    const v = await ask("Transporte", [
      { name: "use", label: "O que usar", value: t.use, placeholder: "Ex.: metrô e a pé" },
      { name: "car", label: "Vale a pena alugar carro?", type: "select", options: ["—", "Sim, vale", "Não vale", "Depende do roteiro"], value: t.car || "—" },
      { name: "metro", label: "Tem metrô?", type: "select", options: ["—", "Sim", "Não", "Só em parte"], value: t.metro || "—" },
      { name: "notes", label: "Notas", type: "textarea", value: t.notes }
    ]);
    if (v) { d.transport = { use: v.use.trim(), car: v.car === "—" ? "" : v.car, metro: v.metro === "—" ? "" : v.metro, notes: v.notes.trim() }; commit(true); }
  },
  async "dest-edit-lodging"(el) {
    const d = destById(el.dataset.id);
    const l = d.lodging || {};
    const v = await ask("Hospedagem", [
      { name: "range", label: "Faixa de preço", type: "select", options: ["—", "$", "$$", "$$$"], value: l.range || "—" },
      { name: "options", label: "Quantidade de opções", value: l.options, placeholder: "Ex.: poucas, muitas, ~50" },
      { name: "notes", label: "Notas (bairros, dicas)", type: "textarea", value: l.notes }
    ]);
    if (v) { d.lodging = { range: v.range === "—" ? "" : v.range, options: v.options.trim(), notes: v.notes.trim() }; commit(true); }
  },
  async "dest-edit-visa"(el) {
    const d = destById(el.dataset.id);
    const s = d.visa || {};
    const v = await ask("Visto", [
      { name: "needed", label: "Precisa de visto?", type: "select", options: ["—", "Sim", "Não", "Depende"], value: s.needed || "—" },
      { name: "requirements", label: "Requisitos", type: "textarea", value: s.requirements }
    ]);
    if (v) { d.visa = { needed: v.needed === "—" ? "" : v.needed, requirements: v.requirements.trim() }; commit(true); }
  },
  async "attr-add"(el) {
    const d = destById(el.dataset.id);
    const v = await ask("Novo ponto turístico", [{ name: "name", label: "Nome", required: true }], { confirm: "Adicionar" });
    if (v) { (d.attractions ||= []).push({ id: uid(), name: v.name.trim(), visited: false }); commit(true); }
  },
  "attr-toggle"(el) { const a = destById(el.dataset.id).attractions.find(x => x.id === el.dataset.a); a.visited = !a.visited; commit(true); },
  async "attr-edit"(el) {
    const d = destById(el.dataset.id);
    const a = d.attractions.find(x => x.id === el.dataset.a);
    const v = await ask("Ponto turístico", [{ name: "name", label: "Nome", value: a.name, required: true }, { name: "del", label: "Excluir", type: "checkbox", value: false }]);
    if (!v) return;
    if (v.del) d.attractions = d.attractions.filter(x => x.id !== a.id); else a.name = v.name.trim();
    commit(true);
  },
  async "food-add"(el) {
    const d = destById(el.dataset.id);
    const v = await ask("Novo lugar para comer", [{ name: "name", label: "Nome", required: true }, { name: "note", label: "Observação", type: "textarea" }], { confirm: "Adicionar" });
    if (v) { (d.food ||= []).push({ id: uid(), name: v.name.trim(), note: v.note.trim() }); commit(true); }
  },
  async "food-edit"(el) {
    const d = destById(el.dataset.id);
    const f = d.food.find(x => x.id === el.dataset.a);
    const v = await ask("Lugar para comer", [{ name: "name", label: "Nome", value: f.name, required: true }, { name: "note", label: "Observação", type: "textarea", value: f.note }, { name: "del", label: "Excluir", type: "checkbox", value: false }]);
    if (!v) return;
    if (v.del) d.food = d.food.filter(x => x.id !== f.id); else Object.assign(f, { name: v.name.trim(), note: v.note.trim() });
    commit(true);
  },
  async "contact-add"(el) { await editContact(null, el.dataset.dest); },
  async "contact-edit"(el) { await editContact(state.contacts.find(c => c.id === el.dataset.id)); }
};

/* ---------- eventos ---------- */
document.addEventListener("click", event => {
  const open = event.target.closest("[data-open-hoje]");
  if (open) { const t = state.trips.find(x => x.id === open.dataset.openHoje); ui.tripId = t.id; ui.tab = "hoje"; ui.hojeDay = null; return; }
  const goto = event.target.closest("[data-goto-tab]");
  if (goto) { ui.tripId = goto.getAttribute("href").split("/").pop(); ui.tab = goto.dataset.gotoTab; return; }
  const home = event.target.closest("[data-home]");
  if (home) { ui.home = home.dataset.home; render(); return; }
  const tab = event.target.closest("[data-tab]");
  if (tab) { ui.tab = tab.dataset.tab; render(); return; }
  const el = event.target.closest("[data-act]");
  if (!el || el.tagName === "INPUT") return;
  if (actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener("change", event => {
  const t = event.target;
  if (t.matches("input[data-act=dest-repeat]")) { actions["dest-repeat"](t); return; }
  if (t.id === "mapDaySel") { ui.mapDay = t.value; render(true); return; }
  if (t.id !== "restoreFile") return;
  const file = t.files[0];
  if (!file) return;
  file.text().then(text => {
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data.trips)) throw new Error();
      replaceAll(data);
      render();
      toast("Backup importado.");
    } catch { toast("Arquivo de backup inválido."); }
  });
});
/* arrastar e soltar a ordem dos locais (computador) */
let dragId = null;
document.addEventListener("dragstart", e => { const row = e.target.closest?.("[data-pid]"); if (row) { dragId = row.dataset.pid; e.dataTransfer.effectAllowed = "move"; } });
document.addEventListener("dragover", e => { if (dragId && e.target.closest?.("[data-pid]")) e.preventDefault(); });
document.addEventListener("drop", e => {
  const row = e.target.closest?.("[data-pid]");
  if (!dragId || !row || row.dataset.pid === dragId) { dragId = null; return; }
  e.preventDefault();
  const trip = currentTrip();
  const from = trip.places.findIndex(p => p.id === dragId);
  const [moved] = trip.places.splice(from, 1);
  const to = trip.places.findIndex(p => p.id === row.dataset.pid);
  trip.places.splice(to, 0, moved);
  dragId = null;
  commit(true);
});
window.addEventListener("hashchange", () => { ui.scenarioId = null; render(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
window.addEventListener("online", () => sync());

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./service-worker.js").catch(() => {});

/* abre direto no dia da viagem em andamento */
(function boot() {
  const act = activeTrip();
  const r = route();
  if (act && (r[0] === "" || r[0] === undefined) && !sessionStorage.getItem("autoOpened")) {
    try { sessionStorage.setItem("autoOpened", "1"); } catch { /* ignora */ }
    ui.tripId = act.id; ui.tab = "hoje";
    location.hash = `#/t/${act.id}`;
    return;
  }
  render();
})();
sync();
