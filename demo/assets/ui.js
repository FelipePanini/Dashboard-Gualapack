/* Menus e dicas no tema do painel (index, qualidade e admin).

   1. Menu pop-up no lugar da lista nativa do <select> (no Windows, a lista azul
      do sistema). O <select> continua sendo o botão e a fonte do valor: a
      escolha muda select.value e dispara "change", então o código de cada tela
      não muda. Só com mouse ou teclado: no toque (celular), fica o seletor do
      próprio sistema, que é o que as pessoas conhecem ali.
   2. Dica ("help tag") no lugar da dica nativa do title (e do <title> dos
      gráficos SVG): aparece com um pequeno atraso, no vidro do painel.

   Sem dependências; cada página só inclui este arquivo. */
(function(){
  "use strict";
  if(window.__uiPainel) return;
  window.__uiPainel = true;

  const reduzMovimento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ponteiroFino = () => window.matchMedia("(pointer: fine)").matches;

  /* ---------------------------------------------------------------- estilo */
  const css = `
.gp-menu{
  position:fixed; z-index:1000; min-width:180px; max-width:min(380px, calc(100vw - 16px));
  overflow-y:auto; overscroll-behavior:contain; padding:5px; border-radius:12px;
  background: var(--glass-bg-strong, #fff);
  backdrop-filter: blur(24px) saturate(1.4); -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border:1px solid var(--glass-border, var(--border, #d6dee8));
  box-shadow: var(--shadow-pop, 0 12px 40px -12px rgba(10,21,36,.32), 0 2px 6px rgba(10,21,36,.06));
  font-family:inherit; font-size:13px; color: var(--text-primary, #0a1524);
  transform-origin: top center; outline:none;
  animation: gp-menu-in .28s var(--spring, cubic-bezier(.32,.72,0,1));
}
.gp-menu.acima{ transform-origin: bottom center; }
@keyframes gp-menu-in{ from{ opacity:0; transform: scale(.97) translateY(-4px); } }
.gp-menu.acima{ animation-name: gp-menu-in-acima; }
@keyframes gp-menu-in-acima{ from{ opacity:0; transform: scale(.97) translateY(4px); } }
.gp-menu.saindo{ animation: gp-menu-out .14s var(--ease-out, ease-out) forwards; }
@keyframes gp-menu-out{ to{ opacity:0; transform: scale(.98); } }
.gp-menu-grupo{
  padding:8px 10px 4px 30px; font-size:11px; font-weight:650; letter-spacing:.02em;
  color: var(--text-muted, #5b6b7d); text-transform:none;
}
.gp-menu-sep{ height:1px; margin:5px 8px; background: var(--border, #d6dee8); }
.gp-item{
  position:relative; display:flex; align-items:baseline; gap:16px; min-height:30px;
  padding:6px 10px 6px 30px; border-radius:7px; cursor:default; user-select:none;
  white-space:nowrap; transition: background-color .12s var(--ease-out, ease-out);
}
.gp-item .gp-nome{ flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.gp-item .gp-det{ color: var(--text-muted, #5b6b7d); font-size:12px; font-variant-numeric: tabular-nums; }
.gp-item.ativo{ background: var(--accent-soft, #dbeaf8); }
.gp-item[aria-selected="true"]{ font-weight:650; }
.gp-item[aria-selected="true"] .gp-nome{ color: var(--accent, #0f5ea6); }
.gp-item .gp-check{
  position:absolute; left:9px; top:50%; width:13px; height:13px; margin-top:-6.5px; color: var(--accent, #0f5ea6);
}
.gp-item[aria-disabled="true"]{ opacity:.45; }
.gp-item[aria-disabled="true"].ativo{ background:transparent; }
.gp-dica{
  position:fixed; z-index:1001; pointer-events:none; max-width:280px;
  padding:6px 9px; border-radius:8px; font-size:12px; line-height:1.4; font-weight:500;
  color: var(--text-primary, #0a1524);
  background: var(--glass-bg-strong, #fff);
  backdrop-filter: blur(20px) saturate(1.4); -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border:1px solid var(--glass-border, var(--border, #d6dee8));
  box-shadow: var(--shadow-pop, 0 12px 40px -12px rgba(10,21,36,.32), 0 2px 6px rgba(10,21,36,.06));
  animation: gp-dica-in .16s var(--ease-out, ease-out);
}
@keyframes gp-dica-in{ from{ opacity:0; transform: translateY(var(--gp-dy, 3px)); } }
@media (prefers-reduced-motion: reduce){
  .gp-menu, .gp-menu.acima, .gp-dica{ animation: gp-so-opacidade .12s linear; }
  .gp-menu.saindo{ animation: none; opacity:0; }
  @keyframes gp-so-opacidade{ from{ opacity:0; } }
}
@media (prefers-reduced-transparency: reduce){
  .gp-menu, .gp-dica{ backdrop-filter:none; -webkit-backdrop-filter:none; background: var(--surface-1, #fff); }
}
@media (prefers-contrast: more){
  .gp-menu, .gp-dica{ border-color: var(--border-strong, #6b819a); }
  .gp-item.ativo{ outline:1px solid var(--accent, #0f5ea6); }
}
@media (pointer: coarse){ .gp-item{ min-height:44px; align-items:center; } }
`;
  const estilo = document.createElement("style");
  estilo.textContent = css;
  document.head.appendChild(estilo);

  const CHECK = `<svg class="gp-check" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7"/></svg>`;
  const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  /* ---------------------------------------------------------------- menu */
  let aberto = null;   // { sel, menu, itens, ativo }
  let seq = 0;

  // "R18 · 32 OPs" vira nome à esquerda e detalhe à direita, alinhado
  function partes(txt){
    const i = txt.lastIndexOf(" · ");
    return i > 0 ? [txt.slice(0, i), txt.slice(i + 3)] : [txt, ""];
  }

  function abrirMenu(sel){
    if(sel.disabled || !sel.options.length) return;
    fecharMenu(false);
    const id = "gp-menu-" + (++seq);
    const menu = document.createElement("div");
    menu.className = "gp-menu";
    menu.id = id;
    menu.setAttribute("role", "listbox");
    menu.tabIndex = -1;
    const rotulo = sel.getAttribute("aria-label") || (sel.labels && sel.labels[0] ? sel.labels[0].textContent.trim() : "");
    if(rotulo) menu.setAttribute("aria-label", rotulo);

    const itens = [];
    let html = "";
    const addOpcao = (op, recuo) => {
      const k = itens.length;
      const [nome, det] = partes(op.textContent.trim());
      const sim = op.selected;
      html += `<div class="gp-item" role="option" id="${id}-${k}" data-k="${k}" aria-selected="${sim}"${op.disabled ? ` aria-disabled="true"` : ""}>` +
              `${sim ? CHECK : ""}<span class="gp-nome">${esc(nome)}</span>${det ? `<span class="gp-det">${esc(det)}</span>` : ""}</div>`;
      itens.push(op);
    };
    [...sel.children].forEach((filho, i) => {
      if(filho.tagName === "OPTGROUP"){
        if(i > 0) html += `<div class="gp-menu-sep" role="separator"></div>`;
        html += `<div class="gp-menu-grupo" role="presentation">${esc(filho.label)}</div>`;
        [...filho.children].forEach(op => addOpcao(op));
      }else if(filho.tagName === "OPTION"){
        // separador entre famílias de opção (ex.: as filas de pendência depois das máquinas)
        if(filho.dataset.separador != null && i > 0) html += `<div class="gp-menu-sep" role="separator"></div>`;
        addOpcao(filho);
      }
    });
    menu.innerHTML = html;
    document.body.appendChild(menu);

    // posição: abaixo do seletor, alinhado à esquerda; sem espaço, acima
    const r = sel.getBoundingClientRect();
    const margem = 8, folga = 6;
    menu.style.minWidth = Math.max(180, Math.round(r.width)) + "px";
    const alturaNatural = menu.scrollHeight;
    const abaixo = window.innerHeight - r.bottom - folga - margem;
    const acima = r.top - folga - margem;
    const paraCima = alturaNatural > abaixo && acima > abaixo;
    const altura = Math.min(alturaNatural, Math.max(120, paraCima ? acima : abaixo), 420);
    menu.style.maxHeight = altura + "px";
    if(paraCima){ menu.classList.add("acima"); menu.style.top = Math.round(r.top - folga - altura) + "px"; }
    else menu.style.top = Math.round(r.bottom + folga) + "px";
    const largura = menu.offsetWidth;
    menu.style.left = Math.round(Math.min(Math.max(margem, r.left), window.innerWidth - largura - margem)) + "px";

    aberto = { sel, menu, itens, ativo: -1 };
    sel.setAttribute("aria-expanded", "true");
    sel.setAttribute("aria-controls", id);
    marcar(Math.max(0, sel.selectedIndex), true);
    menu.focus({ preventScroll: true });

    menu.addEventListener("pointermove", e => {
      const el = e.target.closest(".gp-item");
      if(el) marcar(+el.dataset.k, false);
    });
    menu.addEventListener("pointerleave", () => marcar(-1, false));
    menu.addEventListener("click", e => {
      const el = e.target.closest(".gp-item");
      if(el) escolher(+el.dataset.k);
    });
    menu.addEventListener("keydown", teclaMenu);
  }

  function marcar(k, rolar){
    if(!aberto) return;
    const { menu } = aberto;
    const els = menu.querySelectorAll(".gp-item");
    els.forEach((el, i) => el.classList.toggle("ativo", i === k));
    aberto.ativo = k;
    if(k < 0){ menu.removeAttribute("aria-activedescendant"); return; }
    menu.setAttribute("aria-activedescendant", els[k].id);
    if(!rolar) return;
    // rola só o menu (scrollIntoView rolaria a página, e a rolagem fecha o menu)
    const el = els[k], topo = el.offsetTop - 5, base = el.offsetTop + el.offsetHeight + 5;
    if(topo < menu.scrollTop) menu.scrollTop = topo;
    else if(base > menu.scrollTop + menu.clientHeight) menu.scrollTop = base - menu.clientHeight;
  }

  function mover(passo){
    if(!aberto) return;
    const n = aberto.itens.length;
    let k = aberto.ativo;
    for(let i = 0; i < n; i++){
      k = k < 0 ? (passo > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, k + passo));
      if(!aberto.itens[k].disabled) break;
      if((passo > 0 && k === n - 1) || (passo < 0 && k === 0)) break;
    }
    marcar(k, true);
  }

  let busca = "", buscaTempo = 0;
  function teclaMenu(e){
    if(!aberto) return;
    const n = aberto.itens.length;
    switch(e.key){
      case "ArrowDown": e.preventDefault(); mover(1); return;
      case "ArrowUp": e.preventDefault(); mover(-1); return;
      case "Home": e.preventDefault(); marcar(0, true); return;
      case "End": e.preventDefault(); marcar(n - 1, true); return;
      case "PageDown": e.preventDefault(); mover(8); return;
      case "PageUp": e.preventDefault(); mover(-8); return;
      case "Enter": case " ":
        e.preventDefault();
        if(aberto.ativo >= 0) escolher(aberto.ativo); else fecharMenu(true);
        return;
      case "Escape": e.preventDefault(); fecharMenu(true); return;
      case "Tab": fecharMenu(true); return;
    }
    // digitar o começo do nome pula até ele
    if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey){
      clearTimeout(buscaTempo);
      busca += e.key.toLowerCase();
      buscaTempo = setTimeout(() => { busca = ""; }, 700);
      const k = aberto.itens.findIndex(op => !op.disabled && op.textContent.trim().toLowerCase().startsWith(busca));
      if(k >= 0) marcar(k, true);
    }
  }

  function escolher(k){
    if(!aberto) return;
    const { sel, itens } = aberto;
    const op = itens[k];
    if(!op || op.disabled) return;
    const mudou = sel.selectedIndex !== op.index;
    sel.selectedIndex = op.index;
    fecharMenu(true);
    if(mudou){
      sel.dispatchEvent(new Event("input", { bubbles:true }));
      sel.dispatchEvent(new Event("change", { bubbles:true }));
    }
  }

  function fecharMenu(devolverFoco){
    if(!aberto) return;
    const { sel, menu } = aberto;
    aberto = null;
    sel.setAttribute("aria-expanded", "false");
    sel.removeAttribute("aria-controls");
    if(devolverFoco) sel.focus({ preventScroll: true });
    if(reduzMovimento()){ menu.remove(); return; }
    menu.classList.add("saindo");
    menu.addEventListener("animationend", () => menu.remove(), { once:true });
    setTimeout(() => menu.remove(), 250);
  }

  // O seletor nativo não abre a lista dele: o clique (mouse) e as teclas que
  // abririam a lista (Alt+↓, F4, espaço, Enter) abrem o menu do painel.
  document.addEventListener("mousedown", e => {
    const sel = e.target instanceof Element ? e.target.closest("select") : null;
    if(aberto && !aberto.menu.contains(e.target) && aberto.sel !== sel) fecharMenu(false);
    if(!sel || sel.multiple || sel.size > 1 || !ponteiroFino() || e.button !== 0) return;
    e.preventDefault();
    if(aberto && aberto.sel === sel){ fecharMenu(true); return; }
    sel.focus({ preventScroll: true });
    abrirMenu(sel);
  }, true);
  document.addEventListener("keydown", e => {
    const sel = e.target instanceof HTMLSelectElement ? e.target : null;
    if(!sel || sel.multiple || sel.size > 1 || aberto) return;
    const abre = (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) || e.key === "F4" || e.key === " " || e.key === "Enter";
    if(!abre) return;
    e.preventDefault();
    abrirMenu(sel);
  }, true);
  const fecharSeAberto = e => {
    if(!aberto) return;
    if(e && e.type === "scroll" && aberto.menu.contains(e.target)) return;
    fecharMenu(false);
  };
  window.addEventListener("resize", fecharSeAberto);
  document.addEventListener("scroll", fecharSeAberto, true);
  window.addEventListener("blur", fecharSeAberto);
  document.addEventListener("focusin", e => {
    if(aberto && !aberto.menu.contains(e.target) && e.target !== aberto.sel) fecharMenu(false);
  });
  // os <select> passam a anunciar que abrem uma lista do painel
  const anunciar = raiz => (raiz.querySelectorAll ? raiz.querySelectorAll("select:not([multiple])") : []).forEach(s => {
    s.setAttribute("aria-haspopup", "listbox");
    if(!s.hasAttribute("aria-expanded")) s.setAttribute("aria-expanded", "false");
  });

  /* ---------------------------------------------------------------- dicas */
  let dica = null, dicaAlvo = null, dicaPendente = null, dicaTempo = 0, ultimaDica = 0;
  // depois de um clique, a dica desse elemento só volta quando o mouse sair dele de
  // verdade (mudança de layout logo após o clique não conta)
  let clicado = null, clicadoEm = 0;
  const ATRASO = 500, QUENTE = 600;   // depois de uma dica, a próxima vem na hora (como no macOS)

  // título nativo (atributo ou <title> do SVG) vira data-dica: a dica nativa não aparece mais
  function textoDica(el){
    if(el.hasAttribute("title")){
      const t = el.getAttribute("title");
      el.removeAttribute("title");
      if(t) el.setAttribute("data-dica", t);
    }
    if(el instanceof SVGElement){
      const filho = [...el.children].find(c => c.tagName.toLowerCase() === "title");
      if(filho){ el.setAttribute("data-dica", filho.textContent); filho.remove(); }
    }
    return el.getAttribute("data-dica") || "";
  }
  function alvoDe(no){
    for(let el = no instanceof Element ? no : null; el && el !== document.body; el = el.parentElement){
      if(el.hasAttribute("title") || el.hasAttribute("data-dica")) return el;
      if(el instanceof SVGElement && [...el.children].some(c => c.tagName.toLowerCase() === "title")) return el;
    }
    return null;
  }
  function mostrarDica(el){
    const texto = textoDica(el).trim();
    if(!texto || !el.isConnected) return;
    // a dica do próprio gráfico (que segue o mouse) já está aberta: não sobrepõe
    if(document.querySelector(".chart-tooltip")) return;
    esconderDica();
    dica = document.createElement("div");
    dica.className = "gp-dica";
    dica.id = "gp-dica";
    dica.setAttribute("role", "tooltip");
    dica.textContent = texto;
    document.body.appendChild(dica);
    const r = el.getBoundingClientRect(), w = dica.offsetWidth, h = dica.offsetHeight, m = 8;
    let x, y;
    if(el.closest(".rail")){            // barra lateral: à direita do botão
      x = r.right + 10; y = r.top + r.height/2 - h/2;
      dica.style.setProperty("--gp-dy", "0px");
    }else{
      x = r.left + r.width/2 - w/2; y = r.bottom + 8;
      if(y + h > window.innerHeight - m){ y = r.top - h - 8; dica.style.setProperty("--gp-dy", "-3px"); }
    }
    dica.style.left = Math.round(Math.min(Math.max(m, x), window.innerWidth - w - m)) + "px";
    dica.style.top = Math.round(Math.min(Math.max(m, y), window.innerHeight - h - m)) + "px";
    dicaAlvo = el;
    if(el.getAttribute("aria-label") !== texto && !el.hasAttribute("aria-describedby")){
      el.setAttribute("aria-describedby", "gp-dica");
      el.dataset.gpDescrito = "1";
    }
  }
  function esconderDica(){
    clearTimeout(dicaTempo);
    dicaTempo = 0;
    dicaPendente = null;
    if(dica){ dica.remove(); dica = null; ultimaDica = Date.now(); }
    if(dicaAlvo && dicaAlvo.dataset.gpDescrito){ dicaAlvo.removeAttribute("aria-describedby"); delete dicaAlvo.dataset.gpDescrito; }
    dicaAlvo = null;
  }
  function agendar(el){
    clearTimeout(dicaTempo);
    textoDica(el);   // já tira o title, antes que a dica nativa apareça
    const quente = dica || Date.now() - ultimaDica < QUENTE;
    dicaPendente = el;
    dicaTempo = setTimeout(() => { dicaPendente = null; dicaTempo = 0; mostrarDica(el); }, quente ? 0 : ATRASO);
  }
  document.addEventListener("pointerover", e => {
    if(e.pointerType !== "mouse") return;
    const el = alvoDe(e.target);
    if(el && el === clicado) return;
    if(el && (el === dicaAlvo || el === dicaPendente)) return;
    if(!el){ if(dica || dicaTempo) esconderDica(); return; }
    esconderDica();
    agendar(el);
  });
  document.addEventListener("pointerout", e => {
    if(clicado && alvoDe(e.relatedTarget) !== clicado && alvoDe(e.target) === clicado && Date.now() - clicadoEm > 800) clicado = null;
    if(!dicaAlvo && !dicaTempo) return;
    const para = alvoDe(e.relatedTarget);
    if(para !== alvoDe(e.target)) esconderDica();
  });
  // teclado: a dica aparece no foco visível e some no blur
  document.addEventListener("focusin", e => {
    const el = e.target instanceof Element && e.target.matches(":focus-visible") ? alvoDe(e.target) : null;
    if(el === e.target) agendar(el);
  });
  document.addEventListener("focusout", () => esconderDica());
  document.addEventListener("mousedown", e => { clicado = alvoDe(e.target); clicadoEm = Date.now(); esconderDica(); }, { capture:true, passive:true });
  document.addEventListener("wheel", () => esconderDica(), { capture:true, passive:true });
  document.addEventListener("scroll", () => esconderDica(), { capture:true, passive:true });
  document.addEventListener("keydown", e => { if(e.key === "Escape") esconderDica(); });

  /* ---------------------------------------------------------------- partida */
  const iniciar = () => {
    anunciar(document);
    new MutationObserver(lista => lista.forEach(m => m.addedNodes.forEach(n => { if(n.nodeType === 1) anunciar(n.tagName === "SELECT" ? n.parentNode || n : n); }))).observe(document.body, { childList:true, subtree:true });
  };
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();

  // para os testes
  window.uiPainel = { abrirMenu, fecharMenu: () => fecharMenu(false), menuAberto: () => !!aberto };
})();
