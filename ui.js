import { prepareFile, storeFile } from "./data.js?v=23";

export const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const brl = value => money.format(value || 0);
export const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const num = value => String(value).replace(".", ",");

export function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

const sheet = document.querySelector("#sheet");
const sheetForm = document.querySelector("#sheetForm");
export const sheetIsOpen = () => sheet.open;

const attIcon = a => (a.type || "").startsWith("image/") ? "🖼️" : "📄";

/**
 * Abre um formulário em folha e devolve os valores (ou null se cancelar).
 * Tipos: text, number, date, time, money, textarea, select, checks, checkbox, attach, note.
 * `showIf: [campo, valor]` mostra o campo só quando o outro tem aquele valor.
 */
export function ask(title, fields, { confirm = "Salvar", danger = false } = {}) {
  return new Promise(resolve => {
    const attach = {};
    const wrap = (f, html) => f.showIf ? `<div data-showif="${esc(f.showIf[0])}" data-showval="${esc(f.showIf[1])}">${html}</div>` : html;
    const body = fields.map(f => {
      if (f.type === "note") return wrap(f, `<p class="hint">${esc(f.label)}</p>`);
      if (f.type === "select") {
        return wrap(f, `<label>${esc(f.label)}<select name="${f.name}">${f.options.map(o => `<option ${o === f.value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`);
      }
      if (f.type === "checks") {
        return wrap(f, `<fieldset><legend>${esc(f.label)}</legend><div class="chips">${f.options.map(o => `<label class="chip"><input type="checkbox" name="${f.name}" value="${esc(o)}" ${(f.value || []).includes(o) ? "checked" : ""}><span>${esc(o)}</span></label>`).join("")}</div></fieldset>`);
      }
      if (f.type === "checkbox") {
        return wrap(f, `<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? "checked" : ""}><span>${esc(f.label)}</span></label>`);
      }
      if (f.type === "textarea") {
        return wrap(f, `<label>${esc(f.label)}<textarea name="${f.name}" rows="3" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea></label>`);
      }
      if (f.type === "attach") {
        attach[f.name] = [...(f.value || [])];
        return wrap(f, `<div class="attach" data-attach="${f.name}"><span class="label-text">${esc(f.label)}</span><div class="att-list"></div>
          <label class="btn soft sm">+ Arquivo ou foto<input type="file" multiple accept="image/*,application/pdf" hidden></label>
          <small class="hint">Dica: copie um print e cole aqui com Ctrl+V.</small></div>`);
      }
      const attrs = f.type === "money" ? 'inputmode="decimal" autocomplete="off"' : "";
      const type = f.type === "money" ? "text" : f.type || "text";
      return wrap(f, `<label>${esc(f.label)}<input type="${type}" name="${f.name}" value="${esc(f.value ?? "")}" placeholder="${esc(f.placeholder || "")}" ${f.required ? "required" : ""} ${f.min != null ? `min="${f.min}"` : ""} ${f.step ? `step="${f.step}"` : ""} ${attrs}></label>${f.hint ? `<small class="hint">${esc(f.hint)}</small>` : ""}`);
    }).join("");
    sheetForm.innerHTML = `
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Fechar">×</button></div>
      <div class="sheet-body">${body}</div>
      <div class="sheet-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn ${danger ? "danger" : "primary"}" value="ok">${esc(confirm)}</button></div>`;

    const applyShow = () => sheetForm.querySelectorAll("[data-showif]").forEach(el => {
      const control = sheetForm.elements[el.dataset.showif];
      el.hidden = !control || control.value !== el.dataset.showval;
    });
    sheetForm.onchange = sheetForm.oninput = applyShow;
    applyShow();

    const paintAttach = name => {
      const box = sheetForm.querySelector(`[data-attach="${name}"] .att-list`);
      box.innerHTML = attach[name].map((a, i) => `<span class="att">${attIcon(a)} ${esc(a.name)} <button type="button" data-rm="${name}:${i}" aria-label="Remover">×</button></span>`).join("");
    };
    Object.keys(attach).forEach(paintAttach);
    const addFile = async (name, file) => {
      try {
        const blob = await prepareFile(file);
        const ext = (blob.type || "").includes("pdf") ? "pdf" : "jpg";
        const label = file.name && file.name !== "image.png" ? file.name : `Print ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.${ext}`;
        attach[name].push(await storeFile(blob, label));
        paintAttach(name);
      } catch (error) { toast(error.message || "Não consegui anexar."); }
    };
    sheetForm.onclick = event => {
      const rm = event.target.closest("[data-rm]");
      if (!rm) return;
      const [name, i] = rm.dataset.rm.split(":");
      attach[name].splice(Number(i), 1);
      paintAttach(name);
    };
    sheetForm.querySelectorAll('input[type=file]').forEach(input => {
      input.onchange = () => {
        const name = input.closest("[data-attach]").dataset.attach;
        [...input.files].forEach(file => addFile(name, file));
        input.value = "";
      };
    });
    const onPaste = event => {
      const name = Object.keys(attach)[0];
      if (!name) return;
      const files = [...(event.clipboardData?.files || [])].filter(f => f.type.startsWith("image/") || f.type === "application/pdf");
      if (!files.length) return;
      event.preventDefault();
      files.forEach(file => addFile(name, file));
    };
    document.addEventListener("paste", onPaste);

    const finish = value => {
      document.removeEventListener("paste", onPaste);
      sheet.onclose = null;
      if (sheet.open) sheet.close();
      resolve(value);
    };
    sheet.onclose = () => finish(null);
    sheetForm.onsubmit = event => {
      event.preventDefault();
      const data = new FormData(sheetForm);
      const out = {};
      for (const f of fields) {
        if (f.type === "note") continue;
        if (f.type === "checks") out[f.name] = data.getAll(f.name);
        else if (f.type === "checkbox") out[f.name] = data.has(f.name);
        else if (f.type === "attach") out[f.name] = attach[f.name];
        else out[f.name] = data.get(f.name);
      }
      finish(out);
    };
    sheetForm.querySelectorAll("[data-close]").forEach(b => { b.onclick = () => finish(null); });
    sheet.showModal();
    sheetForm.querySelector("input:not([type=checkbox]):not([type=file]),textarea,select")?.focus();
  });
}
