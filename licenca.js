/* Licença do Dudoo Trips — porta para JavaScript do núcleo `DUDOO ADM/nucleo_licenca` (formato, estados, ativação, renovação).
   Falha FECHADA: licença ausente, adulterada, de outro produto ou vencida além da tolerância não libera o uso (quando a exigência está ligada).
   A assinatura (Ed25519) impede FORJAR licença; num site estático nada impede quem sabe mexer no código de remover a checagem (ver SPRINT_LICENCA). */
import { CHAVE_PUBLICA_PEM } from "./chave_publica_licenca.js?v=64";
import { LICENCA_CFG as CFG } from "./licenca_config.js?v=64";

const KEY = "planejador-licenca";
const CAMPOS = ["codigo", "cliente", "email_master", "limite_usuarios", "plano", "emitida_em", "valida_ate", "versao_formato"];
const DIAS_SEM_VALIDADE = 36500;

export class LicencaInvalida extends Error {}

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const diasEntre = (a, b) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 864e5);
const dataValida = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));

/** Mesma serialização do Python (`json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`). */
export function canonico(v) {
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonico(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const pemParaDer = pem => b64(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));

let naclCache = null;
async function carregarNacl() {
  if (naclCache) return naclCache;
  const m = await import("./nacl-fast.min.js?v=64");
  naclCache = globalThis.nacl || m.default || m;
  return naclCache;
}

/** Ed25519: Web Crypto quando o navegador suporta; senão tweetnacl (arquivo local). */
export async function verificarAssinatura(pem, mensagem, assinatura, { forcarNacl = false } = {}) {
  const der = pemParaDer(pem);
  if (!forcarNacl && globalThis.crypto?.subtle) {
    try {
      const chave = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
      return await crypto.subtle.verify({ name: "Ed25519" }, chave, assinatura, mensagem);
    } catch { /* navegador sem Ed25519: cai no tweetnacl */ }
  }
  const nacl = await carregarNacl();
  return nacl.sign.detached.verify(mensagem, assinatura, der.slice(-32));
}

/** Confere estrutura, assinatura e produto. NÃO olha validade (vencida continua sendo licença legítima). */
export async function validarDocumento(doc, opts = {}) {
  if (!doc || typeof doc !== "object") throw new LicencaInvalida("O arquivo de licença não tem o formato esperado.");
  const { dados, assinatura } = doc;
  if (!dados || typeof dados !== "object" || typeof assinatura !== "string") throw new LicencaInvalida("Licença incompleta (faltam dados ou assinatura).");
  for (const c of CAMPOS) if (!(c in dados)) throw new LicencaInvalida(`Licença sem o campo obrigatório ${c}.`);
  if (Number(dados.versao_formato) !== CFG.VERSAO_FORMATO) throw new LicencaInvalida("Esta licença foi emitida num formato que esta versão não entende. Atualize o Dudoo Trips.");
  let sig;
  try { sig = b64(assinatura); } catch { throw new LicencaInvalida("Assinatura da licença ilegível."); }
  let ok = false;
  try { ok = await verificarAssinatura(opts.chavePem || CHAVE_PUBLICA_PEM, new TextEncoder().encode(canonico(dados)), sig, opts); } catch { ok = false; }
  if (!ok) throw new LicencaInvalida("A assinatura desta licença não confere: o arquivo foi alterado ou não foi emitido pelo Dudoo Trips.");
  if (String(dados.produto || "").trim().toLowerCase() !== CFG.PRODUTO) throw new LicencaInvalida("Esta licença não é do Dudoo Trips.");
  const plano = String(dados.plano);
  let validaAte = null;
  if (dados.valida_ate === null || dados.valida_ate === "") {
    if (plano !== "interno") throw new LicencaInvalida("Só a licença interna pode ser sem validade.");
  } else if (dataValida(dados.valida_ate)) validaAte = dados.valida_ate;
  else throw new LicencaInvalida("Data de validade da licença inválida.");
  if (!dataValida(dados.emitida_em)) throw new LicencaInvalida("Data de emissão da licença inválida.");
  return {
    codigo: String(dados.codigo), cliente: String(dados.cliente), email: String(dados.email_master).trim(), plano,
    emitidaEm: dados.emitida_em, validaAte, gratisAte: dataValida(dados.gratis_ate) ? dados.gratis_ate : null,
    observacoes: String(dados.observacoes || ""), revisao: Math.max(0, parseInt(dados.revisao || 0, 10) || 0)
  };
}

export const diasRestantes = (lic, hoje = hojeISO()) => (lic.validaAte === null ? DIAS_SEM_VALIDADE : diasEntre(lic.validaAte, hoje));
const brData = iso => iso.split("-").reverse().join("/");

/** Estado como no núcleo: sem_licenca | ativa | vencendo | tolerancia | bloqueada. `libera` diz se o app pode ser usado. */
export function estadoDe(lic, hoje = hojeISO()) {
  if (!lic) return { situacao: "sem_licenca", libera: false, licenca: null, mensagem: "Nenhuma licença válida instalada." };
  if (lic.validaAte === null) return { situacao: "ativa", libera: true, licenca: lic, mensagem: "Licença interna, sem data de validade." };
  const dias = diasRestantes(lic, hoje), tol = CFG.TOLERANCIA_DIAS, venc = brData(lic.validaAte);
  if (dias < -tol) return { situacao: "bloqueada", libera: false, licenca: lic, mensagem: `Licença vencida em ${venc} (há mais de ${tol} dias). Renove para continuar usando.` };
  if (dias < 0) return { situacao: "tolerancia", libera: true, licenca: lic, mensagem: `Licença vencida em ${venc}. O app ainda abre por ${tol + dias} dia(s): renove logo.` };
  if (dias <= CFG.AVISO_VENCENDO_DIAS) return { situacao: "vencendo", libera: true, licenca: lic, mensagem: `Licença vence em ${venc} (${dias} dia(s)).` };
  return { situacao: "ativa", libera: true, licenca: lic, mensagem: `Licença ativa até ${venc}.` };
}

/* ---------- instalada no aparelho ---------- */
export function documentoInstalado() { try { return JSON.parse(store()?.getItem(KEY) || "null"); } catch { return null; } }
function gravar(doc) { store()?.setItem(KEY, JSON.stringify(doc)); }
export function removerLicenca() { store()?.removeItem(KEY); }

export async function licencaInstalada(opts = {}) {
  const doc = documentoInstalado();
  if (!doc) return null;
  try { return await validarDocumento(doc, opts); } catch { return null; }
}
export async function estadoLicenca(hoje, opts) { return estadoDe(await licencaInstalada(opts), hoje); }

/** Instala a partir do texto (arquivo .dudoo-trips ou JSON colado). Recusa licença já morta (vencida além da tolerância). */
export async function instalarTexto(texto, opts = {}) {
  let doc;
  try { doc = JSON.parse(String(texto || "").trim()); } catch { throw new LicencaInvalida("Não consegui ler a licença. Use o arquivo .dudoo-trips inteiro ou o texto completo."); }
  const lic = await validarDocumento(doc, opts);
  const est = estadoDe(lic, opts.hoje);
  if (est.situacao === "bloqueada") throw new LicencaInvalida(`Esta licença venceu em ${brData(lic.validaAte)}. Peça uma licença renovada.`);
  gravar(doc);
  return lic;
}

/* ---------- Wix (fase 4): ativação por código + e-mail e renovação online ---------- */
const comTimeout = (url, init = {}) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), CFG.TIMEOUT_MS); return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t)); };
const normalizarCodigo = s => String(s || "").replace(/\s+/g, "").toUpperCase();

export async function ativarPorCodigo(codigo, email, opts = {}) {
  codigo = normalizarCodigo(codigo); email = String(email || "").trim().toLowerCase();
  if (!codigo) throw new LicencaInvalida("Digite o código da licença.");
  if (!email.includes("@")) throw new LicencaInvalida("Digite o e-mail do administrador da licença.");
  if (!CFG.ENDPOINTS_NO_AR && !opts.forcarEndpoint) throw new LicencaInvalida("A ativação por código ainda não está disponível. Use o arquivo ou o texto da licença que você recebeu.");
  let res;
  try { res = await comTimeout(`${CFG.URL_BASE}/${CFG.ENDPOINT_ATIVACAO}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo, email }) }); }
  catch { throw new LicencaInvalida("Não foi possível falar com o servidor do Dudoo. Confira a internet ou use o arquivo da licença."); }
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new LicencaInvalida(corpo.erro || (res.status === 429 ? "Muitas tentativas. Aguarde alguns minutos." : "Código ou e-mail não conferem. Confira os dados com o suporte do Dudoo Trips."));
  const doc = corpo.documento, lic = await validarDocumento(doc, opts);
  if (lic.codigo.toUpperCase() !== codigo || lic.email.toLowerCase() !== email) throw new LicencaInvalida("A resposta do servidor não corresponde ao código e e-mail digitados. Fale com o suporte.");
  if (estadoDe(lic, opts.hoje).situacao === "bloqueada") throw new LicencaInvalida(`Esta licença venceu em ${brData(lic.validaAte)}. Peça a renovação ao suporte.`);
  gravar(doc);
  return lic;
}

/** Busca a licença deste código no Wix e troca a local SÓ se vier melhor. Nunca lança: qualquer falha mantém a instalada. */
export async function renovarOnline(opts = {}) {
  try {
    if (!CFG.ENDPOINTS_NO_AR && !opts.forcarEndpoint) return null;
    const atual = await licencaInstalada(opts);
    if (!atual) return null;
    const res = await comTimeout(`${CFG.URL_BASE}/${CFG.ENDPOINT_RENOVACAO}?codigo=${encodeURIComponent(atual.codigo)}`);
    if (!res.ok) return null;
    const doc = await res.json(), nova = await validarDocumento(doc, opts);
    if (nova.codigo !== atual.codigo) return null;
    if (nova.revisao > 0 && nova.revisao < atual.revisao) return null;
    const ord = l => (l.validaAte === null ? "9999-12-31" : l.validaAte);
    if (!(ord(nova) > ord(atual) || nova.revisao > atual.revisao)) return null;
    gravar(doc);
    return nova;
  } catch { return null; }
}
