import { parseMoneyExpression, calculateBalances, settle } from "./core.js";

const STORAGE_KEY = "planejador-viagens-v4";
const CATEGORIES = ["Passagens", "Hospedagem", "Transporte", "Alimentação", "Passeios", "Seguro", "Chip/Internet", "Câmbio e taxas", "Outros"];
const CAT_ICON = { Passagens: "✈", Hospedagem: "🛏", Transporte: "🚗", Alimentação: "🍽", Passeios: "🎟", Seguro: "🛡", "Chip/Internet": "📶", "Câmbio e taxas": "💱", Outros: "•" };
const COST_STATUS = ["Estimado", "Reservado", "Pago"];
const BOOKING_TYPES = ["Voo", "Hotel", "Carro", "Transfer", "Ingresso", "Seguro", "Outro"];
const TRIP_STATUS = { rascunho: "Rascunho", planejada: "Planejada", andamento: "Em andamento", concluida: "Concluída" };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = value => money.format(value || 0);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- estado ---------- */
let state = load();
const ui = { tab: "cenarios", scenarioId: null };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.trips) return saved;
  } catch { /* começa vazio */ }
  return { trips: [] };
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { toast("Não consegui salvar neste navegador."); }
}
function commit() { save(); render(); }

function newTrip({ name, days, travelers, start }) {
  const scenario = { id: uid(), name: "Cenário 1", segments: [{ id: uid(), city: "Destino", days }], costs: [] };
  return {
    id: uid(), name, days, start: start || "", travelers, status: "rascunho",
    scenarios: [scenario], chosenId: scenario.id,
    expenses: [], itinerary: {}, bookings: []
  };
}

/* ---------- cálculos ---------- */
const route = () => location.hash.replace(/^#\/?/, "").split("/");
const currentTrip = () => { const r = route(); return r[0] === "t" ? state.trips.find(t => t.id === r[1]) : null; };
const activeScenario = trip => trip.scenarios.find(s => s.id === ui.scenarioId) || trip.scenarios.find(s => s.id === trip.chosenId) || trip.scenarios[0];

function costTotal(cost, trip) {
  const unit = cost.perPerson ? trip.travelers.length : 1;
  return cost.amount * (cost.rate || 1) * unit;
}
function scenarioStats(scenario, trip) {
  const total = scenario.costs.reduce((sum, c) => sum + costTotal(c, trip), 0);
  const used = scenario.segments.reduce((sum, s) => sum + s.days, 0);
  const cities = scenario.segments.filter(s => !s.transit);
  const transitDays = scenario.segments.filter(s => s.transit).reduce((sum, s) => sum + s.days, 0);
  const nonRefundable = scenario.costs.filter(c => c.status !== "Estimado").reduce((sum, c) => sum + costTotal(c, trip), 0);
  return {
    total, used, free: trip.days - used, cities: cities.length, transitDays,
    hotelChanges: Math.max(0, cities.length - 1),
    perPerson: total / trip.travelers.length,
    perDay: total / Math.max(1, trip.days),
    committed: nonRefundable,
    nights: Math.max(0, trip.days - 1)
  };
}
function dateFor(trip, dayIndex) {
  if (!trip.start) return null;
  const d = new Date(`${trip.start}T12:00:00`);
  d.setDate(d.getDate() + dayIndex);
  return d;
}
const fmtDate = d => d ? d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(".", "") : "";

/* ---------- UI helpers ---------- */
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2400);
}

const sheet = document.querySelector("#sheet");
const sheetForm = document.querySelector("#sheetForm");
/** Abre um formulário em folha e devolve os valores (ou null). */
function ask(title, fields, { confirm = "Salvar", danger = false } = {}) {
  return new Promise(resolve => {
    const body = fields.map(f => {
      if (f.type === "select") {
        return `<label>${esc(f.label)}<select name="${f.name}">${f.options.map(o => `<option ${o === f.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
      }
      if (f.type === "checks") {
        return `<fieldset><legend>${esc(f.label)}</legend><div class="chips">${f.options.map(o => `<label class="chip"><input type="checkbox" name="${f.name}" value="${esc(o)}" ${f.value.includes(o) ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div></fieldset>`;
      }
      if (f.type === "checkbox") {
        return `<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? "checked" : ""}><span>${esc(f.label)}</span></label>`;
      }
      if (f.type === "textarea") {
        return `<label>${esc(f.label)}<textarea name="${f.name}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea></label>`;
      }
      const attrs = f.type === "money" ? 'inputmode="decimal" autocomplete="off"' : "";
      const type = f.type === "money" ? "text" : f.type || "text";
      return `<label>${esc(f.label)}<input type="${type}" name="${f.name}" value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder || "")}" ${f.required ? "required" : ""} ${f.min != null ? `min="${f.min}"` : ""} ${attrs}></label>${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ""}`;
    }).join("");
    sheetForm.innerHTML = `
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">×</button></div>
      <div class="sheet-body">${body}</div>
      <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? "danger" : "primary"}" value="ok">${esc(confirm)}</button></div>`;
    const finish = value => { sheet.close(); sheet.onclose = null; resolve(value); };
    sheet.onclose = () => resolve(null);
    sheetForm.onsubmit = event => {
      event.preventDefault();
      const data = new FormData(sheetForm);
      const out = {};
      for (const f of fields) {
        if (f.type === "checks") out[f.name] = data.getAll(f.name);
        else if (f.type === "checkbox") out[f.name] = data.has(f.name);
        else out[f.name] = data.get(f.name);
      }
      finish(out);
    };
    sheetForm.querySelectorAll("[data-close]").forEach(b => b.onclick = () => finish(null));
    sheet.showModal();
    sheetForm.querySelector("input:not([type=checkbox]),textarea,select")?.focus();
  });
}
function money2(raw) {
  try { return parseMoneyExpression(raw); } catch { toast("Valor ou cálculo inválido."); return null; }
}

/* ---------- renderização ---------- */
function render() {
  const app = document.querySelector("#app");
  const trip = currentTrip();
  if (route()[0] === "t" && !trip) { location.hash = "#/"; return; }
  app.innerHTML = trip ? renderTrip(trip) : renderHome();
  window.scrollTo(0, 0);
}

function renderHome() {
  const sorted = [...state.trips].sort((a, b) => (a.status === "rascunho") - (b.status === "rascunho"));
  const cards = sorted.map(trip => {
    const sc = trip.scenarios.find(s => s.id === trip.chosenId) || trip.scenarios[0];
    const st = scenarioStats(sc, trip);
    const cities = sc.segments.filter(s => !s.transit).map(s => s.city).join(" → ");
    return `<a class="trip-card ${trip.status}" href="#/t/${trip.id}">
      <div class="trip-card-top"><span class="pill ${trip.status}">${TRIP_STATUS[trip.status]}</span>${trip.scenarios.length > 1 ? `<span class="muted">${trip.scenarios.length} cenários</span>` : ""}</div>
      <h2>${esc(trip.name)}</h2>
      <p class="muted">${esc(cities)}</p>
      <div class="trip-card-foot">
        <div><small>${plural(trip.days, "dia", "dias")} · ${plural(trip.travelers.length, "pessoa", "pessoas")}</small></div>
        <div class="num"><small>${trip.status === "rascunho" ? "estimativa" : "orçamento"}</small><strong>${brl(st.total)}</strong></div>
      </div>
    </a>`;
  }).join("");
  return `<header class="home-head">
      <div><p class="eyebrow">Planejador</p><h1>Minhas viagens</h1></div>
      <button class="btn primary" data-act="new-trip">+ Nova viagem</button>
    </header>
    <main class="home">
      ${cards || `<div class="empty big"><div class="empty-art">✈</div><h2>Nenhuma viagem ainda</h2><p>Comece com um rascunho: monte cenários de rota, compare custos e depois confirme a melhor opção.</p><button class="btn primary" data-act="new-trip">Criar primeira viagem</button></div>`}
    </main>
    <footer class="home-foot">
      <button class="link" data-act="backup">Exportar backup</button>
      <button class="link" data-act="restore">Importar backup</button>
      <input type="file" id="restoreFile" accept="application/json" hidden>
    </footer>`;
}

function renderTrip(trip) {
  const sc = activeScenario(trip);
  const st = scenarioStats(sc, trip);
  const tabs = [["cenarios", "Cenários"], ["custos", "Custos"], ["roteiro", "Roteiro"], ["reservas", "Reservas"], ["despesas", "Despesas"]];
  const content = { cenarios: tabScenarios, custos: tabCosts, roteiro: tabItinerary, reservas: tabBookings, despesas: tabExpenses }[ui.tab](trip, sc);
  const dateLine = trip.start ? `${fmtDate(dateFor(trip, 0))} → ${fmtDate(dateFor(trip, trip.days - 1))}` : "Datas em aberto";
  return `<header class="trip-head">
      <div class="trip-head-top">
        <a class="back" href="#/" aria-label="Voltar">‹</a>
        <button class="icon-btn" data-act="trip-menu" aria-label="Opções da viagem">⋯</button>
      </div>
      <span class="pill ${trip.status}">${TRIP_STATUS[trip.status]}</span>
      <h1>${esc(trip.name)}</h1>
      <p class="muted">${dateLine} · ${plural(trip.days, "dia", "dias")} · ${plural(trip.travelers.length, "pessoa", "pessoas")}</p>
      <div class="kpis">
        <div><small>${trip.scenarios.length > 1 ? esc(sc.name) : "Total"}</small><strong>${brl(st.total)}</strong></div>
        <div><small>Por pessoa</small><strong>${brl(st.perPerson)}</strong></div>
        <div><small>Por dia</small><strong>${brl(st.perDay)}</strong></div>
      </div>
    </header>
    <nav class="tabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" class="${ui.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`).join("")}</nav>
    <main class="tab-body">${content}</main>`;
}

/* --- Cenários --- */
function tabScenarios(trip) {
  const cards = trip.scenarios.map(sc => {
    const st = scenarioStats(sc, trip);
    const chosen = sc.id === trip.chosenId;
    const diff = st.free;
    const note = diff === 0 ? `<span class="ok">✓ ${trip.days} dias distribuídos</span>`
      : diff > 0 ? `<span class="warn">${plural(diff, "dia livre", "dias livres")}</span>`
      : `<span class="bad">${plural(-diff, "dia", "dias")} acima do período</span>`;
    const total = trip.days || 1;
    const bar = sc.segments.map(s => `<i class="${s.transit ? "transit" : ""}" style="flex:${s.days}" title="${esc(s.city)}"></i>`).join("") + (diff > 0 ? `<i class="free" style="flex:${diff}"></i>` : "");
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
      <div class="card-head">
        <div><h2>${esc(sc.name)}</h2>${note}</div>
        ${chosen ? `<span class="pill chosen">Escolhido</span>` : ""}
      </div>
      <div class="routebar" aria-hidden="true">${bar}</div>
      <div class="route-text">${sc.segments.map(s => `${esc(s.city)} <b>${s.days}</b>`).join(" · ")}</div>
      <div class="segs">${rows}</div>
      <div class="inline-actions">
        <button class="btn soft sm" data-act="seg-add" data-sc="${sc.id}">+ Destino</button>
        <button class="btn soft sm" data-act="seg-add-transit" data-sc="${sc.id}">+ Deslocamento</button>
      </div>
      <dl class="metrics">
        <div><dt>Total</dt><dd>${brl(st.total)}</dd></div>
        <div><dt>Por pessoa</dt><dd>${brl(st.perPerson)}</dd></div>
        <div><dt>Destinos</dt><dd>${st.cities}</dd></div>
        <div><dt>Trocas de hotel</dt><dd>${st.hotelChanges}</dd></div>
      </dl>
      <div class="card-actions">
        ${chosen ? "" : `<button class="btn primary sm" data-act="sc-choose" data-sc="${sc.id}">Escolher este</button>`}
        <button class="btn ghost sm" data-act="sc-open-costs" data-sc="${sc.id}">Custos</button>
        <button class="btn ghost sm" data-act="sc-dup" data-sc="${sc.id}">Duplicar</button>
        <button class="btn ghost sm" data-act="sc-rename" data-sc="${sc.id}">Renomear</button>
        ${trip.scenarios.length > 1 ? `<button class="btn ghost sm danger-text" data-act="sc-del" data-sc="${sc.id}">Excluir</button>` : ""}
      </div>
    </article>`;
  }).join("");

  const compare = trip.scenarios.length > 1 ? renderCompare(trip) : "";
  return `<div class="section-head"><p class="muted">Monte rotas diferentes dentro do mesmo período e compare lado a lado.</p><button class="btn soft" data-act="sc-new">+ Novo cenário</button></div>
    <div class="cards">${cards}</div>${compare}`;
}

function renderCompare(trip) {
  const stats = trip.scenarios.map(sc => ({ sc, st: scenarioStats(sc, trip) }));
  const cheapest = Math.min(...stats.map(x => x.st.total));
  const row = (label, fn, best) => `<tr><th>${label}</th>${stats.map(({ sc, st }) => `<td class="${best && best(st) ? "best" : ""}">${fn(st, sc)}</td>`).join("")}</tr>`;
  return `<section class="card compare">
    <h2>Comparação</h2>
    <div class="table-scroll"><table>
      <thead><tr><th></th>${stats.map(({ sc }) => `<th>${esc(sc.name)}${sc.id === trip.chosenId ? " ✓" : ""}</th>`).join("")}</tr></thead>
      <tbody>
        ${row("Total", st => brl(st.total), st => st.total === cheapest && stats.length > 1)}
        ${row("Por pessoa", st => brl(st.perPerson))}
        ${row("Por dia", st => brl(st.perDay))}
        ${row("Destinos", st => st.cities)}
        ${row("Trocas de hotel", st => st.hotelChanges)}
        ${row("Dias em deslocamento", st => st.transitDays)}
        ${row("Dias sem destino", st => st.free > 0 ? st.free : "—")}
        ${row("Já reservado/pago", st => brl(st.committed))}
      </tbody>
    </table></div>
  </section>`;
}

/* --- Custos --- */
function tabCosts(trip, sc) {
  const st = scenarioStats(sc, trip);
  const picker = trip.scenarios.length > 1
    ? `<div class="chips scroll">${trip.scenarios.map(s => `<button class="chip-btn ${s.id === sc.id ? "active" : ""}" data-act="sc-view" data-sc="${s.id}">${esc(s.name)}${s.id === trip.chosenId ? " ✓" : ""}</button>`).join("")}</div>`
    : "";
  const groups = CATEGORIES.map(cat => {
    const items = sc.costs.filter(c => c.cat === cat);
    if (!items.length) return "";
    const sub = items.reduce((sum, c) => sum + costTotal(c, trip), 0);
    return `<section class="group">
      <div class="group-head"><span>${CAT_ICON[cat]} ${cat}</span><strong>${brl(sub)}</strong></div>
      ${items.map(c => {
        const seg = c.segId ? sc.segments.find(s => s.id === c.segId) : null;
        const detail = [seg ? seg.city : "Geral", c.cur && c.cur !== "BRL" ? `${c.amount.toLocaleString("pt-BR")} ${c.cur} × ${c.rate}` : "", c.perPerson ? `por pessoa × ${trip.travelers.length}` : "", c.refundable === false ? "não reembolsável" : ""].filter(Boolean).join(" · ");
        return `<button class="row" data-act="cost-edit" data-sc="${sc.id}" data-id="${c.id}">
          <div><strong>${esc(c.desc)}</strong><small>${esc(detail)}</small></div>
          <div class="row-right"><b>${brl(costTotal(c, trip))}</b><span class="tag ${c.status}">${c.status}</span></div>
        </button>`;
      }).join("")}
    </section>`;
  }).join("");
  return `${picker}
    <div class="section-head"><p class="muted">Custos de <b>${esc(sc.name)}</b>. Aceita cálculos: <code>2.400 ÷ 4</code> ou <code>180 x 7</code>.</p><button class="btn primary" data-act="cost-add" data-sc="${sc.id}">+ Custo</button></div>
    ${groups || `<div class="empty"><p>Nenhum custo neste cenário ainda.</p></div>`}
    ${sc.costs.length ? `<div class="card total-card"><div><small>Total do cenário</small><strong>${brl(st.total)}</strong></div><div><small>Por pessoa</small><strong>${brl(st.perPerson)}</strong></div><div><small>Por dia</small><strong>${brl(st.perDay)}</strong></div></div>` : ""}`;
}

/* --- Roteiro --- */
function itineraryDays(trip) {
  const sc = trip.scenarios.find(s => s.id === trip.chosenId) || trip.scenarios[0];
  const days = [];
  for (const seg of sc.segments) for (let i = 0; i < seg.days; i += 1) days.push({ city: seg.city, transit: seg.transit });
  while (days.length < trip.days) days.push({ city: "A definir", transit: false });
  return days;
}
function tabItinerary(trip) {
  const days = itineraryDays(trip);
  const sc = trip.scenarios.find(s => s.id === trip.chosenId);
  const warn = trip.status === "rascunho" ? `<p class="notice">Este é o roteiro do cenário escolhido (<b>${esc(sc.name)}</b>). Ele ainda pode mudar enquanto a viagem for rascunho.</p>` : "";
  let lastCity = null;
  const html = days.map((day, i) => {
    const items = (trip.itinerary[i] || []).slice().sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
    const date = dateFor(trip, i);
    const header = day.city !== lastCity ? `<div class="city-sep">${esc(day.city)}</div>` : "";
    lastCity = day.city;
    return `${header}<article class="day">
      <div class="day-head"><div><span class="day-n">Dia ${i + 1}</span>${date ? `<span class="muted"> · ${fmtDate(date)}</span>` : ""}</div>
        <button class="btn soft sm" data-act="act-add" data-day="${i}">+ Atividade</button></div>
      ${items.length ? `<ul class="acts">${items.map(a => `<li><button data-act="act-edit" data-day="${i}" data-id="${a.id}">
          <span class="time">${esc(a.time || "—")}</span>
          <span class="act-main"><strong>${esc(a.title)}</strong>${a.note ? `<small>${esc(a.note)}</small>` : ""}</span>
          ${a.cost ? `<span class="act-cost">${brl(a.cost)}</span>` : ""}
        </button></li>`).join("")}</ul>` : `<p class="muted tiny">Sem atividades.</p>`}
    </article>`;
  }).join("");
  return `${warn}<div class="days">${html}</div>`;
}

/* --- Reservas --- */
function tabBookings(trip) {
  const open = trip.bookings.filter(b => !b.done);
  const done = trip.bookings.filter(b => b.done);
  const item = b => `<div class="booking ${b.done ? "done" : ""}">
    <button class="check-btn" data-act="book-toggle" data-id="${b.id}" aria-label="Marcar como feito">${b.done ? "✓" : ""}</button>
    <button class="booking-main" data-act="book-edit" data-id="${b.id}">
      <strong>${esc(b.desc)}</strong>
      <small>${[b.type, b.locator ? `Localizador ${esc(b.locator)}` : "", b.deadline ? `Prazo ${new Date(`${b.deadline}T12:00`).toLocaleDateString("pt-BR")}` : ""].filter(Boolean).join(" · ")}</small>
    </button></div>`;
  return `<div class="section-head"><p class="muted">O que falta reservar, localizadores e prazos de pagamento ou cancelamento.</p><button class="btn primary" data-act="book-add">+ Reserva</button></div>
    ${open.length ? `<div class="card list">${open.map(item).join("")}</div>` : `<div class="empty"><p>Nada pendente.</p></div>`}
    ${done.length ? `<h3 class="sub">Concluídas</h3><div class="card list">${done.map(item).join("")}</div>` : ""}`;
}

/* --- Despesas --- */
function tabExpenses(trip) {
  const balances = calculateBalances(trip.expenses, trip.travelers);
  const moves = settle(balances);
  const pending = trip.expenses.filter(e => !e.participants.length);
  const total = trip.expenses.reduce((s, e) => s + e.amount, 0);
  const balRows = Object.entries(balances).map(([name, v]) => `<div class="bal"><span>${esc(name)}</span><b class="${v > 0.005 ? "pos" : v < -0.005 ? "neg" : ""}">${v > 0.005 ? "recebe " : v < -0.005 ? "deve " : "quitado "}${Math.abs(v) > 0.005 ? brl(Math.abs(v)) : ""}</b></div>`).join("");
  return `<div class="section-head"><p class="muted">Lance o que foi pago e quem divide. Aceita cálculos: <code>2.400 ÷ 4</code>.</p><button class="btn primary" data-act="exp-add">+ Despesa</button></div>
    ${trip.expenses.length ? `<section class="card">
      <h2>Saldos</h2>${balRows}
      ${moves.length ? `<div class="moves">${moves.map(m => `<p><b>${esc(m.from)}</b> paga <b>${brl(m.amount)}</b> a <b>${esc(m.to)}</b></p>`).join("")}</div>` : ""}
      ${pending.length ? `<p class="notice">${plural(pending.length, "despesa aguardando divisão", "despesas aguardando divisão")}.</p>` : ""}
    </section>
    <section class="card list">
      <div class="group-head"><span>Lançamentos</span><strong>${brl(total)}</strong></div>
      ${trip.expenses.slice().reverse().map(e => `<button class="row" data-act="exp-edit" data-id="${e.id}">
        <div><strong>${esc(e.desc)}</strong><small>Pago por ${esc(e.paidBy)} · ${e.participants.length ? `${brl(e.amount / e.participants.length)} × ${e.participants.length}` : "dividir depois"}</small></div>
        <div class="row-right"><b>${brl(e.amount)}</b></div></button>`).join("")}
    </section>
    <div class="inline-actions"><button class="btn ghost sm" data-act="exp-csv">Exportar CSV</button></div>`
    : `<div class="empty"><p>Nenhuma despesa lançada.</p></div>`}`;
}

/* ---------- ações ---------- */
const actions = {
  async "new-trip"() {
    const v = await ask("Nova viagem", [
      { name: "name", label: "Nome", required: true, placeholder: "Ex.: Europa 2027" },
      { name: "days", label: "Duração (dias)", type: "number", value: 15, min: 1, required: true },
      { name: "start", label: "Data de saída (opcional)", type: "date" },
      { name: "travelers", label: "Viajantes", value: "Eu", hint: "Separe por vírgula. Ex.: Eduardo, Ana", required: true }
    ], { confirm: "Criar rascunho" });
    if (!v) return;
    const travelers = v.travelers.split(",").map(s => s.trim()).filter(Boolean);
    const trip = newTrip({ name: v.name.trim(), days: Math.max(1, Number(v.days)), travelers: travelers.length ? travelers : ["Eu"], start: v.start });
    state.trips.push(trip);
    ui.tab = "cenarios"; ui.scenarioId = null;
    save();
    location.hash = `#/t/${trip.id}`;
  },

  async "trip-menu"() {
    const trip = currentTrip();
    const v = await ask("Opções da viagem", [
      { name: "name", label: "Nome", value: trip.name, required: true },
      { name: "days", label: "Duração (dias)", type: "number", value: trip.days, min: 1 },
      { name: "start", label: "Data de saída", type: "date", value: trip.start },
      { name: "travelers", label: "Viajantes", value: trip.travelers.join(", ") },
      { name: "status", label: "Situação", type: "select", options: Object.values(TRIP_STATUS), value: TRIP_STATUS[trip.status] },
      { name: "del", label: "Excluir esta viagem", type: "checkbox", value: false }
    ]);
    if (!v) return;
    if (v.del) { state.trips = state.trips.filter(t => t.id !== trip.id); save(); location.hash = "#/"; return; }
    trip.name = v.name.trim() || trip.name;
    trip.days = Math.max(1, Number(v.days) || trip.days);
    trip.start = v.start;
    const names = v.travelers.split(",").map(s => s.trim()).filter(Boolean);
    if (names.length) trip.travelers = names;
    trip.status = Object.entries(TRIP_STATUS).find(([, label]) => label === v.status)?.[0] || trip.status;
    commit();
  },

  backup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `viagens-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  restore() { document.querySelector("#restoreFile").click(); },

  /* cenários */
  async "sc-new"() {
    const trip = currentTrip();
    const base = trip.scenarios.find(s => s.id === trip.chosenId);
    const v = await ask("Novo cenário", [
      { name: "name", label: "Nome", value: `Cenário ${trip.scenarios.length + 1}`, required: true },
      { name: "copy", label: `Copiar rota e custos de "${base.name}"`, type: "checkbox", value: true }
    ], { confirm: "Criar" });
    if (!v) return;
    const sc = v.copy ? cloneScenario(base, trip) : { id: uid(), segments: [{ id: uid(), city: "Destino", days: trip.days }], costs: [] };
    sc.name = v.name.trim();
    trip.scenarios.push(sc);
    commit();
  },
  "sc-dup"(el) {
    const trip = currentTrip();
    const src = trip.scenarios.find(s => s.id === el.dataset.sc);
    const sc = cloneScenario(src, trip);
    sc.name = `${src.name} (cópia)`;
    trip.scenarios.push(sc);
    commit(); toast("Cenário duplicado.");
  },
  async "sc-rename"(el) {
    const trip = currentTrip();
    const sc = trip.scenarios.find(s => s.id === el.dataset.sc);
    const v = await ask("Renomear cenário", [{ name: "name", label: "Nome", value: sc.name, required: true }]);
    if (v) { sc.name = v.name.trim(); commit(); }
  },
  async "sc-del"(el) {
    const trip = currentTrip();
    const sc = trip.scenarios.find(s => s.id === el.dataset.sc);
    const ok = await ask("Excluir cenário", [{ name: "x", label: `Excluir "${sc.name}" com rota e custos?`, type: "checkbox", value: false }], { confirm: "Excluir", danger: true });
    if (!ok?.x) return;
    trip.scenarios = trip.scenarios.filter(s => s.id !== sc.id);
    if (trip.chosenId === sc.id) trip.chosenId = trip.scenarios[0].id;
    if (ui.scenarioId === sc.id) ui.scenarioId = null;
    commit();
  },
  "sc-choose"(el) {
    const trip = currentTrip();
    trip.chosenId = el.dataset.sc; ui.scenarioId = null;
    commit(); toast("Cenário escolhido.");
  },
  "sc-view"(el) { ui.scenarioId = el.dataset.sc; render(); },
  "sc-open-costs"(el) { ui.scenarioId = el.dataset.sc; ui.tab = "custos"; render(); },

  /* trechos */
  "seg-days"(el) {
    const seg = findSeg(el);
    seg.days = Math.max(1, seg.days + Number(el.dataset.d));
    commit();
  },
  "seg-move"(el) {
    const sc = findSc(el);
    const i = Number(el.dataset.i), j = i + Number(el.dataset.d);
    [sc.segments[i], sc.segments[j]] = [sc.segments[j], sc.segments[i]];
    commit();
  },
  async "seg-del"(el) {
    const sc = findSc(el);
    const seg = sc.segments[Number(el.dataset.i)];
    sc.segments.splice(Number(el.dataset.i), 1);
    sc.costs.forEach(c => { if (c.segId === seg.id) c.segId = ""; });
    commit();
  },
  async "seg-edit"(el) {
    const seg = findSeg(el);
    const v = await ask("Trecho da rota", [
      { name: "city", label: "Destino", value: seg.city, required: true },
      { name: "days", label: "Dias", type: "number", value: seg.days, min: 1 }
    ]);
    if (v) { seg.city = v.city.trim(); seg.days = Math.max(1, Number(v.days) || 1); commit(); }
  },
  async "seg-add"(el) {
    const sc = findSc(el);
    const v = await ask("Novo destino", [
      { name: "city", label: "Destino", required: true, placeholder: "Ex.: Paris" },
      { name: "days", label: "Dias", type: "number", value: 3, min: 1 }
    ], { confirm: "Adicionar" });
    if (v) { sc.segments.push({ id: uid(), city: v.city.trim(), days: Math.max(1, Number(v.days) || 1) }); commit(); }
  },
  "seg-add-transit"(el) {
    const sc = findSc(el);
    sc.segments.push({ id: uid(), city: "Deslocamento", days: 1, transit: true });
    commit();
  },

  /* custos */
  async "cost-add"(el) { await editCost(findSc(el), null); },
  async "cost-edit"(el) {
    const sc = findSc(el);
    await editCost(sc, sc.costs.find(c => c.id === el.dataset.id));
  },

  /* roteiro */
  async "act-add"(el) { await editActivity(Number(el.dataset.day), null); },
  async "act-edit"(el) {
    const day = Number(el.dataset.day);
    await editActivity(day, (currentTrip().itinerary[day] || []).find(a => a.id === el.dataset.id));
  },

  /* reservas */
  async "book-add"() { await editBooking(null); },
  async "book-edit"(el) { await editBooking(currentTrip().bookings.find(b => b.id === el.dataset.id)); },
  "book-toggle"(el) {
    const b = currentTrip().bookings.find(x => x.id === el.dataset.id);
    b.done = !b.done; commit();
  },

  /* despesas */
  async "exp-add"() { await editExpense(null); },
  async "exp-edit"(el) { await editExpense(currentTrip().expenses.find(e => e.id === el.dataset.id)); },
  "exp-csv"() {
    const trip = currentTrip();
    const rows = [["Descrição", "Valor", "Pago por", "Participantes"], ...trip.expenses.map(e => [e.desc, e.amount.toFixed(2).replace(".", ","), e.paidBy, e.participants.join("; ") || "Dividir depois"])];
    const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${trip.name}-despesas.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
};

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

async function editCost(sc, cost) {
  const trip = currentTrip();
  const places = ["Geral (viagem toda)", ...sc.segments.map(s => s.city)];
  const segName = cost?.segId ? sc.segments.find(s => s.id === cost.segId)?.city : null;
  const v = await ask(cost ? "Editar custo" : "Novo custo", [
    { name: "desc", label: "Descrição", value: cost?.desc, required: true, placeholder: "Ex.: Hotel em Paris" },
    { name: "cat", label: "Categoria", type: "select", options: CATEGORIES, value: cost?.cat || "Hospedagem" },
    { name: "amount", label: "Valor ou cálculo", type: "money", value: cost ? String(cost.amount).replace(".", ",") : "", required: true, placeholder: "Ex.: 2.400 ou 180 x 7" },
    { name: "cur", label: "Moeda", value: cost?.cur || "BRL", hint: "BRL, USD, EUR, GBP…" },
    { name: "rate", label: "Cotação em reais (se não for BRL)", type: "money", value: cost?.rate && cost.rate !== 1 ? String(cost.rate).replace(".", ",") : "", placeholder: "Ex.: 5,40" },
    { name: "perPerson", label: `Valor é por pessoa (× ${trip.travelers.length})`, type: "checkbox", value: !!cost?.perPerson },
    { name: "where", label: "Vinculado a", type: "select", options: places, value: segName || places[0] },
    { name: "status", label: "Situação", type: "select", options: COST_STATUS, value: cost?.status || "Estimado" },
    { name: "refundable", label: "Reembolsável", type: "checkbox", value: cost ? cost.refundable !== false : true },
    ...(cost ? [{ name: "del", label: "Excluir este custo", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  if (v.del) { sc.costs = sc.costs.filter(c => c.id !== cost.id); commit(); return; }
  const amount = money2(v.amount);
  if (amount == null) return;
  const cur = (v.cur || "BRL").trim().toUpperCase();
  let rate = 1;
  if (cur !== "BRL") {
    rate = v.rate ? money2(v.rate) : null;
    if (!rate) { toast("Informe a cotação em reais."); return; }
  }
  const seg = sc.segments.find(s => s.city === v.where);
  const data = { desc: v.desc.trim(), cat: v.cat, amount, cur, rate, perPerson: v.perPerson, segId: seg?.id || "", status: v.status, refundable: v.refundable };
  if (cost) Object.assign(cost, data); else sc.costs.push({ id: uid(), ...data });
  commit();
}

async function editActivity(day, act) {
  const trip = currentTrip();
  const v = await ask(act ? "Editar atividade" : `Nova atividade · Dia ${day + 1}`, [
    { name: "time", label: "Horário", type: "time", value: act?.time },
    { name: "title", label: "Atividade", value: act?.title, required: true, placeholder: "Ex.: Torre Eiffel" },
    { name: "cost", label: "Valor previsto (opcional)", type: "money", value: act?.cost ? String(act.cost).replace(".", ",") : "" },
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

async function editBooking(b) {
  const trip = currentTrip();
  const v = await ask(b ? "Editar reserva" : "Nova reserva", [
    { name: "desc", label: "Descrição", value: b?.desc, required: true, placeholder: "Ex.: Voo GRU → CDG" },
    { name: "type", label: "Tipo", type: "select", options: BOOKING_TYPES, value: b?.type || "Voo" },
    { name: "locator", label: "Localizador / confirmação", value: b?.locator },
    { name: "deadline", label: "Prazo (pagamento ou cancelamento)", type: "date", value: b?.deadline },
    ...(b ? [{ name: "del", label: "Excluir esta reserva", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  if (v.del) { trip.bookings = trip.bookings.filter(x => x.id !== b.id); commit(); return; }
  const data = { desc: v.desc.trim(), type: v.type, locator: v.locator.trim(), deadline: v.deadline };
  if (b) Object.assign(b, data); else trip.bookings.push({ id: uid(), done: false, ...data });
  commit();
}

async function editExpense(e) {
  const trip = currentTrip();
  const v = await ask(e ? "Editar despesa" : "Nova despesa", [
    { name: "desc", label: "Descrição", value: e?.desc, required: true, placeholder: "Ex.: Hotel Paris" },
    { name: "amount", label: "Valor ou cálculo", type: "money", value: e ? String(e.amount).replace(".", ",") : "", required: true, placeholder: "Ex.: 2.400" },
    { name: "paidBy", label: "Pago por", type: "select", options: trip.travelers, value: e?.paidBy || trip.travelers[0] },
    { name: "participants", label: "Dividir entre", type: "checks", options: trip.travelers, value: e ? e.participants : trip.travelers },
    { name: "later", label: "Registrar agora e dividir depois", type: "checkbox", value: e ? !e.participants.length : false },
    ...(e ? [{ name: "del", label: "Excluir esta despesa", type: "checkbox", value: false }] : [])
  ]);
  if (!v) return;
  if (v.del) { trip.expenses = trip.expenses.filter(x => x.id !== e.id); commit(); return; }
  const amount = money2(v.amount);
  if (amount == null) return;
  const participants = v.later ? [] : v.participants;
  if (!v.later && !participants.length) { toast("Escolha ao menos um viajante."); return; }
  const data = { desc: v.desc.trim(), amount, paidBy: v.paidBy, participants };
  if (e) Object.assign(e, data); else trip.expenses.push({ id: uid(), ...data });
  commit();
}

/* ---------- eventos ---------- */
document.addEventListener("click", event => {
  const tab = event.target.closest("[data-tab]");
  if (tab) { ui.tab = tab.dataset.tab; render(); return; }
  const el = event.target.closest("[data-act]");
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener("change", event => {
  if (event.target.id !== "restoreFile") return;
  const file = event.target.files[0];
  if (!file) return;
  file.text().then(text => {
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data.trips)) throw new Error();
      state = data; save(); render(); toast("Backup importado.");
    } catch { toast("Arquivo de backup inválido."); }
  });
});
window.addEventListener("hashchange", () => { ui.scenarioId = null; render(); });

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
render();
