/* Abertura da tela de login (15/10/2026; prévia em login.html?intro=1, aprovada e padrão).

   1. A marca Gualapack acende conforme a página rola: uma sequência de quadros no
      canvas, presa à rolagem pelo ScrollTrigger (scrub), como a demo "Image Sequence"
      da GSAP (a apresentação dos AirPods da Apple). A marca não tem uma sequência de
      fotos, então cada quadro é desenhado na hora: escura no começo, clara no fim,
      com um brilho que passa pelas letras e o reflexo embaixo.
   2. Uma pílula convida a rolar e mostra quanto falta (o anel enche com a rolagem);
      tocar nela leva direto ao login, para quem não quer rolar ou usa o teclado.
   3. O cartão de login inclina em perspectiva seguindo o ponteiro (só com mouse; bem
      mais leve enquanto a pessoa digita).
   4. Login certo: uma cortina em curva (MorphSVG) cobre a tela e abre o painel.

   Na primeira visita a abertura começa do topo; nas seguintes a página abre já no login
   (rolar para cima revê a abertura). "?intro=1" força o começo.
   Com "?intro=0" nada disso roda: fica o login simples. Com "reduzir movimento" no sistema a
   abertura roda mesmo assim (decisão do dono, 16/10).
   GSAP 3.15 (ScrollTrigger, ScrollToPlugin e MorphSVGPlugin) vem do CDN. */
(function(){
  "use strict";
  const { gsap, ScrollTrigger, ScrollToPlugin, MorphSVGPlugin } = window;
  const raiz = document.documentElement;
  if(!gsap || !ScrollTrigger || !MorphSVGPlugin){ raiz.classList.remove("intro"); return; }
  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin, MorphSVGPlugin);

  const card = document.querySelector(".card");
  const toque = !window.matchMedia("(pointer: fine)").matches;
  // depois de ver a abertura uma vez, as próximas visitas abrem já no login
  const marcarVista = ()=>{ try{ localStorage.setItem("gualapack-abertura-vista", "1"); }catch(e){} };
  const doComeco = !window.ABERTURA || window.ABERTURA.doComeco;

  /* ------------------------------------------------------------------ palco e acesso */
  const palco = document.createElement("section");
  palco.className = "intro-palco";
  palco.setAttribute("aria-label", "Gualapack Brasil, Painel de Produção");
  const C = 2 * Math.PI * 15;
  palco.innerHTML = `
    <canvas id="logo-seq" aria-hidden="true"></canvas>
    <button type="button" class="rolar-dica" id="rolar-dica" aria-label="Ir para o login">
      <span class="anel" aria-hidden="true">
        <svg viewBox="0 0 36 36"><circle class="trilho" cx="18" cy="18" r="15"/>
          <circle class="progresso" cx="18" cy="18" r="15" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${C.toFixed(2)}"/></svg>
        <svg class="gesto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v13"/><path d="M6.5 12.5L12 18l5.5-5.5"/></svg>
      </span>
      <span class="txt"><b>${toque ? "Deslize para entrar" : "Role para entrar"}</b><small>ou toque aqui</small></span>
    </button>`;
  const acesso = document.createElement("section");
  acesso.className = "intro-acesso";
  acesso.id = "acesso";
  card.parentNode.insertBefore(palco, card);
  palco.after(acesso);
  acesso.appendChild(card);
  const brilho = document.createElement("span");
  brilho.className = "card-brilho";
  brilho.setAttribute("aria-hidden", "true");
  card.prepend(brilho);

  /* ------------------------------------------------------------------ a sequência
     O auxiliar "imageSequence" da demo da GSAP, com uma troca: em vez de uma lista de
     imagens, uma função desenha cada quadro (a conta é a mesma: o tween leva o quadro
     de 0 ao último e só redesenha quando o número muda). */
  function sequenciaDeQuadros(cfg){
    const playhead = { frame: 0 };
    let atual = -1;
    const atualizar = ()=>{
      const f = Math.round(playhead.frame);
      if(f === atual) return;
      atual = f;
      cfg.desenhar(f / (cfg.quadros - 1), f);
      if(cfg.onUpdate) cfg.onUpdate(f);
    };
    atualizar();
    const tween = gsap.to(playhead, { frame: cfg.quadros - 1, ease: "none", onUpdate: atualizar,
      duration: cfg.quadros / (cfg.fps || 30), paused: !!cfg.paused, scrollTrigger: cfg.scrollTrigger });
    return { tween, redesenhar(){ atual = -1; atualizar(); } };
  }

  const canvas = document.getElementById("logo-seq");
  const ctx = canvas.getContext("2d");
  const camada = document.createElement("canvas");          // as letras, para o brilho ficar só nelas
  const cctx = camada.getContext("2d");
  const espelho = document.createElement("canvas");         // o reflexo, que some em direção ao chão
  const ectx = espelho.getContext("2d");
  const FUNDO = "#03070d";
  const clamp = gsap.utils.clamp(0, 1);
  const suave = gsap.parseEase("power2.inOut");
  const misturar = (a, b, t) => gsap.utils.interpolate(a, b, t);
  let W = 0, H = 0, DPR = 1;

  function medir(){
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    for(const c of [canvas, camada, espelho]){ c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  }

  function desenhar(t){
    const luz = suave(clamp((t - 0.04) / 0.72));               // 0 escura → 1 clara
    const brilhoPos = -0.35 + 1.7 * clamp((t - 0.08) / 0.7);   // a faixa de luz atravessa a marca
    const fim = clamp((t - 0.62) / 0.3);                       // "BRASIL" e o painel aparecem no fim
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = FUNDO;
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.45;
    // halo azul atrás da marca: cresce com a luz
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.62);
    halo.addColorStop(0, `rgba(47,120,196,${0.04 + 0.30 * luz})`);
    halo.addColorStop(0.55, `rgba(15,94,166,${0.02 + 0.10 * luz})`);
    halo.addColorStop(1, "rgba(3,7,13,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // a marca ocupa no máximo 86% da largura (no celular, quase toda)
    let tam = Math.min(W * 0.2, H * 0.25, 220);
    cctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cctx.clearRect(0, 0, W, H);
    cctx.font = `italic 700 ${tam}px "Playfair Display", Georgia, serif`;
    const largura = cctx.measureText("Gualapack").width;
    tam *= Math.min(1, W * 0.86 / largura) * (0.93 + 0.07 * luz);
    cctx.font = `italic 700 ${tam}px "Playfair Display", Georgia, serif`;
    const wG = cctx.measureText("Guala").width, wP = cctx.measureText("pack").width;
    const x0 = cx - (wG + wP) / 2, base = cy + tam * 0.28;
    cctx.textBaseline = "alphabetic";
    cctx.fillStyle = misturar("#141b26", "#f3f7fb", luz);
    cctx.fillText("Guala", x0, base);
    cctx.fillStyle = misturar("#0b1d33", "#5aa7ec", luz);
    cctx.fillText("pack", x0 + wG, base);
    // a faixa de luz, só por cima das letras
    cctx.globalCompositeOperation = "source-atop";
    const bx = x0 + brilhoPos * (wG + wP), larg = tam * 1.4;
    const faixa = cctx.createLinearGradient(bx - larg, 0, bx + larg, 0);
    const forca = 0.18 + 0.5 * Math.sin(Math.PI * clamp((t - 0.08) / 0.7));
    faixa.addColorStop(0, "rgba(255,255,255,0)");
    faixa.addColorStop(0.5, `rgba(255,255,255,${forca})`);
    faixa.addColorStop(1, "rgba(255,255,255,0)");
    cctx.fillStyle = faixa;
    cctx.fillRect(x0 - larg, base - tam, wG + wP + 2 * larg, tam * 1.3);
    cctx.globalCompositeOperation = "source-over";

    // brilho difuso da marca acesa
    ctx.save();
    ctx.shadowColor = `rgba(90,167,236,${0.55 * luz})`;
    ctx.shadowBlur = 40 * luz;
    ctx.drawImage(camada, 0, 0, W, H);
    ctx.restore();
    // reflexo embaixo, como as fotos de produto: espelhado, fraco, sumindo no chão (a
    // máscara fica na camada do reflexo; o halo atrás continua inteiro)
    const yRef = base + tam * 0.1;
    ectx.setTransform(1, 0, 0, 1, 0, 0);
    ectx.clearRect(0, 0, espelho.width, espelho.height);
    ectx.setTransform(DPR, 0, 0, -DPR, 0, 2 * yRef * DPR);
    ectx.drawImage(camada, 0, 0, W, H);
    ectx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ectx.globalCompositeOperation = "destination-in";
    const some = ectx.createLinearGradient(0, yRef, 0, yRef + tam * 0.34);   // termina antes do filete
    some.addColorStop(0, "rgba(0,0,0,1)");
    some.addColorStop(1, "rgba(0,0,0,0)");
    ectx.fillStyle = some;
    ectx.fillRect(0, 0, W, H);
    ectx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = 0.22 * luz;
    ctx.drawImage(espelho, 0, 0, W, H);
    ctx.restore();

    // filete, "BRASIL" e o nome do painel
    if(fim > 0){
      const esp = Math.max(tam, 110);                          // o texto pequeno não se aperta no celular
      const yR = base + esp * 0.36;
      const meia = (wG + wP) / 2 * suave(fim);
      ctx.strokeStyle = `rgba(167,190,214,${0.45 * fim})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - meia, yR); ctx.lineTo(cx + meia, yR); ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(167,190,214,${fim})`;
      ctx.font = `600 ${Math.max(11, tam * 0.085)}px "Public Sans", system-ui, sans-serif`;
      if("letterSpacing" in ctx) ctx.letterSpacing = `${Math.max(2, tam * 0.03)}px`;
      ctx.fillText("BRASIL · UNIDADE JAGUARIÚNA", cx, yR + esp * 0.2);
      if("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      ctx.fillStyle = `rgba(238,243,249,${fim})`;
      ctx.font = `700 ${Math.max(15, tam * 0.15)}px "Archivo", "Public Sans", system-ui, sans-serif`;
      ctx.fillText("Painel de Produção", cx, yR + esp * 0.55);
      ctx.textAlign = "start";
    }
  }

  medir();
  const dica = document.getElementById("rolar-dica");
  const anel = dica.querySelector(".progresso");
  let seq = null;
  // a fonte da marca precisa estar carregada antes do primeiro quadro
  const fontes = document.fonts ? Promise.all([
    document.fonts.load('italic 700 120px "Playfair Display"'), document.fonts.load('700 20px "Archivo"'), document.fonts.load('600 12px "Public Sans"'),
  ]).catch(()=>{}) : Promise.resolve();
  fontes.then(()=>{
    seq = sequenciaDeQuadros({
      quadros: 150,
      desenhar,
      scrollTrigger: {
        trigger: palco, start: "top top", end: "+=160%", pin: true, scrub: 0.6, anticipatePin: 1,
        onUpdate: self =>{
          anel.style.strokeDashoffset = (C * (1 - self.progress)).toFixed(2);
          dica.classList.toggle("sumindo", self.progress > 0.92);
          if(self.progress > 0.98) marcarVista();
        },
      },
    });
    // visita seguinte: direto no login (a abertura fica acima, acesa)
    if(!doComeco){
      ScrollTrigger.refresh();
      window.scrollTo(0, ScrollTrigger.maxScroll(window));
      ScrollTrigger.update();
    }
    window.INTRO = { seq, palco, acesso, desenhar, doComeco };
  });
  window.addEventListener("resize", ()=>{ medir(); if(seq) seq.redesenhar(); });

  // a pílula: leva direto ao login (a sequência corre junto, pela rolagem)
  dica.addEventListener("click", ()=>{
    marcarVista();
    gsap.to(window, { duration: 1.8, ease: "power2.inOut", scrollTo: { y: acesso, autoKill: true } });
  });
  // a pílula chama a atenção depois de um tempo parada no topo
  gsap.to(dica.querySelector(".gesto"), { y: 3, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1, repeatDelay: 0.6 });

  // o cartão entra quando a área de acesso chega
  gsap.from(card, { autoAlpha: 0, y: 48, scale: 0.97, duration: 0.9, ease: "power3.out",
    scrollTrigger: { trigger: acesso, start: "top 70%", toggleActions: "play none none reverse" } });

  /* ------------------------------------------------------------------ inclinação
     "Cursor-driven perspective tilt": o cartão gira em X e Y para o lado do ponteiro, com
     quickTo (um tween reaproveitado, não um por movimento), e um brilho segue o ponteiro. */
  if(!toque){
    gsap.set(card, { transformPerspective: 1100 });
    const rx = gsap.quickTo(card, "rotationX", { duration: 0.7, ease: "power3" });
    const ry = gsap.quickTo(card, "rotationY", { duration: 0.7, ease: "power3" });
    const bx = gsap.quickTo(brilho, "x", { duration: 0.5, ease: "power3" });
    const by = gsap.quickTo(brilho, "y", { duration: 0.5, ease: "power3" });
    const digitando = () => card.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    acesso.addEventListener("pointermove", e =>{
      const r = card.getBoundingClientRect();
      const px = gsap.utils.clamp(-1, 1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2));
      const py = gsap.utils.clamp(-1, 1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2));
      const f = digitando() ? 0.3 : 1;
      ry(px * 9 * f);
      rx(-py * 7 * f);
      bx(e.clientX - r.left); by(e.clientY - r.top);
      brilho.classList.add("aceso");
    });
    acesso.addEventListener("pointerleave", ()=>{ rx(0); ry(0); brilho.classList.remove("aceso"); });
  }

  /* ------------------------------------------------------------------ cortina em curva
     "Curve swipe": a cortina sobe em curva e cobre a tela (MorphSVG: reta → curva → cheia),
     a marca aparece por cima e o painel abre. */
  const cortina = document.createElement("div");
  cortina.className = "cortina";
  cortina.setAttribute("aria-hidden", "true");
  cortina.innerHTML = `
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs><linearGradient id="cortina-cor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2f78c4"/><stop offset="0.6" stop-color="#0f5ea6"/><stop offset="1" stop-color="#0c3868"/></linearGradient></defs>
      <path class="path" d="M 0 100 V 100 Q 50 100 100 100 V 100 z" fill="url(#cortina-cor)"/>
    </svg>
    <div class="cortina-marca"><span>Guala<i>pack</i></span><small>Abrindo o painel…</small></div>`;
  document.body.appendChild(cortina);
  const caminho = cortina.querySelector(".path"), marca = cortina.querySelector(".cortina-marca");
  const CURVA = "M 0 100 V 50 Q 50 0 100 50 V 100 z";
  const CHEIA = "M 0 100 V 0 Q 50 0 100 0 V 100 z";
  window.cortinaDeEntrada = depois =>{
    marcarVista();
    gsap.timeline({ onComplete: depois })
      .set(cortina, { autoAlpha: 1 })
      .to(caminho, { morphSVG: CURVA, ease: "power2.in", duration: 0.45 })
      .to(caminho, { morphSVG: CHEIA, ease: "power2.out", duration: 0.45 })
      .fromTo(marca, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power3.out" }, "-=0.25")
      .to({}, { duration: 0.35 });
  };
})();
