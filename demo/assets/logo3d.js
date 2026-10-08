/* Logo 3D da tela de entrada: o "G" da marca (Playfair Display itálico, peso
   700, o mesmo do ícone e da barra do painel) em vidro, no fundo.

   - É camada de conteúdo: o cartão de vidro do login (a camada funcional) passa
     por cima e o desfoca, como o HIG pede pra marca (branding.md: a cor da
     marca vai pra camada de conteúdo, por baixo do vidro).
   - O vidro refrata o próprio fundo da página (as manchas azuis), por isso o
     fundo é desenhado aqui também.
   - Movimento lento (giro, flutuação e um leve acompanhar do mouse). Para com a
     aba oculta e fica parado com "reduzir movimento"; máquina lenta também fica
     com a imagem parada.
   - Sem WebGL ou sem o three.js, a página fica com as manchas de CSS de antes.
   Uso: import("./assets/logo3d.js").then(m => m.iniciar(canvas)). */
import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Contorno do G (unidades da fonte: 1000 por em, y para cima), extraído da
// Playfair Display Italic no peso 700.
const G = "M340 6Q362.2 6 382.6 12Q403 18 416.8 26.8Q434.6 38.6 442.6 55.3Q450.6 72 458 100L481 188Q492 229 489.5 249Q487 269 467.5 276Q448 283 406 284L411 304Q432 303 461.4 302.5Q490.8 302 522.5 301.5Q554.2 301 581 301Q624.8 301 661.7 302Q698.6 303 722 304L717 284Q695 283 682.5 277Q670 271 661.5 253Q653 235 643 198L590 0H570Q572.2 26 565.6 41.5Q559 57 541.8 57Q522.6 57 501.5 46.5Q480.4 36 457.6 25Q419.8 4.8 385.1 -4.6Q350.4 -14 312.8 -14Q182.6 -14 110.3 46Q38 106 38 215Q38 283 60.3 354Q82.6 425 124.5 491Q166.4 557 225.5 609Q284.6 661 358.4 691.5Q432.2 722 518 722Q583 722 618.5 703Q654 684 682 657Q697 642 710 652Q723 662 739 708H761Q746 669 730 613.5Q714 558 697 478H675Q677 498 678.5 516.5Q680 535 680 553Q680 574 677.3 591.4Q674.6 608.8 666 626Q646.2 663.6 606.5 683.8Q566.8 704 512 704Q450.4 704 400.5 668.5Q350.6 633 312.3 574.5Q274 516 248.6 446.5Q223.2 377 210.1 307.5Q197 238 197 182Q197 92 232.6 49Q268.2 6 340 6Z";

const FOV = 30, CAM_Z = 2200, FUNDO_Z = -900;
// "#7fbde8" -> "rgba(127,189,232,0)"
function transparente(cor){
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(cor).trim());
  if(!m) return "rgba(255,255,255,0)";
  const h = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1];
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},0)`;
}
const LARGURA_CARTAO = 400;   // o .card do login (max-width)

export function iniciar(canvas){
  if(!canvas) return false;
  let renderer;
  try{
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  }catch(e){
    console.warn("Logo 3D sem WebGL; fica o fundo simples.", e);
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const raiz = document.documentElement;
  const reduzMovimento = window.matchMedia("(prefers-reduced-motion: reduce)");
  const toque = window.matchMedia("(pointer: coarse)");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 8000);
  camera.position.set(0, 0, CAM_Z);

  // reflexos de estúdio, pro vidro ter brilho
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  /* ---------- fundo: as manchas da página, que o vidro refrata ---------- */
  const tela = document.createElement("canvas");
  const ctx = tela.getContext("2d");
  const texFundo = new THREE.CanvasTexture(tela);
  texFundo.colorSpace = THREE.SRGBColorSpace;
  const fundo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: texFundo, toneMapped: false }));
  fundo.position.z = FUNDO_Z;
  scene.add(fundo);

  /* ---------- o G em vidro ---------- */
  const forma = SVGLoader.createShapes(new SVGLoader().parse(`<svg><path d="${G}"/></svg>`).paths[0]);
  const geo = new THREE.ExtrudeGeometry(forma, {
    depth: 150, curveSegments: 28,
    bevelEnabled: true, bevelThickness: 30, bevelSize: 11, bevelSegments: 10,
  });
  geo.center();
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const ALTURA_G = geo.boundingBox.max.y - geo.boundingBox.min.y;
  const vidro = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.05,
    transmission: 1, thickness: 220, ior: 1.48, dispersion: 4,
    iridescence: 0.55, iridescenceIOR: 1.25, iridescenceThicknessRange: [120, 520],
    clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1,
  });
  const logo = new THREE.Mesh(geo, vidro);
  const grupo = new THREE.Group();
  grupo.add(logo);
  scene.add(grupo);

  // luz de recorte (a borda acesa das referências) e uma luz principal suave
  const luzPrincipal = new THREE.DirectionalLight(0xffffff, 1.4);
  luzPrincipal.position.set(-500, 700, 1200);
  const recorteA = new THREE.DirectionalLight(0x4f9ce0, 3);
  recorteA.position.set(-1200, 300, -700);
  const recorteB = new THREE.DirectionalLight(0x9fd4ff, 2);
  recorteB.position.set(1100, -400, -600);
  scene.add(luzPrincipal, recorteA, recorteB);

  /* ---------- cores do tema (tokens do CSS da página) ---------- */
  let cores = {};
  const token = n => getComputedStyle(raiz).getPropertyValue(n).trim();
  function lerTema(){
    const escuro = token("color-scheme") === "dark" ||
      (raiz.getAttribute("data-theme") === "dark") ||
      (!raiz.getAttribute("data-theme") && window.matchMedia("(prefers-color-scheme: dark)").matches);
    cores = { escuro, bg: token("--bg") || "#eef2f6", b1: token("--blob-1") || "#2f78c4",
              b2: token("--blob-2") || "#0c3868", b3: token("--blob-3") || "#7fbde8" };
    // claro: vidro levemente azulado e brilho de estúdio; escuro: vidro mais
    // limpo e a borda acesa em azul, como as referências
    vidro.attenuationColor = new THREE.Color(escuro ? "#4f9ce0" : "#5ea8e8");
    vidro.attenuationDistance = escuro ? 900 : 520;
    vidro.envMapIntensity = escuro ? 0.55 : 1.25;
    renderer.toneMappingExposure = escuro ? 1.15 : 1.0;
    luzPrincipal.intensity = escuro ? 0.6 : 1.4;
    recorteA.intensity = escuro ? 7 : 2.4;
    recorteB.intensity = escuro ? 3.5 : 1.6;
  }

  // As manchas acompanham as do CSS (.blob-a no alto à esquerda, .blob-b embaixo
  // à direita) e uma luz atrás do G, pra o vidro ter o que refratar.
  function desenharFundo(t){
    const w = tela.width, h = tela.height;
    ctx.globalAlpha = 1;
    ctx.fillStyle = cores.bg;
    ctx.fillRect(0, 0, w, h);
    const mancha = (x, y, r, c1, c2, alfa) => {
      const g = ctx.createRadialGradient(x - r*0.15, y - r*0.15, 0, x, y, r);
      // termina na própria cor transparente: terminar em preto transparente
      // escurece o meio da transição (a auréola cinza)
      g.addColorStop(0, c1); g.addColorStop(0.62, c2); g.addColorStop(1, transparente(c2));
      ctx.globalAlpha = alfa; ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    };
    const s = Math.max(w, h), d1 = Math.sin(t*0.24), d2 = Math.sin(t*0.2 + 1.3);
    mancha(w*0.06 + d1*w*0.04, h*0.06 + d1*h*0.05, s*0.42, cores.b3, cores.b1, cores.escuro ? 0.45 : 0.4);
    mancha(w*0.96 - d2*w*0.035, h*0.98 - d2*h*0.04, s*0.36, cores.b1, cores.b2, cores.escuro ? 0.5 : 0.38);
    // luz por trás do G (no escuro, o brilho azul das referências)
    const gx = w/2 + pose.xPx * (w/innerWidth), gy = h/2 - pose.yPx * (h/innerHeight);
    mancha(gx, gy, pose.alturaPx * (w/innerWidth) * 0.75, cores.escuro ? cores.b1 : "#ffffff", cores.escuro ? cores.b2 : cores.b3, cores.escuro ? 0.55 : 0.5);
    ctx.globalAlpha = 1;
    texFundo.needsUpdate = true;
  }

  /* ---------- posição: ao lado do cartão (tela larga) ou acima (estreita) ---------- */
  const pose = { xPx: 0, yPx: 0, alturaPx: 300, yaw: 0.35, amp: 14 };
  function arrumar(){
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const largo = w >= 900;
    pose.alturaPx = largo ? Math.min(h * 0.66, 640) : Math.min(h * 0.27, w * 0.55);
    // tela larga: à esquerda do cartão, com uns 40% por trás dele (o vidro do
    // cartão desfoca essa parte); estreita: no alto, acima do cartão
    pose.xPx = largo ? -(LARGURA_CARTAO/2 + pose.alturaPx * 0.12) : 0;
    // estreita: o G inteiro na tela, com o topo a 36 px da borda, e a base por trás do cartão
    pose.yPx = largo ? h * 0.03 : h/2 - 36 - pose.alturaPx * 0.5;
    pose.yaw = largo ? 0.38 : 0.2;
    const mundoPorPx = 2 * Math.tan(THREE.MathUtils.degToRad(FOV/2)) * CAM_Z / h;
    grupo.position.set(pose.xPx * mundoPorPx, pose.yPx * mundoPorPx, 0);
    logo.scale.setScalar(pose.alturaPx * mundoPorPx / ALTURA_G);
    pose.amp = 10 * mundoPorPx;
    // o fundo cobre a vista na profundidade dele, com folga
    const hFundo = 2 * Math.tan(THREE.MathUtils.degToRad(FOV/2)) * (CAM_Z - FUNDO_Z) * 1.04;
    fundo.scale.set(hFundo * camera.aspect, hFundo, 1);
    tela.width = 320; tela.height = Math.max(120, Math.round(320 / camera.aspect));
  }

  /* ---------- movimento ---------- */
  const mouse = { x: 0, y: 0, ax: 0, ay: 0 };
  window.addEventListener("pointermove", e => {
    if(e.pointerType !== "mouse") return;
    mouse.x = e.clientX / innerWidth * 2 - 1;
    mouse.y = e.clientY / innerHeight * 2 - 1;
  }, { passive: true });

  const inicio = performance.now();
  const entrada = 1.8;   // s: o G cresce um pouco enquanto aparece
  let rodando = false, quadro = 0, tempos = [], ultimo = 0, lento = false;
  const parado = () => reduzMovimento.matches || lento;

  function posar(t, animado){
    const k = animado ? Math.min(1, t / entrada) : 1;
    const sobe = 1 - Math.pow(1 - k, 3);
    if(animado && !toque.matches){   // acompanha o mouse devagar
      mouse.ax += (mouse.x - mouse.ax) * 0.035;
      mouse.ay += (mouse.y - mouse.ay) * 0.035;
    }
    const osc = animado ? 1 : 0;
    grupo.rotation.y = pose.yaw + osc * 0.3 * Math.sin(t * 0.21) + mouse.ax * 0.14;
    grupo.rotation.x = -0.06 + osc * 0.05 * Math.sin(t * 0.17) + mouse.ay * 0.08;
    grupo.rotation.z = osc * 0.03 * Math.sin(t * 0.13);
    logo.position.y = osc * pose.amp * Math.sin(t * 0.45);
    grupo.scale.setScalar(0.92 + 0.08 * sobe);
  }
  function desenhar(t, animado){
    posar(t, animado);
    desenharFundo(animado ? t : 0);
    renderer.render(scene, camera);
  }
  function passo(agora){
    if(!rodando) return;
    const t = (agora - inicio) / 1000;
    desenhar(t, true);
    // máquina lenta: depois de aquecer, se a média passar de 45 ms, fica parado
    if(ultimo){ tempos.push(agora - ultimo); }
    ultimo = agora;
    if(tempos.length === 90){
      const media = tempos.slice(30).reduce((a, b) => a + b, 0) / 60;
      if(media > 45){ lento = true; parar(); desenhar(0, false); return; }
    }
    quadro = requestAnimationFrame(passo);
  }
  function começar(){
    if(rodando || parado() || document.hidden) return;
    rodando = true; ultimo = 0;
    quadro = requestAnimationFrame(passo);
  }
  function parar(){ rodando = false; cancelAnimationFrame(quadro); }
  function redesenharParado(){ if(!rodando) desenhar(0, false); }

  lerTema();
  arrumar();
  desenhar(0, !parado());
  document.body.classList.add("com-3d");
  começar();
  if(parado()) redesenharParado();

  window.addEventListener("resize", () => { arrumar(); redesenharParado(); });
  document.addEventListener("visibilitychange", () => document.hidden ? parar() : começar());
  reduzMovimento.addEventListener("change", () => { if(parado()){ parar(); redesenharParado(); } else começar(); });
  // tema: o botão do login muda data-theme; o sistema muda prefers-color-scheme
  new MutationObserver(() => { lerTema(); redesenharParado(); }).observe(raiz, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { lerTema(); redesenharParado(); });
  // perdeu o contexto do WebGL (driver, economia de energia): volta o fundo de CSS
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); parar(); document.body.classList.remove("com-3d"); });
  return true;
}
