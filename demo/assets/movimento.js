/* Visual novo do painel (prévia de 16/10/2026, pedido do dono). Só roda com html.novo,
   que o index.html liga com "?novo=1". As animações não seguem o "reduzir movimento" do
   sistema: decisão do dono.
   - Barra lateral com os nomes das telas, que recolhe até ficar só com os ícones. A escolha
     fica salva; sem escolha, recolhe em janela com menos de 1280 px.
   - GSAP: a seleção da barra estica até a aba nova e assenta com mola; a tela que abre
     entra em cascata e o que está mais abaixo aparece ao rolar; a primeira abertura entra
     por partes; os cartões inclinam um pouco com o ponteiro.
   - ScrollSmoother: rolagem suave no computador, com mouse ou trackpad (no toque fica a
     rolagem do sistema).
   O index.html chama o que está em window.MOVIMENTO. Sem este arquivo ou sem o GSAP (sem
   rede), o painel anima como antes. */
(function(){
  "use strict";
  const raiz = document.documentElement;
  if(!raiz.classList.contains("novo") || window.MOVIMENTO) return;
  const { gsap, ScrollTrigger, ScrollSmoother } = window;
  const quandoPronto = fn => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once:true }) : fn();
  const noComputador = () => matchMedia("(min-width: 769px)").matches;
  const LIMPA = "transform,opacity";

  /* ------------------------------------------------ barra lateral que recolhe */
  const CHAVE = "gualapack-barra", LARGA = 1280;
  const guardar = v => { try{ v ? localStorage.setItem(CHAVE, v) : localStorage.removeItem(CHAVE); }catch(e){} };
  const fechada = () => raiz.classList.contains("barra-fechada");
  function rotularBotao(){
    const b = document.getElementById("rail-recolher");
    if(!b) return;
    const txt = fechada() ? "Expandir a barra lateral" : "Recolher a barra lateral";
    b.setAttribute("aria-label", txt);
    b.title = txt;
    b.setAttribute("aria-expanded", String(!fechada()));
  }
  // A largura da página muda uma vez só (os gráficos redesenham uma vez); o que anima é a
  // barra e o conteúdo deslizando até o lugar novo.
  function alternarBarra(fechar, animar){
    if(fechada() === fechar) return;
    const rail = document.querySelector(".rail");
    const antes = rail.getBoundingClientRect().width;
    raiz.classList.toggle("barra-fechada", fechar);
    rotularBotao();
    if(window.moverIndicadorBarra) window.moverIndicadorBarra();
    if(!animar || !gsap || !noComputador()) return;
    const depois = rail.getBoundingClientRect().width, dx = antes - depois;
    const vai = { duration: .5, ease: "power3.inOut" };
    gsap.fromTo(rail, { width: antes }, { width: depois, ...vai, clearProps: "width" });
    gsap.fromTo([".topbar", "main.content"], { x: dx }, { x: 0, ...vai, clearProps: "transform" });
  }
  function montarBarra(){
    rotularBotao();
    const b = document.getElementById("rail-recolher");
    if(b) b.addEventListener("click", ()=>{
      const f = !fechada();
      guardar(f ? "fechada" : "aberta");
      alternarBarra(f, true);
    });
    // a janela passou dos 1280 px, para mais ou para menos: a barra volta a se ajustar sozinha
    let larga = innerWidth >= LARGA;
    addEventListener("resize", ()=>{
      const agora = innerWidth >= LARGA;
      if(agora === larga) return;
      larga = agora;
      guardar(null);
      alternarBarra(!agora, false);
    });
    // a linha da conta inteira abre o cartão da conta, não só o avatar
    const conta = document.querySelector(".rail-conta"), foot = document.getElementById("rail-foot");
    if(conta && foot) conta.addEventListener("click", e=>{
      if(e.target.closest(".rail-foot")) return;
      e.stopPropagation();
      foot.click();
    });
  }

  /* ------------------------------------------------ altura do topo fixo */
  const topo = () => document.querySelector(".topbar");
  const alturaTopo = () => (noComputador() && topo()) ? topo().getBoundingClientRect().height : 0;
  function medirTopo(){
    const t = topo();
    if(!t) return;
    const por = ()=> raiz.style.setProperty("--topo-h", Math.round(t.getBoundingClientRect().height) + "px");
    new ResizeObserver(por).observe(t);
    por();
  }

  quandoPronto(()=>{ montarBarra(); medirTopo(); });
  if(!gsap) return;
  gsap.registerPlugin(...[ScrollTrigger, ScrollSmoother].filter(Boolean));
  raiz.classList.add("anima");

  /* ------------------------------------------------ seleção da barra */
  // A ponta da frente vai até a aba nova, a de trás alcança e a seleção assenta com uma
  // mola curta: na barra lateral pelo "y"; na barra de baixo do celular, pelo "x".
  let indPronto = false;
  function indicador(ind, b, animar){
    const vertical = getComputedStyle(ind.parentElement).flexDirection === "column";
    const alvo = vertical ? { x: 0, y: b.offsetTop, height: b.offsetHeight }
                          : { x: b.offsetLeft, y: b.offsetTop, width: b.offsetWidth, height: b.offsetHeight };
    if(vertical) ind.style.width = "";
    gsap.killTweensOf(ind);
    if(!animar || !indPronto){
      gsap.set(ind, { ...alvo, opacity: 1 });
      ind.classList.add("pronto");
      indPronto = true;
      return true;
    }
    const eixo = vertical ? "y" : "x", tam = vertical ? "height" : "width";
    const p0 = Number(gsap.getProperty(ind, eixo)), t0 = Number(gsap.getProperty(ind, tam));
    const p1 = alvo[eixo], t1 = alvo[tam];
    const tl = gsap.timeline();
    tl.set(ind, vertical ? { x: 0 } : { y: alvo.y, height: alvo.height });
    if(p1 >= p0){
      tl.to(ind, { [tam]: p1 + t1 - p0, duration: .16, ease: "power2.in" })
        .to(ind, { [eixo]: p1, [tam]: t1, duration: .5, ease: "back.out(1.5)" });
    }else{
      tl.to(ind, { [eixo]: p1, [tam]: p0 + t0 - p1, duration: .16, ease: "power2.in" })
        .to(ind, { [tam]: t1, duration: .5, ease: "back.out(1.5)" });
    }
    return true;
  }

  /* ------------------------------------------------ telas */
  // Os blocos de uma tela: cada seção; as grades (cartões, dois painéis lado a lado) entram
  // peça por peça.
  const EXPANDE = el => {
    if(el.matches(".barra-filtros, .segmented")) return false;
    const d = getComputedStyle(el).display, n = el.children.length;
    return (d === "grid" || d === "flex") && n > 1 && n <= 24;
  };
  const visivel = el => !el.hidden && el.getClientRects().length > 0;
  function blocosDa(view){
    const blocos = [];
    [...view.children].filter(visivel).forEach(el=>{
      if(EXPANDE(el)) blocos.push(...[...el.children].filter(visivel));
      else blocos.push(el);
    });
    return blocos;
  }
  // O que está abaixo da janela aparece ao rolar. Só a opacidade e a posição mudam: o
  // teclado continua chegando a tudo (o foco rola até lá e o bloco aparece).
  let gatilhos = [], escondidos = [];
  function soltarEscondidos(){
    gatilhos.forEach(t=> t.kill());
    gatilhos = [];
    if(escondidos.length){ gsap.killTweensOf(escondidos); gsap.set(escondidos, { clearProps: LIMPA }); }
    escondidos = [];
  }
  function revelarAoRolar(els){
    if(!ScrollTrigger || !els.length) return;
    escondidos = els.slice();
    gsap.set(els, { y: 44, opacity: 0 });
    gatilhos = ScrollTrigger.batch(els, {
      start: "top 92%", once: true, interval: .08,
      onEnter: lote => gsap.to(lote, { y: 0, opacity: 1, duration: .85, ease: "power3.out", stagger: .09, overwrite: true, clearProps: LIMPA,
        onComplete: ()=>{ escondidos = escondidos.filter(e=> !lote.includes(e)); } }),
    });
  }
  function entrarTela(view, atraso = 0){
    if(!view) return;
    soltarEscondidos();
    const blocos = blocosDa(view), fundo = innerHeight;
    const acima = [], abaixo = [];
    // o que aparece sem rolar (mesmo que só um pedaço) entra agora; nada visível fica escondido
    blocos.forEach(el=> (el.getBoundingClientRect().top < fundo ? acima : abaixo).push(el));
    const titulo = document.getElementById("view-title");
    if(titulo) gsap.fromTo(titulo, { y: 12, opacity: 0, filter: "blur(8px)" },
      { y: 0, opacity: 1, filter: "blur(0px)", duration: .6, ease: "power3.out", delay: atraso, overwrite: true, clearProps: LIMPA + ",filter" });
    gsap.fromTo(acima, { y: 28, opacity: 0, scale: .985 },
      { y: 0, opacity: 1, scale: 1, duration: .75, ease: "power3.out", stagger: .06, delay: atraso + .06, overwrite: true, clearProps: LIMPA });
    // as máquinas dos quadros entram uma a uma, logo atrás do painel delas
    const cartoes = acima.flatMap(el=> [...el.querySelectorAll(".machine-card, .agora-card")]).filter(visivel).slice(0, 48);
    if(cartoes.length) gsap.fromTo(cartoes, { y: 12, opacity: 0 },
      { y: 0, opacity: 1, duration: .5, ease: "power2.out", stagger: .018, delay: atraso + .22, overwrite: true, clearProps: LIMPA });
    revelarAoRolar(abaixo);
  }

  /* ------------------------------------------------ primeira abertura */
  function entrada(){
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    const rail = document.querySelector(".rail");
    if(rail && noComputador()){
      tl.from(rail, { x: -36, opacity: 0, duration: .9, ease: "expo.out", clearProps: LIMPA }, 0);
      const itens = [...rail.querySelectorAll(".rail-recolher, .rail-nav > .rail-btn, .rail-grupo > *, .rail-nav > .rail-sep, .rail-conta")].filter(visivel);
      tl.from(itens, { x: -14, opacity: 0, duration: .55, stagger: .028, clearProps: LIMPA }, .15);
    }else if(rail){
      tl.from(rail, { y: 40, opacity: 0, duration: .8, ease: "expo.out", clearProps: LIMPA }, .1);
    }
    tl.from([...document.querySelectorAll(".topbar-left, .topbar-right > *")].filter(visivel), { y: -14, opacity: 0, duration: .6, stagger: .06, clearProps: LIMPA }, .08);
    tl.add(()=> entrarTela(document.querySelector(".view.active")), .2);
  }

  /* ------------------------------------------------ toques */
  // o ícone da aba escolhida dá um pulinho
  function montarToques(){
    document.addEventListener("click", e=>{
      const b = e.target.closest ? e.target.closest(".rail-btn, .rail-recolher") : null;
      const svg = b && b.querySelector("svg");
      if(svg) gsap.fromTo(svg, { scale: .72 }, { scale: 1, duration: .6, ease: "elastic.out(1.1, .45)", overwrite: true, clearProps: "transform" });
    });
  }
  // os cartões inclinam um pouco na direção do ponteiro e sobem 3 px
  function montarInclinacao(){
    if(!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const SEL = ".oee-card, .kpi, .mp-card";
    let atual = null, rx = null, ry = null;
    const soltar = ()=>{
      if(!atual) return;
      gsap.to(atual, { rotationX: 0, rotationY: 0, y: 0, duration: .6, ease: "power3.out", overwrite: true, clearProps: "transform" });
      atual = null;
    };
    document.addEventListener("pointermove", e=>{
      if(e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const card = e.target.closest ? e.target.closest(SEL) : null;
      if(card !== atual){
        soltar();
        if(!card) return;
        atual = card;
        gsap.set(card, { transformPerspective: 900 });
        rx = gsap.quickTo(card, "rotationX", { duration: .5, ease: "power3" });
        ry = gsap.quickTo(card, "rotationY", { duration: .5, ease: "power3" });
        gsap.to(card, { y: -3, duration: .4, ease: "power3.out" });
      }
      if(!atual) return;
      const r = atual.getBoundingClientRect();
      rx(((e.clientY - r.top) / r.height - .5) * -5);
      ry(((e.clientX - r.left) / r.width - .5) * 6);
    }, { passive: true });
    document.addEventListener("mouseout", e=>{ if(!e.relatedTarget) soltar(); });
  }

  /* ------------------------------------------------ rolagem suave */
  let suave = null;
  function montarRolagem(){
    const conteudo = document.querySelector("main.content");
    if(!conteudo || !ScrollTrigger) return;
    // o ScrollSmoother pede o conteúdo dentro de #smooth-wrapper > #smooth-content; o topo e a
    // barra lateral, que ficam fixos, continuam fora
    if(ScrollSmoother && !document.getElementById("smooth-wrapper")){
      const wrap = document.createElement("div"), cont = document.createElement("div");
      wrap.id = "smooth-wrapper";
      cont.id = "smooth-content";
      conteudo.before(wrap);
      wrap.appendChild(cont);
      cont.appendChild(conteudo);
    }
    if(ScrollSmoother) gsap.matchMedia().add("(min-width: 769px) and (pointer: fine)", ()=>{
      suave = ScrollSmoother.create({ wrapper: "#smooth-wrapper", content: "#smooth-content", smooth: .9,
        smoothTouch: false, effects: false, normalizeScroll: false, ignoreMobileResize: true });
      raiz.classList.add("suave");
      return ()=>{ if(suave) suave.kill(); suave = null; raiz.classList.remove("suave"); };
    });
    // o conteúdo muda de altura (dados que chegam, troca de tela): recalcula onde cada bloco aparece
    let t = 0;
    new ResizeObserver(()=>{ clearTimeout(t); t = setTimeout(()=> ScrollTrigger.refresh(), 200); }).observe(conteudo);
  }
  function rolar(alvo, animado){
    if(!suave) return false;
    if(typeof alvo === "number") suave.scrollTo(alvo, !!animado);
    else suave.scrollTo(alvo, animado !== false, "top " + Math.round(alturaTopo() + 14) + "px");
    return true;
  }

  quandoPronto(()=>{ montarRolagem(); montarToques(); montarInclinacao(); });
  window.MOVIMENTO = { indicador, entrarTela, entrada, rolar, alternarBarra, get suave(){ return suave; } };
})();
