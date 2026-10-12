/* Estado, armazenamento local, sincronização (repositório privado no GitHub) e arquivos anexos. */
export const STORAGE_KEY = "planejador-viagens-v4";
const SYNC_KEY = "planejador-sync";
const UPLOADS_KEY = "planejador-uploads";
const REPO = "eduardoarqt-gif/viagens-dados";
const FILE = "data.json";
const COLLS = ["trips", "destinations", "contacts"];

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

export const DEFAULT_CHECKLIST = [
  ["Documentos", "Passaporte"], ["Documentos", "Documento de identidade"], ["Documentos", "Vistos / autorizações"], ["Documentos", "Seguro viagem"],
  ["Documentos", "Cartões e dinheiro"], ["Documentos", "Comprovantes de reserva"],
  ["Eletrônicos", "Celular e carregador"], ["Eletrônicos", "Adaptador de tomada"], ["Eletrônicos", "Power bank"], ["Eletrônicos", "Fones de ouvido"],
  ["Saúde", "Remédios de uso contínuo"], ["Saúde", "Protetor solar"], ["Saúde", "Itens de higiene"],
  ["Roupas", "Roupas para o clima"], ["Roupas", "Casaco / guarda-chuva"], ["Roupas", "Calçado confortável"],
  ["Antes de sair", "Fechar gás e janelas"], ["Antes de sair", "Desligar aparelhos"], ["Antes de sair", "Check-in feito"]
].map(([group, text]) => ({ group, text }));

export const state = { trips: [], destinations: [], contacts: [], deleted: {}, checklistTemplate: DEFAULT_CHECKLIST, tplUpdatedAt: 0 };
export const hooks = { render() {}, status() {}, toast() {} };

export function normalizeTrip(t) {
  t.places ||= [];
  t.bookings ||= [];
  t.expenses ||= [];
  t.itinerary ||= {};
  t.country ||= "";
  t.destName ||= "";
  t.checklist ||= state.checklistTemplate.map(i => ({ id: uid(), group: i.group, text: i.text, done: false }));
  return t;
}

(function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    for (const c of COLLS) state[c] = Array.isArray(saved[c]) ? saved[c] : [];
    state.deleted = saved.deleted || {};
    if (Array.isArray(saved.checklistTemplate)) state.checklistTemplate = saved.checklistTemplate;
    state.tplUpdatedAt = saved.tplUpdatedAt || 0;
  } catch { /* começa vazio */ }
  state.trips.forEach(normalizeTrip);
})();

const snapshot = () => ({
  trips: state.trips, destinations: state.destinations, contacts: state.contacts,
  deleted: state.deleted, checklistTemplate: state.checklistTemplate, tplUpdatedAt: state.tplUpdatedAt
});

/* ---------- carimbo de alteração por item ---------- */
const hashes = {};
const hashOf = o => JSON.stringify({ ...o, updatedAt: 0 });
function rememberHashes() { for (const c of COLLS) for (const o of state[c]) hashes[o.id] = hashOf(o); }
rememberHashes();
function stamp() {
  for (const c of COLLS) for (const o of state[c]) {
    const h = hashOf(o);
    if (hashes[o.id] !== h) { o.updatedAt = Date.now(); hashes[o.id] = h; }
  }
}

let dirty = false;
export function save() {
  stamp();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch { hooks.toast("Não consegui salvar neste navegador."); }
  dirty = true;
  schedulePush();
}
export function removeItem(coll, id) {
  state[coll] = state[coll].filter(o => o.id !== id);
  state.deleted[id] = Date.now();
  save();
}
export function setTemplate(list) {
  state.checklistTemplate = list;
  state.tplUpdatedAt = Date.now();
  save();
}
export function replaceAll(data) {
  for (const c of COLLS) state[c] = Array.isArray(data[c]) ? data[c] : [];
  state.deleted = data.deleted || {};
  if (Array.isArray(data.checklistTemplate)) state.checklistTemplate = data.checklistTemplate;
  state.trips.forEach(normalizeTrip);
  const now = Date.now();
  for (const c of COLLS) state[c].forEach(o => { o.updatedAt = now; });
  rememberHashes();
  save();
}

/* ---------- sincronização ---------- */
export const syncToken = () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY))?.token || ""; } catch { return ""; } };
export function setSyncToken(token) { localStorage.setItem(SYNC_KEY, JSON.stringify({ token })); }
let syncStatus = "off", pushTimer = null, running = false;
export const getStatus = () => syncStatus;
function setStatus(value) { syncStatus = value; hooks.status(value); }

const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));
const b64encode = text => {
  let bin = "";
  new TextEncoder().encode(text).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
};
const authHeaders = extra => ({ Authorization: `Bearer ${syncToken()}`, Accept: "application/vnd.github+json", ...extra });
const api = (path, init = {}) => fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { cache: "no-store", ...init, headers: authHeaders(init.headers) });

function mergeColl(local, remote, deleted) {
  const byId = new Map();
  for (const t of [...(remote || []), ...(local || [])]) {
    const cur = byId.get(t.id);
    if (!cur || (t.updatedAt || 0) >= (cur.updatedAt || 0)) byId.set(t.id, t);
  }
  return [...byId.values()].filter(t => (deleted[t.id] || 0) < (t.updatedAt || 0));
}
function merge(local, remote) {
  const deleted = { ...(remote.deleted || {}) };
  for (const [id, ts] of Object.entries(local.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  const out = { deleted };
  for (const c of COLLS) out[c] = mergeColl(local[c], remote[c], deleted);
  const remoteNewer = (remote.tplUpdatedAt || 0) > (local.tplUpdatedAt || 0) && Array.isArray(remote.checklistTemplate);
  out.checklistTemplate = remoteNewer ? remote.checklistTemplate : local.checklistTemplate;
  out.tplUpdatedAt = Math.max(remote.tplUpdatedAt || 0, local.tplUpdatedAt || 0);
  return out;
}
const signature = d => JSON.stringify([...COLLS.flatMap(c => (d[c] || []).map(o => [o.id, o.updatedAt || 0])).sort(), Object.keys(d.deleted || {}).length, d.tplUpdatedAt || 0]);

export async function sync(attempt = 0) {
  if (!syncToken()) { setStatus("off"); return; }
  if (running) return;
  running = true;
  setStatus("syncing");
  try {
    const res = await api(`${FILE}?t=${Date.now()}`);
    let remote = {}, sha;
    if (res.status === 200) {
      const json = await res.json();
      sha = json.sha;
      try { remote = JSON.parse(b64decode(json.content)); } catch { /* vazio */ }
    } else if (res.status !== 404) throw new Error(`GET ${res.status}`);
    const local = snapshot();
    const merged = merge(local, remote);
    const changedLocal = signature(merged) !== signature(local);
    if (dirty || res.status === 404 || signature(merged) !== signature(remote)) {
      const put = await api(FILE, { method: "PUT", body: JSON.stringify({ message: "sync", content: b64encode(JSON.stringify(merged)), sha }) });
      if (put.status === 409 || put.status === 422) {
        running = false;
        if (attempt < 2) return sync(attempt + 1);
        throw new Error("conflito");
      }
      if (!put.ok) throw new Error(`PUT ${put.status}`);
    }
    dirty = false;
    if (changedLocal) {
      for (const c of COLLS) state[c] = merged[c];
      state.deleted = merged.deleted;
      state.checklistTemplate = merged.checklistTemplate;
      state.tplUpdatedAt = merged.tplUpdatedAt;
      state.trips.forEach(normalizeTrip);
      rememberHashes();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch { /* ignora */ }
      hooks.render(true);
    }
    await flushUploads();
    setStatus("ok");
  } catch {
    setStatus(navigator.onLine ? "error" : "offline");
  } finally { running = false; }
}
function schedulePush() {
  if (!syncToken()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync(), 1200);
}

/* ---------- anexos (IndexedDB local + cópia no repositório privado) ---------- */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("planejador-files", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("f");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(id) {
  try {
    const db = await idb();
    return await new Promise(resolve => {
      const q = db.transaction("f").objectStore("f").get(id);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function idbPut(id, value) {
  const db = await idb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("f", "readwrite");
    tx.objectStore("f").put(value, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
const readUploads = () => { try { return JSON.parse(localStorage.getItem(UPLOADS_KEY)) || []; } catch { return []; } };
const writeUploads = list => { try { localStorage.setItem(UPLOADS_KEY, JSON.stringify(list)); } catch { /* ignora */ } };

/** Reduz fotos e prints para caber no repositório e abrir rápido. */
export async function prepareFile(file) {
  if (!file.type.startsWith("image/")) {
    if (file.size > 8 * 1024 * 1024) throw new Error("Arquivo acima de 8 MB.");
    return file;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob || file), "image/jpeg", 0.82));
}
export async function storeFile(blob, name) {
  const id = uid();
  await idbPut(id, { blob, name, type: blob.type });
  writeUploads([...readUploads(), id]);
  flushUploads();
  return { id, name, type: blob.type };
}
const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(",")[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
export async function flushUploads() {
  if (!syncToken() || !navigator.onLine) return;
  const queue = readUploads();
  const left = [];
  for (const id of queue) {
    try {
      const rec = await idbGet(id);
      if (!rec) continue;
      const res = await api(`files/${id}`, { method: "PUT", body: JSON.stringify({ message: "anexo", content: await blobToBase64(rec.blob) }) });
      if (!res.ok && res.status !== 422) left.push(id);
    } catch { left.push(id); }
  }
  writeUploads(left);
}
/** Devolve o arquivo do aparelho ou baixa do repositório (e guarda para ficar offline). */
export async function getFileBlob(att) {
  const local = await idbGet(att.id);
  if (local) return local.blob;
  if (!syncToken()) return null;
  try {
    const res = await api(`files/${att.id}`, { headers: { Accept: "application/vnd.github.raw" } });
    if (!res.ok) return null;
    const blob = new Blob([await res.arrayBuffer()], { type: att.type || "application/octet-stream" });
    await idbPut(att.id, { blob, name: att.name, type: att.type });
    return blob;
  } catch { return null; }
}
export async function isFileOffline(id) { return !!(await idbGet(id)); }
