/* Descobrir atrações: busca atrações perto do destino (OpenTripMap), baralho de cartões
   para deslizar (direita = quero, esquerda = não) e montador de roteiro por proximidade. */
import { esc } from "./ui.js?v=58";

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
export async function nearbyAttractions(lat, lon) {
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
      let x0 = 0, y0 = 0, dx = 0, drag = false;
      const yesS = el.querySelector(".dk-stamp.yes"), noS = el.querySelector(".dk-stamp.no");
      el.addEventListener("pointerdown", e => { if (e.target.closest("a")) return; drag = true; x0 = e.clientX; y0 = e.clientY; dx = 0; el.setPointerCapture(e.pointerId); el.style.transition = "none"; });
      el.addEventListener("pointermove", e => {
        if (!drag) return;
        dx = e.clientX - x0;
        el.style.transform = `translate(${dx}px, ${(e.clientY - y0) * 0.25}px) rotate(${dx / 16}deg)`;
        yesS.style.opacity = String(Math.max(0, Math.min(1, dx / 110)));
        noS.style.opacity = String(Math.max(0, Math.min(1, -dx / 110)));
      });
      const up = () => {
        if (!drag) return;
        drag = false;
        if (Math.abs(dx) > 100) decide(dx > 0 ? 1 : -1, el);
        else { el.style.transition = "transform .2s"; el.style.transform = ""; yesS.style.opacity = noS.style.opacity = "0"; }
      };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    }
    const onKey = e => { if (e.key === "ArrowRight") decide(1); else if (e.key === "ArrowLeft") decide(-1); else if (e.key === "Escape") done(); else if (e.key === "Backspace") undo(); };
    document.addEventListener("keydown", onKey);
    root.addEventListener("click", e => {
      if (e.target.closest("[data-yes]")) decide(1);
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
  if (/stadium|est[aá]dio|arena/.test(t)) return 90;
  if (/beach|praia|natural|nature|reserve|park|parque|garden|jardim/.test(t)) return 120;
  if (/tower|viewpoint|mirante|observ/.test(t)) return 60;
  if (/religion|church|igreja|cathedral|catedral|temple/.test(t)) return 30;
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

/**
 * Distribui os lugares pelos dias respeitando o tempo disponível.
 * dias: [{ start, end (minutos desde 00:00), busy: [[de, até]…] (atividades já marcadas), loose (minutos de atividades sem horário), anchor {lat,lon}|null }]
 * Devolve { days: [[{ place, time, mins, travel }…]…], left: [lugares que não couberam] }.
 */
export function planDays(places, days) {
  const pool = places.map(p => ({ ...p, mins: estimateMins(p) }));
  const cap = days.map(d => Math.max(0, d.end - d.start - d.busy.reduce((s, [a, b]) => s + overlap(a, b, d.start, d.end), 0) - (d.loose || 0)));
  const total = pool.reduce((s, p) => s + p.mins + 20, 0), totalCap = cap.reduce((a, b) => a + b, 0) || 1;
  const share = Math.min(1, total / totalCap * 1.15 + 0.05);
  const picks = days.map(d => ({ items: [], used: 0, cur: d.anchor || null }));
  const cen = pool.filter(has).length ? { lat: pool.filter(has).reduce((s, p) => s + p.lat, 0) / pool.filter(has).length, lon: pool.filter(has).reduce((s, p) => s + p.lon, 0) / pool.filter(has).length } : null;
  const run = limits => picks.forEach((pk, k) => {
    const skip = new Set();
    while (true) {
      const cand = pool.filter(p => !skip.has(p));
      if (!cand.length) break;
      let p;
      if (pk.cur) p = cand.reduce((a, b) => (travelMins(pk.cur, b) < travelMins(pk.cur, a) ? b : a));
      else p = cand.filter(has).length && cen ? cand.filter(has).reduce((a, b) => (km(cen, b) > km(cen, a) ? b : a)) : cand[0];
      const t = pk.cur ? travelMins(pk.cur, p) : 0;
      if (pk.used + t + p.mins > limits[k]) { skip.add(p); continue; }
      pk.items.push({ place: p, travel: t, mins: p.mins }); pk.used += t + p.mins; if (has(p)) pk.cur = p;
      pool.splice(pool.indexOf(p), 1);
    }
  });
  run(cap.map(c => Math.floor(c * share)));
  run(cap);
  /* horários: da abertura do dia, pulando o que já está marcado */
  const out = days.map((d, k) => {
    const busy = [...d.busy].sort((a, b) => a[0] - b[0]);
    let t = d.start;
    return picks[k].items.map(({ place, travel, mins }) => {
      t += travel;
      for (let guard = 0; guard < 20; guard += 1) { const b = busy.find(x => overlap(t, t + mins, x[0], x[1]) > 0); if (!b) break; t = b[1]; }
      const row = { place, time: fmtClock(t), mins, travel };
      t += mins;
      return row;
    });
  });
  return { days: out, left: pool };
}
