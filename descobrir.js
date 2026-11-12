/* Descobrir atrações: busca atrações perto do destino (OpenTripMap), baralho de cartões
   para deslizar (direita = quero, esquerda = não) e montador de roteiro por proximidade. */
import { esc } from "./ui.js?v=62";

const TTL = 7 * 24 * 3600e3;
const rad = x => x * Math.PI / 180;
export const km = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/* Atrações do OpenTripMap (gratuito, precisa de uma chave pessoal): nota de popularidade, foto e resumo. A chave fica só neste aparelho. */
const OTM_KEY = "planejador-opentripmap";
export const otmKey = () => { try { return localStorage.getItem(OTM_KEY) || ""; } catch { return ""; } };
export const setOtmKey = k => { try { if (k) localStorage.setItem(OTM_KEY, k.trim()); else localStorage.removeItem(OTM_KEY); } catch { /* ignora */ } };
const OTM_KIND = { museums: "Museu", historic: "Histórico", natural: "Natureza", architecture: "Arquitetura", cultural: "Cultura", amusements: "Diversão", sport: "Esporte", religion: "Religião", urban_environment: "Urbano", theatres_and_entertainments: "Espetáculos", gardens_and_parks: "Parque", towers: "Mirante", bridges: "Ponte", beaches: "Praia", fountains: "Fonte", monuments_and_memorials: "Monumento" };
const kindLabel = kinds => [...new Set((kinds || "").split(",").map(k => OTM_KIND[k]).filter(Boolean))].slice(0, 2).join(" · ");
const getJson = async url => { const r = await fetch(url); if (r.status === 401 || r.status === 403) throw new Error("chave"); if (!r.ok) throw new Error(r.status); return r.json(); };

/** Atrações perto do ponto, das mais bem avaliadas para as menos. Devolve null se não há chave; lança "chave" se a chave não vale. */
async function otmAttractions(lat, lon) {
  const key = otmKey();
  if (!key) return null;
  const ck = `disc2:${lat.toFixed(2)},${lon.toFixed(2)}`;
  try { const c = JSON.parse(localStorage.getItem(ck)); if (c && Date.now() - c.t < TTL) return c.d; } catch { /* sem cache */ }
  const base = "https://api.opentripmap.com/0.1/en/places";
  const list = await getJson(`${base}/radius?radius=15000&lon=${lon}&lat=${lat}&kinds=interesting_places&rate=2&format=json&limit=80&apikey=${encodeURIComponent(key)}`);
  const top = (Array.isArray(list) ? list : []).filter(p => p.name && p.point).sort((a, b) => parseInt(b.rate, 10) - parseInt(a.rate, 10) || a.dist - b.dist).slice(0, 28);
  const out = (await Promise.all(top.map(async p => {
    const d = await getJson(`${base}/xid/${p.xid}?apikey=${encodeURIComponent(key)}`).catch(() => null);
    const extract = (d?.wikipedia_extracts?.text || "").replace(/\s+/g, " ").trim();
    return { title: p.name, desc: [kindLabel(p.kinds), extract ? (extract.length > 150 ? `${extract.slice(0, 147)}…` : extract) : ""].filter(Boolean).join(" · "), img: d?.preview?.source || d?.image || "", lat: p.point.lat, lon: p.point.lon, views: parseInt(p.rate, 10) || 0, lang: "otm", kinds: p.kinds || "", url: d?.wikipedia || d?.url || "" };
  }))).sort((a, b) => b.views - a.views || !!b.img - !!a.img);
  try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: out })); } catch { /* cheio */ }
  return out;
}

/* Google Places API (novo): as atrações mais bem avaliadas, com nota, foto e horário de funcionamento. Chave pessoal, guardada só neste aparelho. */
const G_KEY = "planejador-google-places";
export const googleKey = () => { try { return localStorage.getItem(G_KEY) || ""; } catch { return ""; } };
export const setGoogleKey = k => { try { if (k) localStorage.setItem(G_KEY, k.trim()); else localStorage.removeItem(G_KEY); } catch { /* ignora */ } };
const G_FIELDS = ["id", "displayName", "location", "rating", "userRatingCount", "photos", "regularOpeningHours", "primaryTypeDisplayName", "editorialSummary", "googleMapsUri", "types", "businessStatus", "formattedAddress"].map(f => `places.${f}`).join(",");
const G_SKIP = /lodging|travel_agency|real_estate|car_rental|car_dealer|store$|school|hospital|doctor|bank|atm|gas_station|parking/;
async function gSearch(key, text, lat, lon) {
  const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": G_FIELDS },
    body: JSON.stringify({ textQuery: text, languageCode: "pt-BR", pageSize: 20, locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: 20000 } } })
  });
  if (!r.ok) {
    let msg = ""; try { msg = (await r.json()).error?.message || ""; } catch { /* sem corpo */ }
    const e = new Error(/api key|referer|not authorized|blocked|permission|disabled|billing/i.test(msg) || r.status === 401 || r.status === 403 ? "chave" : String(r.status));
    e.detail = msg; throw e;
  }
  return (await r.json()).places || [];
}
/** horários → { 0: [[abre, fecha]…] … 6 } em minutos (0 = domingo); null se o Google não informa. */
function gHours(h) {
  const per = h?.periods;
  if (!per || !per.length) return null;
  const out = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  if (per.length === 1 && per[0].open && !per[0].close) { for (let d = 0; d < 7; d += 1) out[d].push([0, 1440]); return out; }
  for (const p of per) {
    if (!p.open || !p.close) continue;
    const o = p.open.hour * 60 + (p.open.minute || 0), c = p.close.hour * 60 + (p.close.minute || 0);
    if (p.close.day === p.open.day && c > o) out[p.open.day].push([o, c]);
    else out[p.open.day].push([o, 1440]);
  }
  return out;
}
const gCount = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} mil` : String(n));
export async function googleAttractions(key, lat, lon, city, country) {
  const ck = `disc4:${(city || "").toLowerCase()}|${lat.toFixed(2)},${lon.toFixed(2)}`;
  try { const c = JSON.parse(localStorage.getItem(ck)); if (c && Date.now() - c.t < TTL) return c.d; } catch { /* sem cache */ }
  const where = [city, country].filter(Boolean).join(", ");
  const lists = await Promise.all([`principais pontos turísticos em ${where}`, `o que fazer em ${where}`].map(q => gSearch(key, q, lat, lon)));
  const seen = new Set();
  const out = lists.flat().filter(p => p.id && !seen.has(p.id) && seen.add(p.id) && p.location && p.displayName?.text
    && p.businessStatus !== "CLOSED_PERMANENTLY" && (p.rating || 0) >= 4.2 && (p.userRatingCount || 0) >= 300 && !(p.types || []).some(t => G_SKIP.test(t)))
    .sort((a, b) => b.rating * Math.log10(b.userRatingCount + 1) - a.rating * Math.log10(a.userRatingCount + 1))
    .slice(0, 36)
    .map(p => ({
      id: p.id, title: p.displayName.text, lat: p.location.latitude, lon: p.location.longitude, lang: "g", kinds: (p.types || []).join(","),
      desc: [p.primaryTypeDisplayName?.text, (p.editorialSummary?.text || "").slice(0, 140)].filter(Boolean).join(" · "),
      photos: (p.photos || []).slice(0, 8).map(ph => `https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=800&key=${encodeURIComponent(key)}`),
      addr: p.formattedAddress || "", hoursText: p.regularOpeningHours?.weekdayDescriptions || [],
      img: p.photos?.[0]?.name ? `https://places.googleapis.com/v1/${p.photos[0].name}/media?maxWidthPx=640&key=${encodeURIComponent(key)}` : "",
      rating: p.rating, count: p.userRatingCount, hours: gHours(p.regularOpeningHours), url: p.googleMapsUri || ""
    }));
  try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: out })); } catch { /* cheio */ }
  return out;
}

/** Atrações do destino: Google (se houver chave), senão OpenTripMap. Devolve null sem nenhuma chave; lança "chave" se a chave não vale. */
export async function nearbyAttractions(lat, lon, city, country) {
  const g = googleKey();
  if (g) { try { return await googleAttractions(g, lat, lon, city, country); } catch (e) { if (!otmKey()) throw e; } }
  return otmAttractions(lat, lon);
}

/* ---------- baralho de cartões ---------- */
/** Mostra os cartões em tela cheia. Devolve { yes, no } (ao fechar antes do fim, devolve o que já foi escolhido). */
export function swipeDeck(cards, title) {
  return new Promise(resolve => {
    const yes = [], no = [], hist = [];
    let i = 0;
    const root = document.createElement("div");
    root.className = "dk";
    document.body.append(root);
    document.body.style.overflow = "hidden";
    const done = () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; root.remove(); resolve({ yes, no }); };
    const cardHtml = (c, top) => `<div class="dk-card${top ? " top" : ""}">
        ${c.img ? `<img src="${esc(c.img)}" alt="" draggable="false" loading="eager">` : `<div class="dk-noimg">${c.kind === "life" ? "📍" : "🏛️"}</div>`}
        <div class="dk-stamp yes">QUERO</div><div class="dk-stamp no">NÃO</div>
        <div class="dk-info"><span class="dk-badge">${esc(c.badge)}</span><h3>${esc(c.name)}</h3>${c.desc ? `<p>${esc(c.desc)}</p>` : ""}${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" class="dk-link" draggable="false">Saiba mais ↗</a>` : ""}</div></div>`;
    function render() {
      if (i >= cards.length) {
        root.innerHTML = `<div class="dk-head"><b>${esc(title)}</b><button class="dk-x" data-x aria-label="Fechar">✕</button></div>
          <div class="dk-end"><h2>Acabaram as atrações</h2><p>${yes.length} escolhida${yes.length === 1 ? "" : "s"} · ${no.length} descartada${no.length === 1 ? "" : "s"}</p>
          <div class="dk-btns"><button class="dk-b undo" data-undo ${hist.length ? "" : "disabled"} aria-label="Desfazer">↶</button></div>
          <button class="btn primary" data-x>${yes.length ? "Montar roteiro" : "Fechar"}</button></div>`;
        return;
      }
      root.innerHTML = `<div class="dk-head"><b>${esc(title)}</b><span class="dk-count">${i + 1} / ${cards.length}</span><button class="dk-x" data-x aria-label="Fechar">✕</button></div>
        <div class="dk-stack">${cards[i + 1] ? cardHtml(cards[i + 1], false) : ""}${cardHtml(cards[i], true)}</div>
        <p class="dk-hint">Arraste para a direita (quero) ou para a esquerda (não) · ${yes.length} escolhida${yes.length === 1 ? "" : "s"}</p>
        <div class="dk-btns"><button class="dk-b no" data-no aria-label="Não quero">✕</button><button class="dk-b undo" data-undo ${hist.length ? "" : "disabled"} aria-label="Desfazer">↶</button><button class="dk-b yes" data-yes aria-label="Quero">✓</button></div>`;
      bindDrag(root.querySelector(".dk-card.top"));
    }
    function decide(dir, card) {
      const c = cards[i];
      if (!c) return;
      const el = card || root.querySelector(".dk-card.top");
      const fly = () => { (dir > 0 ? yes : no).push(c); hist.push(dir); i += 1; render(); };
      if (!el) { fly(); return; }
      el.style.transition = "transform .22s ease-out, opacity .22s";
      el.style.transform = `translate(${dir * 520}px, 30px) rotate(${dir * 24}deg)`;
      el.style.opacity = "0";
      setTimeout(fly, 200);
    }
    function undo() {
      if (!hist.length) return;
      const dir = hist.pop();
      (dir > 0 ? yes : no).pop();
      i -= 1;
      render();
    }
    function bindDrag(el) {
      if (!el) return;
      let x0 = 0, y0 = 0, dx = 0, dy = 0, drag = false;
      const yesS = el.querySelector(".dk-stamp.yes"), noS = el.querySelector(".dk-stamp.no");
      el.addEventListener("pointerdown", e => { if (e.target.closest("a")) return; drag = true; x0 = e.clientX; y0 = e.clientY; dx = 0; el.setPointerCapture(e.pointerId); el.style.transition = "none"; });
      el.addEventListener("pointermove", e => {
        if (!drag) return;
        dx = e.clientX - x0; dy = e.clientY - y0;
        el.style.transform = `translate(${dx}px, ${(e.clientY - y0) * 0.25}px) rotate(${dx / 16}deg)`;
        yesS.style.opacity = String(Math.max(0, Math.min(1, dx / 110)));
        noS.style.opacity = String(Math.max(0, Math.min(1, -dx / 110)));
      });
      const up = e => {
        if (!drag) return;
        drag = false;
        if (Math.abs(dx) > 100) decide(dx > 0 ? 1 : -1, el);
        else {
          el.style.transition = "transform .2s"; el.style.transform = ""; yesS.style.opacity = noS.style.opacity = "0";
          /* toque (sem arrastar): abre os detalhes do lugar */
          if (e?.type === "pointerup" && Math.abs(dx) < 8 && Math.abs(dy) < 8) openDetail();
        }
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }
    /* detalhes: várias fotos (deslizar), nota, endereço, horários e link */
    function openDetail() {
      const c = cards[i];
      if (!c || root.querySelector(".dk-detail")) return;
      const pics = c.photos && c.photos.length ? c.photos : c.img ? [c.img] : [];
      root.insertAdjacentHTML("beforeend", `<div class="dk-detail">
        <div class="dk-dhead"><button class="dk-x" data-dclose aria-label="Voltar">‹</button><b>${esc(c.name)}</b></div>
        <div class="dk-dbody">
          ${pics.length ? `<div class="dk-gal">${pics.map(u => `<img src="${esc(u)}" alt="" draggable="false" loading="lazy">`).join("")}</div>${pics.length > 1 ? `<p class="dk-gcount">${pics.length} fotos · deslize para o lado</p>` : ""}` : ""}
          <span class="dk-badge dark">${esc(c.badge)}</span>
          <h3>${esc(c.name)}</h3>
          ${c.desc ? `<p>${esc(c.desc)}</p>` : ""}
          ${c.addr ? `<p class="dk-addr">📍 ${esc(c.addr)}</p>` : ""}
          ${c.hoursText && c.hoursText.length ? `<details><summary>Horário de funcionamento</summary>${c.hoursText.map(h => `<div class="dk-hour">${esc(h)}</div>`).join("")}</details>` : ""}
          ${c.url ? `<a class="btn soft" href="${esc(c.url)}" target="_blank" rel="noopener">Abrir no Google Maps (avaliações e mais fotos) ↗</a>` : ""}
        </div>
        <div class="dk-btns"><button class="dk-b no" data-dno aria-label="Não quero">✕</button><button class="dk-b yes" data-dyes aria-label="Quero">✓</button></div></div>`);
    }
    const closeDetail = () => root.querySelector(".dk-detail")?.remove();
    const onKey = e => {
      if (e.key === "Escape") { if (root.querySelector(".dk-detail")) closeDetail(); else done(); return; }
      if (root.querySelector(".dk-detail")) return;
      if (e.key === "ArrowRight") decide(1); else if (e.key === "ArrowLeft") decide(-1); else if (e.key === "Backspace") undo();
    };
    document.addEventListener("keydown", onKey);
    root.addEventListener("click", e => {
      if (e.target.closest("[data-dclose]")) closeDetail();
      else if (e.target.closest("[data-dyes]")) { closeDetail(); decide(1); }
      else if (e.target.closest("[data-dno]")) { closeDetail(); decide(-1); }
      else if (e.target.closest("[data-yes]")) decide(1);
      else if (e.target.closest("[data-no]")) decide(-1);
      else if (e.target.closest("[data-undo]")) undo();
      else if (e.target.closest("[data-x]")) done();
    });
    render();
  });
}

/* ---------- montador de roteiro ---------- */
/** Tempo estimado no local (minutos), por tipo de lugar. */
export function estimateMins(c) {
  if (c.mins) return c.mins;
  if (c.kind === "life") return ({ restaurante: 90, bar: 90, cafe: 45, atracao: 120, hotel: 20, delivery: 20 })[c.life?.categoria] ?? 60;
  const t = `${c.name || ""} ${c.kinds || ""}`.toLowerCase();
  if (/theme_park|amusement_park|water_park|disney|universal|legoland|seaworld|studios/.test(t)) return 360;
  if (/zoo|aquarium|aqu[aá]rio|zool/.test(t)) return 180;
  if (/museum|museu|gallery|galeria/.test(t)) return 120;
  if (/shopping_mall|outlet/.test(t)) return 120;
  if (/restaurant|bar\b|night_club/.test(t)) return 90;
  if (/cafe|bakery/.test(t)) return 45;
  if (/stadium|est[aá]dio|arena/.test(t)) return 90;
  if (/beach|praia|natural|nature|reserve|park|parque|garden|jardim/.test(t)) return 120;
  if (/tower|viewpoint|mirante|observ/.test(t)) return 60;
  if (/religion|church|igreja|cathedral|catedral|temple|place_of_worship/.test(t)) return 30;
  if (/monument|memorial|fountain|bridge|historic|architecture|statue|square|plaza|praça/.test(t)) return 40;
  return 75;
}
const has = p => p && p.lat != null && p.lon != null;
/** Deslocamento estimado (minutos): a pé até ~1,2 km; de carro/app acima disso (inclui estacionar/esperar). */
export function travelMins(a, b) {
  if (!has(a) || !has(b)) return 15;
  const d = km(a, b) * 1.35;
  return Math.round(d < 1.6 ? d / 5 * 60 + 2 : 10 + d / 30 * 60);
}
export const fmtClock = m => `${String(Math.min(23, Math.floor(m / 60))).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
export const fmtDur = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`);
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Primeiro horário a partir de `t` em que o lugar abre e ainda dá tempo de visitar; null se fechado nesse dia. */
function openStart(p, dow, t, mins) {
  const iv = p.hours && dow != null ? p.hours[dow] : null;
  if (!p.hours || dow == null) return t;
  if (!iv || !iv.length) return null;
  for (const [o, c] of [...iv].sort((a, b) => a[0] - b[0])) { const s = Math.max(t, o); if (s + Math.min(mins, 45) <= c) return s; }
  return null;
}

/**
 * Distribui os lugares pelos dias respeitando tempo, deslocamento, atividades já marcadas e horário de funcionamento.
 * dias: [{ start, end (minutos desde 00:00), busy: [[de, até]…], loose (minutos de atividades sem horário), anchor {lat,lon}|null, dow (0=domingo…6)|null }]
 * Devolve { days: [[{ place, time, mins, travel }…]…], left: [lugares que não couberam, com `why`] }.
 */
export function planDays(places, days, pace = "equilibrado") {
  const pool = places.map(p => ({ ...p, mins: estimateMins(p) }));
  const cap = days.map(d => Math.max(0, d.end - d.start - d.busy.reduce((s, [a, b]) => s + overlap(a, b, d.start, d.end), 0) - (d.loose || 0)));
  const total = pool.reduce((s, p) => s + p.mins + 20, 0), totalCap = cap.reduce((a, b) => a + b, 0) || 1;
  /* equilibrado: espalha pelos dias; compacto: enche os primeiros dias e deixa os últimos livres */
  const share = pace === "compacto" ? 1 : Math.min(1, total / totalCap * 1.15 + 0.05);
  const geoPool = pool.filter(has);
  const cen = geoPool.length ? { lat: geoPool.reduce((s, p) => s + p.lat, 0) / geoPool.length, lon: geoPool.reduce((s, p) => s + p.lon, 0) / geoPool.length } : null;
  const st = days.map(d => ({ items: [], used: 0, cur: d.anchor || null, t: d.start }));
  const run = limits => st.forEach((s, k) => {
    const d = days[k], busy = [...d.busy].sort((a, b) => a[0] - b[0]), endLimit = d.end - (d.loose || 0);
    const skip = new Set();
    while (true) {
      const cand = pool.filter(p => !skip.has(p));
      if (!cand.length) break;
      let p;
      if (s.cur) p = cand.reduce((a, b) => (travelMins(s.cur, b) < travelMins(s.cur, a) ? b : a));
      else p = geoPool.length && cen && cand.some(has) ? cand.filter(has).reduce((a, b) => (km(cen, b) > km(cen, a) ? b : a)) : cand[0];
      const travel = s.cur ? travelMins(s.cur, p) : 0;
      let t = s.t + travel;
      for (let g = 0; g < 20; g += 1) {
        const b = busy.find(x => overlap(t, t + p.mins, x[0], x[1]) > 0);
        const o = b ? null : openStart(p, d.dow, t, p.mins);
        if (b) { t = b[1]; continue; }
        if (o == null) { t = Infinity; break; }
        if (o !== t) { t = o; continue; }
        break;
      }
      if (!Number.isFinite(t) || t + p.mins > endLimit || s.used + travel + p.mins > limits[k]) { skip.add(p); continue; }
      s.items.push({ place: p, time: fmtClock(t), mins: p.mins, travel });
      s.used += travel + p.mins; s.t = t + p.mins; if (has(p)) s.cur = p;
      pool.splice(pool.indexOf(p), 1);
    }
  });
  run(cap.map(c => Math.floor(c * share)));
  run(cap);
  const closed = p => p.hours && days.length && days.every(d => d.dow != null && !(p.hours[d.dow] || []).length);
  return { days: st.map(s => s.items), left: pool.map(p => ({ ...p, why: closed(p) ? "fechado nesses dias" : "sem tempo" })) };
}
