/* Máscaras de data e valor (17/10/2026) — a MESMA em Dudoo Web, Dudoo Life e Dudoo Trips (cópia em cada app).
   O teclado numérico do iPhone não tem "/" nem "." — digita-se só números e, ao SAIR do campo, o texto se ajusta sozinho:
   - data (campo com data-mascara="data" ou placeholder "DD/MM…"): 21052021 → 21/05/2021 · 210521 → 21/05/2021 · 2105 → 21/05/<ano atual>
     (se o campo só pede DD/MM, fica 21/05); data inválida fica como foi digitada (o app avisa ao salvar);
   - valor (data-mascara="dinheiro"): 145000 → 145.000,00 · 12,5 → 12,50 · 1.234 → 1.234,00. Conta ("180 x 7"), letras e mais de 2 casas
     decimais (cotação) não são mexidos. */
(function () {
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };

  function dataBR(valor, placeholder) {
    var v = String(valor || "").trim();
    if (!v) return null;
    var d, m, a, partes = v.split(/\D+/).filter(Boolean);
    if (/\D/.test(v) && partes.length >= 2) { d = partes[0]; m = partes[1]; a = partes[2]; }
    else {
      var s = v.replace(/\D/g, "");
      if (s.length === 8) { d = s.slice(0, 2); m = s.slice(2, 4); a = s.slice(4); }
      else if (s.length === 7) { d = s.slice(0, 1); m = s.slice(1, 3); a = s.slice(3); }
      else if (s.length === 6) { d = s.slice(0, 2); m = s.slice(2, 4); a = s.slice(4); }
      else if (s.length === 4) { d = s.slice(0, 2); m = s.slice(2, 4); }
      else return null;
    }
    d = Number(d); m = Number(m);
    var pedeAno = /AAAA/.test(placeholder || ""), ano = null;
    if (a != null && a !== "") {
      a = String(a);
      if (a.length === 2) { var yy = Number(a), atual = new Date().getFullYear() % 100; ano = yy <= atual + 10 ? 2000 + yy : 1900 + yy; }
      else if (a.length === 4) ano = Number(a);
      else return null;
    } else if (pedeAno) ano = new Date().getFullYear();
    var teste = new Date(Date.UTC(ano || 2000, m - 1, d));
    if (!(d >= 1 && m >= 1 && m <= 12) || teste.getUTCMonth() !== m - 1 || teste.getUTCDate() !== d) return null;
    return pad(d) + "/" + pad(m) + (ano ? "/" + ano : "");
  }

  function dinheiroBR(valor) {
    var limpo = String(valor || "").trim().replace(/R\$|\s/g, "");
    if (!limpo || /[^\d.,]/.test(limpo)) return null;             // conta ou texto: não mexe
    var inteiro, dec = "", i = limpo.lastIndexOf(",");
    if (i >= 0) { inteiro = limpo.slice(0, i).replace(/\./g, ""); dec = limpo.slice(i + 1).replace(/\./g, ""); }
    else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) inteiro = limpo.replace(/\./g, "");      // 3.800 = 3800
    else if (/^\d+\.\d{1,2}$/.test(limpo)) { var p = limpo.split("."); inteiro = p[0]; dec = p[1]; }
    else inteiro = limpo.replace(/\./g, "");
    if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(dec)) return null;
    if (inteiro === "") inteiro = "0";
    var grupos = inteiro.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return dec.length > 2 ? grupos + "," + dec : grupos + "," + (dec + "00").slice(0, 2);
  }

  document.addEventListener("focusout", function (e) {
    var el = e.target;
    if (!el || el.tagName !== "INPUT" || el.type === "date" || el.type === "time" || el.type === "number") return;
    var tipo = el.getAttribute("data-mascara") || (/^DD\/MM/.test(el.getAttribute("placeholder") || "") ? "data" : "");
    if (!tipo) return;
    var novo = tipo === "data" ? dataBR(el.value, el.getAttribute("placeholder")) : dinheiroBR(el.value);
    if (novo != null && novo !== el.value) el.value = novo;
  }, true);

  window.MascarasDudoo = { dataBR: dataBR, dinheiroBR: dinheiroBR };
})();
