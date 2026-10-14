// Maquete 3D do WIP (aba WIP do painel). Carregada só quando a aba abre.
//
// Cada área da planta vira UMA coluna: a altura é o número de pallets e as faixas de
// cor são a idade da OP (as mesmas cores do gráfico "Idade do WIP"; o mais velho
// embaixo). Tocar numa área abre a coluna numa bandeja que flutua acima das máquinas,
// com um quadrado por pallet, em fileiras por idade e com espaço entre eles: nada de
// pilha aglomerada. Tocar num quadrado mostra o pallet.
//
// Dados (Supabase, só leitura, 008_wip_maquete.sql): v_hub_wip_pallet (os pallets,
// mesma regra do WIP somado), v_hub_planta (a planta baixa, atrás do login) e
// v_hub_planta_area (posições corrigidas por um administrador em "Ajustar planta").
import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/* =====================================================================
   Planta: as mesmas constantes de hub/scripts/gerar_planta.py, em pixels da planta
   original (a sala de bobinas de 924 m² dá a escala). A imagem vem do Supabase.
   ===================================================================== */
const PLANTA_PADRAO = {
  recorte_px: [316, 296, 970, 657],
  metros_por_px: Math.sqrt(924 / (100 * 204)),
  contorno_px: [[320, 407], [676, 407], [676, 313], [782, 313], [782, 300], [858, 300], [858, 322],
    [965, 322], [965, 530], [838, 530], [838, 652], [320, 652]],
};
const OURO_FINO_PX = [1010, 330, 1110, 470];
// Posição de cada área: PALPITE (os nomes das máquinas não se leem na planta; só a
// sala de cura é certa). O administrador corrige em "Ajustar planta".
//   maquina e estoque: [x0, y0, x1, y1] em pixels; h: altura da máquina (m)
const A = (id, nome, setor, maquina, h, estoque, locais, extra = {}) =>
  ({ id, nome, setor, maquinaPx: maquina, h, estoquePx: estoque, locais, estimada: !extra.certa, ...extra });
const AREAS_PX = [
  A("ROTO01", "RT01", "Impressão", [401, 490, 549, 521], 3.8, [404, 523, 486, 537], ["MATRIZ - ROTO 01"]),
  A("R18", "R18", "Impressão", [476, 419, 560, 441], 3.4, [476, 444, 518, 472], ["MATRIZ - R18"]),
  A("R20", "R20", "Impressão", [418, 537, 490, 564], 3.4, [418, 567, 490, 592], ["MATRIZ - R20"]),
  A("R12", "R12", "Impressão", [378, 602, 476, 637], 1.2, [480, 604, 522, 638], ["MATRIZ - R12"], { inativa: true }),
  A("L04", "L04", "Laminação", [555, 543, 626, 571], 3.2, [536, 574, 646, 598], ["MATRIZ - L04"]),
  A("L03", "L03", "Laminação", [532, 616, 634, 634], 3.0, [536, 601, 646, 613], ["MATRIZ - L03"]),
  A("L02", "L02", "Laminação", [607, 419, 645, 462], 3.0, [604, 464, 664, 479], ["MATRIZ - L02"]),
  A("HMC01", "HMC01", "Laminação", [572, 420, 600, 462], 2.8, [522, 445, 566, 477], ["MATRIZ - HMC01"]),
  A("COATING01", "COATING 01", "Coating e cura", [700, 330, 828, 372], 3.6, [765, 410, 798, 492], ["MATRIZ - COATING 01"]),
  A("CURA", "Sala de cura", "Coating e cura", [668, 408, 760, 490], 3.2, [676, 414, 752, 470], ["MATRIZ - SALA DE CURA"], { sala: true, certa: true }),
  A("REB01", "REB 01", "Corte / Refile", [567, 480, 597, 522], 2.4, [490, 524, 600, 540], ["MATRIZ - REB01"]),
  A("REB04", "REB 04", "Corte / Refile", [605, 480, 644, 522], 2.4, [604, 524, 646, 540], ["MATRIZ - REB04"]),
  A("REB05", "REB 05", "Corte / Refile", [678, 508, 700, 521], 2.4, [676, 528, 718, 582], ["MATRIZ - REB05"]),
  A("REB09", "REB 09", "Corte / Refile", [728, 508, 750, 521], 2.4, [726, 528, 768, 582], ["MATRIZ - REB09"]),
  A("REB10", "REB 10", "Corte / Refile", [778, 508, 800, 521], 2.4, [776, 528, 820, 582], ["MATRIZ - REB10"]),
  A("REB10L", "REB 10L", "Corte / Refile", [806, 508, 824, 520], 2.0, [806, 586, 828, 596], ["MATRIZ - REB10L"]),
  A("REV01", "REVISORA 01", "Corte / Refile", [680, 600, 702, 613], 1.8, [706, 600, 728, 613], ["MATRIZ - REV01"]),
  A("EXPEDICAO", "Expedição", "Expedição", null, 0, [872, 482, 954, 520], ["MATRIZ - EXPEDICAO"]),
  A("OF_REB04", "REB 04 · Ouro Fino", "Ouro Fino", [1022, 350, 1046, 366], 2.4, [1054, 346, 1096, 370], ["OURO FINO REB04"]),
  A("OF_COATING", "Coating · Ouro Fino", "Ouro Fino", [1020, 400, 1062, 420], 3.2, [1068, 398, 1096, 424], ["OURO FINO COATING"]),
];

// Idade da OP: as faixas e cores do gráfico "Idade do WIP" (0–30 dias, 31–90, mais de 90).
// Índice 0 = mais novo. Na coluna, o mais velho fica embaixo.
const FAIXAS = [
  { nome: "Até 30 dias", cor: "--series-3" },
  { nome: "31 a 90 dias", cor: "--warning" },
  { nome: "Mais de 90 dias", cor: "--critical" },
];
const faixaDe = (d) => (d > 90 ? 2 : d > 30 ? 1 : 0);
const NOME_SITUACAO = { Disponivel: "Disponível", "Em uso": "Em uso", "Em maquina": "Em máquina" };
const nomeSituacao = (s) => NOME_SITUACAO[s] || s || "Sem situação";

const PISO = 1.0;          // topo da laje
const RAIO = 2.3;          // raio da coluna
const M_POR_PALLET = 0.03;  // 462 pallets ≈ 14 m: a coluna é uma barra de gráfico sobre a planta
const BANDEJA_Y = 5.4;     // a bandeja flutua acima das máquinas (a mais alta tem 3,8 m)
const PASSO = 1.3;         // distância entre os quadrados da bandeja
const VAO = 0.07;          // fresta entre as faixas da coluna

/* ---------------- utilidades */
const $ = (id) => document.getElementById(id);
const reduz = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nrm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fmtInt = (n) => Math.round(n).toLocaleString("pt-BR");
const fmtT = (kg) => (kg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: kg >= 100000 ? 0 : 1 });
const fmtKg = (kg) => kg.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " kg";
const idadeTexto = (d) => (d < 60 ? `${d} dia${d === 1 ? "" : "s"}` : d < 730 ? `${Math.round(d / 30.4)} meses` : `${(d / 365).toFixed(1).replace(".", ",")} anos`);
const chaveLocal = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
// toneladas como o cartão "WIP em processo": a soma do peso publicado (o pallet com peso
// negativo aparece em "Para conferir" e com aviso no detalhe)
const kgOk = (p) => Number(p.kg) || 0;
const hash = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
const dataLocal = (s) => { if (!s) return null; const d = new Date(String(s).slice(0, 19)); return isNaN(d) ? null : d; };
// a curva das animações do painel: cubic-bezier(.32,.72,0,1)
function bezier(x1, y1, x2, y2) {
  const bx = (u) => 3 * (1 - u) ** 2 * u * x1 + 3 * (1 - u) * u * u * x2 + u ** 3;
  const by = (u) => 3 * (1 - u) ** 2 * u * y1 + 3 * (1 - u) * u * u * y2 + u ** 3;
  return (t) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let a = 0, b = 1, u = t;
    for (let i = 0; i < 24; i++) { const x = bx(u); if (Math.abs(x - t) < 1e-5) break; if (x < t) a = u; else b = u; u = (a + b) / 2; }
    return by(u);
  };
}
const mola = bezier(0.32, 0.72, 0, 1);
const suave = bezier(0.65, 0, 0.35, 1);

/* =====================================================================
   Início: lê os dados, monta a cena e devolve o que o painel usa.
   ===================================================================== */
export async function iniciar({ client, lerTudo, papel }) {
  const palco = $("maquete-palco"), estadoEl = $("maquete-estado");
  const E = {
    pallets: [], dias: null, faixa: null, areaDe: null, porArea: new Map(), fora: [],
    sit: new Set(), fx: new Set([0, 1, 2]), destaque: null, foco: null, selecionado: -1,
    modo: "maquete", editando: false, painel: { tipo: "resumo" }, todosDaArea: false,
  };

  // ------------------------------------------------ dados
  const [pal, plantaRes, ajustesRes] = await Promise.all([
    lerTudo(client, "v_hub_wip_pallet", ["etiqueta"]),
    client.from("v_hub_planta").select("*").limit(1),
    client.from("v_hub_planta_area").select("*"),
  ]);
  if (pal.error) {
    mostrarEstado("Sem dados da maquete ainda: os pallets aparecem aqui quando o hub publicar (precisa do SQL 008 no Supabase).");
    return { mostrar() {}, buscar: () => null, irPara() {} };
  }
  const planta = !plantaRes.error && plantaRes.data && plantaRes.data[0] ? plantaRes.data[0] : null;
  const ajustes = !ajustesRes.error ? ajustesRes.data || [] : [];
  E.pallets = (pal.data || []).map((p) => ({ ...p, inicioD: dataLocal(p.inicio) }));
  if (!E.pallets.length) {
    mostrarEstado("Sem pallets em processo agora.");
    return { mostrar() {}, buscar: () => [], irPara() {} };
  }

  // geometria da planta (pixels → metros, centro no meio do recorte)
  const geo = planta ? { recorte_px: planta.recorte_px, metros_por_px: Number(planta.metros_por_px), contorno_px: planta.contorno_px } : PLANTA_PADRAO;
  const [rx0, ry0, rx1, ry1] = geo.recorte_px;
  const CX = (rx0 + rx1) / 2, CZ = (ry0 + ry1) / 2, ESC = geo.metros_por_px;
  const pxm = (x, y) => [(x - CX) * ESC, (y - CZ) * ESC];
  const ret = ([x0, y0, x1, y1]) => { const [a, b] = pxm(x0, y0), [c, d] = pxm(x1, y1); return { x: (a + c) / 2, z: (b + d) / 2, w: c - a, d: d - b }; };
  const CONTORNO = geo.contorno_px.map(([x, y]) => pxm(x, y));
  const OURO = ret(OURO_FINO_PX);
  const PISO_PLANTA = ret(geo.recorte_px);
  const AREAS = AREAS_PX.map((a) => ({ ...a, maquina: a.maquinaPx ? { ...ret(a.maquinaPx), h: a.h } : null, estoque: ret(a.estoquePx) }));
  for (const aj of ajustes) {
    const a = AREAS.find((x) => x.id === aj.id);
    if (!a) continue;
    if (aj.maquina && a.maquina) Object.assign(a.maquina, aj.maquina);
    if (aj.estoque) Object.assign(a.estoque, aj.estoque);
    a.estimada = false; a.ajustada = true;
  }
  const BX = [Math.min(...CONTORNO.map((p) => p[0])), Math.max(OURO.x + OURO.w / 2, ...CONTORNO.map((p) => p[0]))];
  const BZ = [Math.min(...CONTORNO.map((p) => p[1]), OURO.z - OURO.d / 2), Math.max(...CONTORNO.map((p) => p[1]), OURO.z + OURO.d / 2)];
  const CENTRO = new THREE.Vector3((BX[0] + BX[1]) / 2, PISO, (BZ[0] + BZ[1]) / 2);

  // idade pela data da OP, como o WIP somado: dias até o dado mais novo da foto
  const n = E.pallets.length;
  const ref = Math.max(...E.pallets.map((p) => (p.inicioD ? p.inicioD.getTime() : 0)));
  E.dias = new Int32Array(n); E.faixa = new Uint8Array(n); E.areaDe = new Array(n);
  const localArea = new Map();
  for (const a of AREAS) { E.porArea.set(a.id, []); for (const l of a.locais) localArea.set(chaveLocal(l), a.id); }
  const contaSit = new Map();
  E.pallets.forEach((p, i) => {
    const d = p.inicioD ? Math.max(0, Math.round((ref - p.inicioD.getTime()) / 864e5)) : 0;
    E.dias[i] = d; E.faixa[i] = faixaDe(d);
    const a = localArea.get(chaveLocal(p.local)) || null;
    E.areaDe[i] = a;
    if (a) E.porArea.get(a).push(i); else E.fora.push(i);
    contaSit.set(p.situacao, (contaSit.get(p.situacao) || 0) + 1);
  });
  E.situacoes = [...contaSit.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  E.situacoes.forEach((s) => E.sit.add(s));

  // ------------------------------------------------ cena
  let webgl = true, renderer, cena, camera, controles, rotulos, luzSol, luzCeu;
  const mats = {}, areaObj = new Map();
  let plantaMesh = null;
  // monta a cena e a interface: chamada no fim do iniciar, depois de todas as declarações
  function montarTudo() {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch { webgl = false; }

    const cor = cores();
    if (webgl) {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      $("maquete-cena").appendChild(renderer.domElement);
      rotulos = new CSS2DRenderer();
      $("maquete-rotulos").appendChild(rotulos.domElement);
      cena = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(30, 1, 1, 4000);

      luzCeu = new THREE.HemisphereLight(0xffffff, 0x9aa9bb, 1.7);
      luzSol = new THREE.DirectionalLight(0xffffff, 2.0);
      luzSol.position.set(CENTRO.x - 50, 120, 70);
      luzSol.target.position.copy(CENTRO);
      luzSol.castShadow = true;
      luzSol.shadow.mapSize.set(4096, 4096);
      Object.assign(luzSol.shadow.camera, { left: -115, right: 115, top: 80, bottom: -80, near: 10, far: 320 });
      luzSol.shadow.bias = -0.0004; luzSol.shadow.normalBias = 0.04; luzSol.shadow.radius = 3;
      cena.add(luzCeu, luzSol, luzSol.target);
      const chao = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.ShadowMaterial({ opacity: 0.09 }));
      chao.rotation.x = -Math.PI / 2; chao.receiveShadow = true;
      cena.add(chao);

      mats.laje = new THREE.MeshStandardMaterial({ color: cor.laje, roughness: 0.95 });
      mats.parede = new THREE.MeshStandardMaterial({ color: cor.parede, roughness: 0.85 });
      mats.maquina = new THREE.MeshStandardMaterial({ color: cor.maquina, roughness: 0.7 });
      mats.inativa = new THREE.MeshStandardMaterial({ color: cor.maquina, roughness: 0.7, transparent: true, opacity: 0.45 });
      mats.topo = new THREE.MeshStandardMaterial({ color: cor.topo, roughness: 0.6 });
      mats.sala = new THREE.MeshStandardMaterial({ color: cor.maquina, roughness: 0.3, transparent: true, opacity: 0.5 });
      mats.bandeja = new THREE.MeshStandardMaterial({ color: cor.bandeja, roughness: 0.4, transparent: true, opacity: 0, depthWrite: false });
      mats.haste = new THREE.MeshBasicMaterial({ color: cor.acento, transparent: true, opacity: 0 });

      // laje no formato do chão de fábrica e paredes baixas (corte de maquete)
      const forma = new THREE.Shape(CONTORNO.map(([x, z]) => new THREE.Vector2(x, -z)));
      const laje = new THREE.Mesh(new THREE.ExtrudeGeometry(forma, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.35, bevelSegments: 2 }), mats.laje);
      laje.geometry.rotateX(-Math.PI / 2); laje.geometry.translate(0, 0.2, 0);
      laje.receiveShadow = true; laje.castShadow = true;
      cena.add(laje);
      const paredeGeo = new THREE.BoxGeometry(1, 2.2, 0.45); paredeGeo.translate(0, 1.1, 0);
      CONTORNO.forEach(([x1, z1], k) => {
        const [x2, z2] = CONTORNO[(k + 1) % CONTORNO.length];
        const p = new THREE.Mesh(paredeGeo, mats.parede);
        p.scale.x = Math.hypot(x2 - x1, z2 - z1) + 0.45;
        p.position.set((x1 + x2) / 2, PISO, (z1 + z2) / 2);
        p.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
        p.castShadow = true; p.receiveShadow = true;
        cena.add(p);
      });
      // a planta baixa: só as linhas do desenho, na cor do tema
      if (planta && planta.imagem) {
        const tex = new THREE.TextureLoader().load("data:image/png;base64," + planta.imagem, () => pedirQuadro());
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        mats.planta = new THREE.MeshBasicMaterial({ map: tex, color: cor.linha, transparent: true, opacity: cor.linhaOpac, depthWrite: false });
        plantaMesh = new THREE.Mesh(new THREE.PlaneGeometry(PISO_PLANTA.w, PISO_PLANTA.d), mats.planta);
        plantaMesh.rotation.x = -Math.PI / 2; plantaMesh.position.set(PISO_PLANTA.x, PISO + 0.02, PISO_PLANTA.z);
        plantaMesh.renderOrder = 1;
        cena.add(plantaMesh);
      }
      // Ouro Fino: outra unidade, ao lado e esquemática
      const lajeOF = new THREE.Mesh(placa(OURO.w, OURO.d, 3, 0.6, 0.2), mats.laje);
      lajeOF.position.set(OURO.x, 0, OURO.z); lajeOF.receiveShadow = true; lajeOF.castShadow = true;
      const paredeOF = new THREE.Mesh(anel(OURO.w, OURO.d, 3, 0.45, 2.2), mats.parede);
      paredeOF.position.set(OURO.x, PISO, OURO.z); paredeOF.castShadow = true;
      cena.add(lajeOF, paredeOF);
      const elOF = document.createElement("span"); elOF.className = "mq-rotulo unidade"; elOF.textContent = "Ouro Fino · outra unidade";
      const rotOF = new CSS2DObject(elOF); rotOF.position.set(OURO.x, 0, OURO.z + OURO.d / 2 + 4); cena.add(rotOF);

      for (const a of AREAS) montarArea(a);

      // bandeja (a coluna aberta), haste e o farol do pallet escolhido
      E.bandeja = new THREE.Mesh(new RoundedBoxGeometry(1, 0.16, 1, 2, 0.06), mats.bandeja);
      E.bandeja.visible = false; E.bandeja.receiveShadow = true;
      E.haste = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 12), mats.haste);
      E.haste.geometry.translate(0, 0.5, 0); E.haste.visible = false;
      cena.add(E.bandeja, E.haste);
      const maxArea = Math.max(1, ...[...E.porArea.values()].map((l) => l.length), E.fora.length);
      E.ladrilhos = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 0.3, 1, 2, 0.07), new THREE.MeshStandardMaterial({ roughness: 0.55 }), maxArea);
      E.ladrilhos.count = 0; E.ladrilhos.frustumCulled = false; E.ladrilhos.castShadow = true;
      E.ladrilhos.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      E.ladrilhos.setColorAt(0, new THREE.Color(cor.faixa[0]));
      cena.add(E.ladrilhos);
      E.farol = new THREE.Group();
      const anelF = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.9, 40), new THREE.MeshBasicMaterial({ color: cor.acento, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      anelF.rotation.x = -Math.PI / 2;
      const feixe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 12, 1, true), new THREE.MeshBasicMaterial({ color: cor.acento, transparent: true, opacity: 0.5, depthWrite: false }));
      feixe.position.y = 2.2;
      const ponta = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), new THREE.MeshBasicMaterial({ color: cor.acento }));
      ponta.position.y = 4.3;
      E.farol.add(anelF, feixe, ponta); E.farol.userData = { anelF }; E.farol.visible = false;
      cena.add(E.farol);

      controles = new MapControls(camera, renderer.domElement);
      Object.assign(controles, { enableDamping: true, dampingFactor: 0.09, screenSpacePanning: false, minDistance: 12,
        maxDistance: 900, maxPolarAngle: 1.22, zoomToCursor: true });
      controles.addEventListener("change", pedirQuadro);
      // no toque, um dedo rola a página (a maquete não prende a rolagem) e dois dedos
      // movem e aproximam, como nos mapas embutidos; tocar numa área segue com um dedo
      if (matchMedia("(pointer: coarse)").matches) {
        controles.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
        renderer.domElement.style.touchAction = "pan-y";
        palco.insertAdjacentHTML("beforeend", `<div class="maquete-gesto" aria-hidden="true">Dois dedos para mover a maquete</div>`);
      }
      ligarPonteiro();
      new ResizeObserver(redimensionar).observe(palco);
      redimensionar();
    }

    // ------------------------------------------------ interface (filtros, modo, ajuste)
    montarFiltros();
    const modoEl = $("maquete-modo");
    if (window.segmentado && webgl) window.segmentado(modoEl, [["maquete", "Maquete"], ["planta", "Planta"]], "maquete", (m) => trocarModo(m));
    else modoEl.hidden = true;
    $("maquete-recentrar").hidden = !webgl;
    $("maquete-recentrar").addEventListener("click", () => visaoGeral());
    $("maquete-inspetor").addEventListener("click", cliqueNoInspetor);
    ligarAjuste();
    let temaVisto = ehEscuro();
    const talvezTema = () => { if (ehEscuro() !== temaVisto) { temaVisto = ehEscuro(); aplicarTema(); } };
    new MutationObserver(talvezTema).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", talvezTema);
    addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape" || !palco.closest(".view.active") || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if (E.editando) alternarAjuste(false);
      else if (E.painel.tipo === "pallet") voltar();
      else if (E.foco) fecharArea();
    });

    aplicarFiltros(0);
    renderInspetor();
    $("maquete-sub").textContent = `${fmtInt(n)} pallets em processo · cor pela idade da OP`
      + (planta ? "" : " · planta baixa ainda não publicada") + " · toque numa área para ver os pallets";
    if (webgl) {
      estadoEl.hidden = true;
      introducao();
    } else {
      mostrarEstado("Este computador não abriu o 3D. A lista ao lado tem as mesmas áreas e pallets.");
    }
  }

  /* =====================================================================
     Geometria
     ===================================================================== */
  function retArredondado(w, d, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
    r = Math.min(r, w / 2, d / 2);
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function placa(w, d, r, altura, bisel = 0) {
    const g = new THREE.ExtrudeGeometry(retArredondado(w, d, r), { depth: altura, bevelEnabled: bisel > 0, bevelThickness: bisel, bevelSize: bisel, bevelSegments: 2, curveSegments: 10 });
    g.rotateX(-Math.PI / 2); g.translate(0, bisel, 0);
    return g;
  }
  function anel(w, d, r, espessura, altura) {
    const fora = retArredondado(w, d, r), dentro = retArredondado(w - espessura * 2, d - espessura * 2, Math.max(0.2, r - espessura));
    fora.holes.push(new THREE.Path(dentro.getPoints(10).reverse()));
    const g = new THREE.ExtrudeGeometry(fora, { depth: altura, bevelEnabled: false, curveSegments: 10 });
    g.rotateX(-Math.PI / 2);
    return g;
  }
  const geoColuna = (() => { const g = new THREE.CylinderGeometry(RAIO, RAIO, 1, 48); g.translate(0, 0.5, 0); return g; })();

  // máquina (ou sala), piso do estoque, coluna e rótulo de uma área; o ajuste remonta
  function montarArea(a) {
    const c = cores();
    let o = areaObj.get(a.id);
    if (o) {
      if (o.maquina) { cena.remove(o.maquina); o.maquina.geometry.dispose(); o.faixa?.geometry.dispose(); }
      cena.remove(o.piso); o.piso.geometry.dispose();
    } else {
      o = { area: a, alt: [0, 0, 0], altAlvo: [0, 0, 0], contagem: [0, 0, 0], visiveis: 0, kg: 0,
            matPiso: new THREE.MeshStandardMaterial({ color: c.piso, roughness: 1 }) };
      o.coluna = new THREE.Group();
      o.segs = FAIXAS.map((f, k) => {
        const m = new THREE.Mesh(geoColuna, new THREE.MeshStandardMaterial({ color: c.faixa[k], roughness: 0.45, transparent: true, opacity: 1 }));
        m.castShadow = true; m.receiveShadow = true; m.scale.y = 0.0001; m.visible = false; m.userData.area = a.id;
        o.coluna.add(m);
        return m;
      });
      cena.add(o.coluna);
      const el = document.createElement("div");
      el.innerHTML = `<span class="mq-rotulo${a.estimada ? " estimada" : ""}"><span class="nome">${esc(a.nome)}</span><span class="n"></span></span>`;
      o.rotuloEl = el.firstChild;
      o.rotuloEl.addEventListener("click", () => { if (!E.editando) abrirArea(a.id); });
      o.rotuloEl.addEventListener("pointerdown", (ev) => { if (E.editando) iniciarArrasto(ev, a.id); });
      o.rotulo = new CSS2DObject(el);
      cena.add(o.rotulo);
      areaObj.set(a.id, o);
    }
    o.rotuloEl.classList.toggle("estimada", !!a.estimada);
    o.maquina = o.faixa = null;
    if (a.maquina) {
      const m = a.maquina, h = m.h;
      if (a.sala) {
        o.maquina = new THREE.Mesh(anel(m.w, m.d, 0.8, 0.35, h), mats.sala);
      } else {
        const g = new RoundedBoxGeometry(m.w, h, m.d, 3, Math.min(0.55, h / 2 - 0.01, m.w / 2 - 0.01, m.d / 2 - 0.01));
        g.translate(0, h / 2, 0);
        o.maquina = new THREE.Mesh(g, a.inativa ? mats.inativa : mats.maquina);
        o.faixa = new THREE.Mesh(new RoundedBoxGeometry(Math.max(0.3, m.w - 0.8), 0.1, Math.max(0.3, m.d - 0.8), 2, 0.04), mats.topo);
        o.faixa.position.set(0, h + 0.03, 0);
        o.maquina.add(o.faixa);
      }
      o.maquina.position.set(m.x, PISO, m.z);
      o.maquina.castShadow = !a.inativa && !a.sala; o.maquina.receiveShadow = true;
      o.maquina.userData.area = a.id;
      cena.add(o.maquina);
    }
    const e = a.estoque;
    o.piso = new THREE.Mesh(placa(e.w, e.d, Math.min(0.9, e.w / 2, e.d / 2), 0.1), o.matPiso);
    o.piso.position.set(e.x, PISO, e.z); o.piso.receiveShadow = true; o.piso.userData.area = a.id;
    cena.add(o.piso);
    o.coluna.position.set(e.x, PISO + 0.1, e.z);
    posicionarColuna(o);
    return o;
  }
  // as faixas da coluna, empilhadas (o mais velho embaixo) e o rótulo no topo
  function posicionarColuna(o) {
    let y = 0;
    for (const k of [2, 1, 0]) {
      const h = o.alt[k], s = o.segs[k];
      s.visible = h > 0.001;
      s.scale.y = Math.max(0.0001, h);
      s.position.y = y;
      if (h > 0.001) y += h + VAO;
    }
    o.topo = PISO + 0.1 + Math.max(0, y - VAO);
    o.rotulo.position.set(o.coluna.position.x, o.topo + 1.5, o.coluna.position.z);
  }

  /* =====================================================================
     Filtros, contagens e colunas
     ===================================================================== */
  function visivel(i) {
    return E.sit.has(E.pallets[i].situacao) && E.fx.has(E.faixa[i]) && (!E.destaque || E.destaque.conjunto.has(i));
  }
  function montarFiltros() {
    const idadeEl = $("maquete-idade"), sitEl = $("maquete-situacao");
    idadeEl.innerHTML = `<span class="maquete-filtro-nome" aria-hidden="true">Idade da OP</span>` + FAIXAS.map((f, k) => `<button type="button" class="legend-item" data-fx="${k}" aria-pressed="true">
      <span class="legend-dot" style="background:var(${f.cor})"></span>${f.nome}<span class="n"></span></button>`).join("");
    sitEl.innerHTML = `<span class="maquete-filtro-nome" aria-hidden="true">Situação</span>` + E.situacoes.map((s) => `<button type="button" class="legend-item sem-cor" data-sit="${esc(s)}" aria-pressed="true">
      ${esc(nomeSituacao(s))}<span class="n"></span></button>`).join("");
    const alternar = (ev) => {
      const b = ev.target.closest(".legend-item");
      if (!b) return;
      const conj = b.dataset.fx != null ? E.fx : E.sit, v = b.dataset.fx != null ? Number(b.dataset.fx) : b.dataset.sit;
      conj.has(v) ? conj.delete(v) : conj.add(v);
      b.classList.toggle("off", !conj.has(v)); b.setAttribute("aria-pressed", String(conj.has(v)));
      aplicarFiltros();
    };
    idadeEl.addEventListener("click", alternar);
    sitEl.addEventListener("click", alternar);
  }
  function contarFacetas() {
    const fx = [0, 0, 0], sit = new Map();
    E.pallets.forEach((p, i) => {
      if (E.destaque && !E.destaque.conjunto.has(i)) return;
      if (E.sit.has(p.situacao)) fx[E.faixa[i]]++;
      if (E.fx.has(E.faixa[i])) sit.set(p.situacao, (sit.get(p.situacao) || 0) + 1);
    });
    document.querySelectorAll("#maquete-idade [data-fx]").forEach((b) => (b.querySelector(".n").textContent = fmtInt(fx[b.dataset.fx])));
    document.querySelectorAll("#maquete-situacao [data-sit]").forEach((b) => (b.querySelector(".n").textContent = fmtInt(sit.get(b.dataset.sit) || 0)));
  }
  function aplicarFiltros(dur = 650) {
    for (const [id, o] of areaObj) {
      const idx = E.porArea.get(id) || [];
      o.contagem = [0, 0, 0]; o.kg = 0;
      for (const i of idx) if (visivel(i)) { o.contagem[E.faixa[i]]++; o.kg += kgOk(E.pallets[i]); }
      o.visiveis = o.contagem[0] + o.contagem[1] + o.contagem[2];
      o.altAlvo = o.contagem.map((c) => (c ? Math.max(0.25, c * M_POR_PALLET) : 0));
      o.rotuloEl.querySelector(".n").textContent = fmtInt(o.visiveis);
      o.rotuloEl.classList.toggle("vazia", !o.visiveis);
    }
    contarFacetas();
    if (webgl) animarColunas(dur);
    if (E.foco) abrirArea(E.foco, { refazer: true });
    if (E.selecionado >= 0 && !visivel(E.selecionado)) desmarcar();
    renderInspetor();
  }
  function animarColunas(dur) {
    const ini = new Map([...areaObj].map(([id, o]) => [id, [...o.alt]]));
    animar(reduz() ? 0 : dur, (k) => {
      for (const [id, o] of areaObj) {
        const a0 = ini.get(id);
        if (E.foco === id) continue;          // a coluna aberta fica baixa enquanto a bandeja está aberta
        o.alt = o.altAlvo.map((h, j) => a0[j] + (h - a0[j]) * k);
        posicionarColuna(o);
      }
    });
  }

  /* =====================================================================
     Laço de desenho sob demanda (parado, não gasta GPU)
     ===================================================================== */
  const tarefas = new Set();
  let quadroPedido = false, farolAte = 0;
  function pedirQuadro() { if (!quadroPedido && webgl) { quadroPedido = true; requestAnimationFrame(quadro); } }
  function animar(dur, passo, ease = mola) {
    return new Promise((ok) => {
      if (!webgl || dur <= 0) { passo(1, 1); pedirQuadro(); ok(); return; }
      tarefas.add({ inicio: performance.now(), dur, passo, ease, ok });
      pedirQuadro();
    });
  }
  function quadro(agora) {
    quadroPedido = false;
    let continuar = false;
    for (const t of tarefas) {
      const e = Math.min(1, (agora - t.inicio) / t.dur);
      t.passo(t.ease(e), e);
      if (e >= 1) { tarefas.delete(t); t.ok(); } else continuar = true;
    }
    if (passoLadrilhos(agora)) continuar = true;
    if (controles.update()) continuar = true;
    if (E.farol.visible && agora < farolAte) {
      const f = (agora / 1400) % 1, { anelF } = E.farol.userData;
      anelF.scale.setScalar(1 + f * 1.4); anelF.material.opacity = 0.9 * (1 - f);
      continuar = true;
    }
    limitarAlvo();
    const longe = palco.clientHeight / (2 * camera.position.distanceTo(controles.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) < 3.2;
    if (longe !== E.longe) { E.longe = longe; $("maquete-rotulos").classList.toggle("longe", longe && !E.editando); }
    renderer.render(cena, camera);
    rotulos.render(cena, camera);
    arrumarRotulos();
    if (continuar) pedirQuadro();
  }
  function arrumarRotulos() {
    const ocupados = [];
    const lista = [...areaObj.values()].sort((a, b) => (b.area.id === E.foco) - (a.area.id === E.foco) || b.visiveis - a.visiveis);
    for (const o of lista) {
      const el = o.rotuloEl;
      if (E.foco || E.editando || el.classList.contains("apagada")) { el.classList.remove("encoberta"); continue; }
      const r = el.getBoundingClientRect();
      if (!r.width) { el.classList.remove("encoberta"); continue; }
      const bate = ocupados.some((q) => r.left < q.right + 4 && r.right > q.left - 4 && r.top < q.bottom + 2 && r.bottom > q.top - 2);
      el.classList.toggle("encoberta", bate);
      if (!bate) ocupados.push(r);
    }
  }
  function limitarAlvo() {
    const t = controles.target;
    const x = clamp(t.x, BX[0] - 25, BX[1] + 25), z = clamp(t.z, BZ[0] - 25, BZ[1] + 25);
    if (x !== t.x || z !== t.z) { camera.position.x += x - t.x; camera.position.z += z - t.z; t.x = x; t.z = z; }
  }
  function redimensionar() {
    if (!webgl) return;
    const w = Math.max(1, palco.clientWidth), h = Math.max(1, palco.clientHeight);
    renderer.setSize(w, h); rotulos.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    pedirQuadro();
  }

  /* =====================================================================
     Câmera
     ===================================================================== */
  const retrato = () => palco.clientHeight > palco.clientWidth * 1.15;
  const visao = (modo) => (modo === "planta" ? { polar: 0.0008, azimute: retrato() ? Math.PI / 2 : 0 }
                                               : { polar: 0.86, azimute: retrato() ? Math.PI / 2 - 0.42 : -0.36 });
  function distanciaPara(w, d, polar, azimute) {
    const W = Math.max(1, palco.clientWidth), H = Math.max(1, palco.clientHeight), t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const lx = Math.abs(w * Math.cos(azimute)) + Math.abs(d * Math.sin(azimute));
    const lz = (Math.abs(w * Math.sin(azimute)) + Math.abs(d * Math.cos(azimute))) * (0.45 + 0.55 * Math.cos(polar));
    return Math.max(lx / (2 * t * (W / H)), lz / (2 * t)) * 1.06;
  }
  function voar({ alvo, distancia, polar, azimute, dur = 900 }) {
    const esf = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controles.target));
    const a0 = controles.target.clone(), r0 = esf.radius, p0 = esf.phi;
    let t0 = esf.theta, t1 = azimute ?? t0;
    while (t1 - t0 > Math.PI) t1 -= Math.PI * 2;
    while (t1 - t0 < -Math.PI) t1 += Math.PI * 2;
    const a1 = alvo.clone(), r1 = distancia ?? r0, p1 = polar ?? p0;
    controles.enabled = false;
    controles.minPolarAngle = 0; controles.maxPolarAngle = 1.22;
    return animar(reduz() ? 0 : dur, (k) => {
      controles.target.lerpVectors(a0, a1, k);
      const r = Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * k);   // aproximar e afastar no mesmo ritmo
      camera.position.setFromSpherical(new THREE.Spherical(r, p0 + (p1 - p0) * k, t0 + (t1 - t0) * k)).add(controles.target);
      camera.lookAt(controles.target);
    }, suave).then(() => {
      controles.enabled = true;
      const planta = E.modo === "planta";
      controles.enableRotate = !planta;
      controles.maxPolarAngle = planta ? 0.0008 : 1.22;
      controles.update();
    });
  }
  function visaoGeral(dur) {
    const v = visao(E.modo);
    return voar({ alvo: CENTRO, distancia: distanciaPara(BX[1] - BX[0], BZ[1] - BZ[0], v.polar, v.azimute), polar: v.polar, azimute: v.azimute, dur });
  }
  function voarParaCaixa(caixa, min = 26) {
    const v = visao(E.modo), tam = caixa.getSize(new THREE.Vector3()), c = caixa.getCenter(new THREE.Vector3());
    const polar = E.modo === "planta" ? v.polar : 0.78, azimute = E.modo === "planta" ? v.azimute : undefined;
    const az = azimute ?? new THREE.Spherical().setFromVector3(camera.position.clone().sub(controles.target)).theta;
    return voar({ alvo: c, distancia: Math.max(min, distanciaPara(tam.x + 8, tam.z + 8, polar, az)), polar, azimute });
  }
  function trocarModo(modo) {
    if (modo === E.modo) return;
    E.modo = modo;
    if (E.foco) voarParaCaixa(E.caixaBandeja);
    else visaoGeral();
  }

  /* =====================================================================
     A bandeja: a coluna de uma área se abre, um quadrado por pallet
     ===================================================================== */
  let atual = new Float32Array(0), de = new Float32Array(0), para = new Float32Array(0), atraso = new Float32Array(0), lote = null;
  E.slots = [];                                   // pallet de cada quadrado
  const m4 = new THREE.Matrix4();
  const elevacao = { k: -1, v: 0 };               // o quadrado escolhido sobe um pouco
  let gruposRot = [];

  function abrirArea(id, { refazer = false } = {}) {
    const o = areaObj.get(id);
    if (!o) return;
    if (E.editando) return;
    if (E.foco && E.foco !== id) fecharArea({ semVoo: true, rapido: true });
    const novo = E.foco !== id;
    E.foco = id;
    if (novo) { E.painel = { tipo: "area", chave: id }; E.todosDaArea = false; }
    if (!webgl) { renderInspetor(); return; }
    // grupos por idade (o mais velho primeiro) e, dentro, da OP mais antiga para a mais nova
    const idx = (E.porArea.get(id) || []).filter(visivel);
    const grupos = [2, 1, 0].map((f) => idx.filter((i) => E.faixa[i] === f).sort((a, b) => E.dias[b] - E.dias[a])).filter((g) => g.length);
    const C = clamp(Math.ceil(Math.sqrt(Math.max(1, idx.length) * 1.8)), 6, 34);
    const linhas = grupos.reduce((s, g) => s + Math.ceil(g.length / C), 0) + Math.max(0, grupos.length - 1);
    const W = C * PASSO, D = Math.max(1, linhas) * PASSO;
    const cx = o.coluna.position.x, cz = o.coluna.position.z;
    const x0 = cx - W / 2 + PASSO / 2, z0 = cz - D / 2 + PASSO / 2;
    E.slots = []; const pos = [];
    let linha = 0;
    gruposRot.forEach((g) => cena.remove(g)); gruposRot = [];
    grupos.forEach((g, gi) => {
      const f = E.faixa[g[0]];
      const el = document.createElement("span"); el.className = "mq-grupo";
      el.innerHTML = `<span class="pt" style="background:var(${FAIXAS[f].cor})"></span>${FAIXAS[f].nome} · ${fmtInt(g.length)}`;
      const rot = new CSS2DObject(el); rot.position.set(x0 - PASSO * 0.5, BANDEJA_Y + 0.35, z0 + linha * PASSO - PASSO * 0.62);
      rot.center.set(0, 1); cena.add(rot); gruposRot.push(rot);
      g.forEach((i, k) => { E.slots.push(i); pos.push([x0 + (k % C) * PASSO, z0 + (linha + Math.floor(k / C)) * PASSO]); });
      linha += Math.ceil(g.length / C) + (gi < grupos.length - 1 ? 1 : 0);
    });
    const m = E.slots.length;
    if (atual.length < m * 4) { atual = new Float32Array(m * 4); de = new Float32Array(m * 4); para = new Float32Array(m * 4); atraso = new Float32Array(m); }
    const c = cores(), corT = new THREE.Color();
    for (let k = 0; k < m; k++) {
      const j = k * 4;
      atual[j] = cx; atual[j + 1] = o.topo; atual[j + 2] = cz; atual[j + 3] = 0.15;          // saem do topo da coluna
      para[j] = pos[k][0]; para[j + 1] = BANDEJA_Y + 0.25; para[j + 2] = pos[k][1]; para[j + 3] = 1;
      atraso[k] = Math.min(420, k * 0.9) + hash(k) * 60;
      E.ladrilhos.setColorAt(k, corT.set(c.faixa[E.faixa[E.slots[k]]]));
    }
    E.ladrilhos.count = m;
    E.ladrilhos.instanceColor.needsUpdate = true;
    elevacao.k = -1; elevacao.v = 0; E.farol.visible = false;
    de.set(atual.subarray(0, m * 4));
    lote = { inicio: performance.now(), dur: reduz() ? 0 : 640, n: m };
    // a bandeja e a haste; as outras colunas esmaecem, a desta abaixa
    E.bandeja.geometry.dispose();
    E.bandeja.geometry = new RoundedBoxGeometry(W + 1.4, 0.16, D + 1.4, 2, 0.08);
    E.bandeja.position.set(cx, BANDEJA_Y, cz); E.bandeja.visible = true;
    E.haste.position.set(cx, PISO + 0.1, cz); E.haste.scale.y = BANDEJA_Y - PISO - 0.1; E.haste.visible = true;
    E.caixaBandeja = new THREE.Box3(new THREE.Vector3(cx - W / 2 - 1, BANDEJA_Y, cz - D / 2 - 1), new THREE.Vector3(cx + W / 2 + 1, BANDEJA_Y, cz + D / 2 + 1));
    const altIni = [...o.alt];
    const opIni = new Map([...areaObj].map(([aid, x]) => [aid, x.segs[0].material.opacity]));
    animar(reduz() ? 0 : 420, (k) => {
      o.alt = altIni.map((h) => h * (1 - k)); posicionarColuna(o);
      for (const [aid, x] of areaObj) {
        const alvo = aid === id ? 1 : 0.16;
        const op = opIni.get(aid) + (alvo - opIni.get(aid)) * k;
        x.segs.forEach((s) => { s.material.opacity = op; s.material.depthWrite = op > 0.9; });
        x.rotuloEl.classList.toggle("apagada", k > 0.5);
      }
      mats.bandeja.opacity = 0.94 * k; mats.haste.opacity = 0.45 * k;
    });
    destacarPiso(id);
    if (!refazer) voarParaCaixa(E.caixaBandeja);
    renderInspetor();
  }
  function fecharArea({ semVoo = true, rapido = false } = {}) {
    const id = E.foco;
    if (!id) return;
    const o = areaObj.get(id);
    E.foco = null;
    desmarcar();
    gruposRot.forEach((g) => cena.remove(g)); gruposRot = [];
    if (webgl) {
      // os quadrados voltam para dentro da coluna
      const m = E.ladrilhos.count;
      de.set(atual.subarray(0, m * 4));
      for (let k = 0; k < m; k++) { const j = k * 4; para[j] = o.coluna.position.x; para[j + 1] = PISO + 0.4; para[j + 2] = o.coluna.position.z; para[j + 3] = 0.1; atraso[k] = hash(k) * 80; }
      lote = { inicio: performance.now(), dur: reduz() || rapido ? 0 : 380, n: m, fim: () => { E.ladrilhos.count = 0; } };
      const opIni = new Map([...areaObj].map(([aid, x]) => [aid, x.segs[0].material.opacity]));
      animar(reduz() || rapido ? 0 : 420, (k) => {
        for (const [aid, x] of areaObj) {
          const op = opIni.get(aid) + (1 - opIni.get(aid)) * k;
          x.segs.forEach((s) => { s.material.opacity = op; s.material.depthWrite = op > 0.9; });
          x.rotuloEl.classList.remove("apagada");
        }
        mats.bandeja.opacity = 0.94 * (1 - k); mats.haste.opacity = 0.45 * (1 - k);
        if (k >= 1) { E.bandeja.visible = false; E.haste.visible = false; }
      });
      const altIni = [...o.alt];
      animar(reduz() || rapido ? 0 : 560, (k) => { o.alt = o.altAlvo.map((h, j) => altIni[j] + (h - altIni[j]) * k); posicionarColuna(o); });
      destacarPiso(null);
    }
    E.painel = E.destaque ? { tipo: "destaque" } : { tipo: "resumo" };
    if (!semVoo) visaoGeral();
    renderInspetor();
  }
  function passoLadrilhos(agora) {
    if (!lote) return false;
    let pendente = false;
    for (let k = 0; k < lote.n; k++) {
      const j = k * 4;
      const e = lote.dur ? clamp((agora - lote.inicio - atraso[k]) / lote.dur, 0, 1) : 1;
      if (e < 1) pendente = true;
      const q = mola(e);
      for (let c = 0; c < 4; c++) atual[j + c] = de[j + c] + (para[j + c] - de[j + c]) * q;
      aplicarMatriz(k);
    }
    E.ladrilhos.instanceMatrix.needsUpdate = true;
    if (!pendente) { const f = lote.fim; lote = null; E.ladrilhos.boundingSphere = null; if (f) f(); }
    return true;
  }
  function aplicarMatriz(k) {
    const j = k * 4, s = Math.max(0.0001, atual[j + 3]);
    m4.makeScale(s, s, s);
    m4.setPosition(atual[j], atual[j + 1] + (elevacao.k === k ? elevacao.v : 0), atual[j + 2]);
    E.ladrilhos.setMatrixAt(k, m4);
  }
  function destacarPiso(id) {
    const c = cores();
    for (const [aid, o] of areaObj) {
      const alvo = new THREE.Color(aid === id ? c.pisoAtivo : c.piso), ini = o.matPiso.color.clone();
      if (!ini.equals(alvo)) animar(260, (k) => o.matPiso.color.lerpColors(ini, alvo, k));
    }
  }

  // pallet escolhido: sobe na bandeja e acende o farol
  function selecionar(i, { voo = true } = {}) {
    const a = E.areaDe[i];
    if (!visivel(i)) {   // escondido pelos filtros: volta a mostrar tudo
      E.sit = new Set(E.situacoes); E.fx = new Set([0, 1, 2]);
      if (E.destaque && !E.destaque.conjunto.has(i)) E.destaque = null;
      document.querySelectorAll("#maquete-idade .legend-item, #maquete-situacao .legend-item").forEach((b) => { b.classList.remove("off"); b.setAttribute("aria-pressed", "true"); });
      aplicarFiltros(300);
    }
    E.selecionado = i;
    if (a && E.foco !== a) abrirArea(a, { refazer: true });   // sem voo da bandeja: o voo é até o pallet
    E.painel = { tipo: "pallet", chave: i };
    renderInspetor();
    if (!webgl || !a) return;
    const k = E.slots.indexOf(i);
    if (k < 0) return;
    if (voo && !E.editando) {
      const v = visao(E.modo);
      voar({ alvo: new THREE.Vector3(para[k * 4], BANDEJA_Y, para[k * 4 + 2]), distancia: 30, polar: E.modo === "planta" ? v.polar : 0.74 });
    }
    // sobe e acende o farol quando o quadrado chega na bandeja
    const espera = lote ? Math.max(0, lote.dur + 450 - (performance.now() - lote.inicio)) : 0;
    setTimeout(() => {
      if (E.selecionado !== i || E.slots[k] !== i) return;
      if (elevacao.k >= 0 && elevacao.k !== k) { const ant = elevacao.k; elevacao.k = -1; aplicarMatriz(ant); }
      elevacao.k = k;
      animar(420, (q) => { elevacao.v = 0.55 * q; aplicarMatriz(k); E.ladrilhos.instanceMatrix.needsUpdate = true;
        E.farol.position.set(para[k * 4], para[k * 4 + 1] + 0.2 + elevacao.v, para[k * 4 + 2]); });
      E.farol.visible = true; farolAte = performance.now() + 6000; pedirQuadro();
    }, espera);
  }
  function desmarcar() {
    E.selecionado = -1;
    if (!webgl) return;
    E.farol.visible = false;
    if (elevacao.k >= 0) { const k = elevacao.k; elevacao.k = -1; elevacao.v = 0; if (k < E.ladrilhos.count) { aplicarMatriz(k); E.ladrilhos.instanceMatrix.needsUpdate = true; } }
    pedirQuadro();
  }

  /* =====================================================================
     Ponteiro: passar o mouse mostra a dica; tocar abre a área ou o pallet
     ===================================================================== */
  const raio = new THREE.Raycaster(), ponteiro = new THREE.Vector2();
  let toque = null, movPendente = null;
  function alvoNaTela(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ponteiro.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raio.setFromCamera(ponteiro, camera);
    if (E.foco && E.ladrilhos.count) {
      const h = raio.intersectObject(E.ladrilhos, false)[0];
      if (h && h.instanceId < E.slots.length) return { pallet: E.slots[h.instanceId] };
    }
    const objetos = [];
    for (const o of areaObj.values()) { objetos.push(o.piso, ...o.segs.filter((s) => s.visible)); if (o.maquina) objetos.push(o.maquina); }
    const h = raio.intersectObjects(objetos, false)[0];
    return h ? { area: h.object.userData.area } : null;
  }
  function ligarPonteiro() {
    const el = renderer.domElement;
    el.addEventListener("pointerdown", (ev) => {
      if (E.editando) { const a = alvoNaTela(ev); if (a?.area) iniciarArrasto(ev, a.area); return; }
      toque = { x: ev.clientX, y: ev.clientY }; esconderDica();
    });
    el.addEventListener("pointerup", (ev) => {
      if (!toque || ev.button !== 0 || Math.hypot(ev.clientX - toque.x, ev.clientY - toque.y) > 6) { toque = null; return; }
      toque = null;
      const a = alvoNaTela(ev);
      if (a?.pallet != null) selecionar(a.pallet, { voo: false });
      else if (a?.area) { if (E.foco === a.area) return; abrirArea(a.area); }
      else if (E.foco) fecharArea();
    });
    el.addEventListener("pointermove", (ev) => {
      if (arrasto) return;
      if (ev.pointerType !== "mouse" || ev.buttons) { esconderDica(); return; }
      if (movPendente) { movPendente = ev; return; }
      movPendente = ev;
      requestAnimationFrame(() => { const e = movPendente; movPendente = null; passarMouse(e); });
    });
    el.addEventListener("pointerleave", esconderDica);
  }
  function passarMouse(ev) {
    const a = alvoNaTela(ev);
    renderer.domElement.style.cursor = a ? (E.editando ? "grab" : "pointer") : "";
    if (a?.pallet != null) {
      const p = E.pallets[a.pallet];
      mostrarDica(ev, `<b>Etiqueta ${esc(p.etiqueta)}</b> · OP ${esc(p.op)}<small>${esc(nomeSituacao(p.situacao))} · ${Number(p.kg) > 0 ? fmtKg(Number(p.kg)) : Number(p.kg) < 0 ? "peso negativo" : "sem peso"} · ${idadeTexto(E.dias[a.pallet])}</small>`);
    } else if (a?.area) {
      const o = areaObj.get(a.area);
      const partes = [2, 1, 0].filter((f) => o.contagem[f]).map((f) => `${fmtInt(o.contagem[f])} ${FAIXAS[f].nome.toLowerCase()}`).join(" · ");
      mostrarDica(ev, `<b>${esc(o.area.nome)}</b> · ${fmtInt(o.visiveis)} pallets<small>${E.editando ? "arraste para mover" : partes || "sem pallets com os filtros"}</small>`);
    } else esconderDica();
  }
  function mostrarDica(ev, html) {
    const d = $("maquete-dica"), r = palco.getBoundingClientRect();
    d.innerHTML = html; d.hidden = false;
    let x = ev.clientX - r.left + 14, y = ev.clientY - r.top + 16;
    if (x + d.offsetWidth > r.width - 8) x = ev.clientX - r.left - d.offsetWidth - 14;
    if (y + d.offsetHeight > r.height - 8) y = ev.clientY - r.top - d.offsetHeight - 12;
    d.style.left = x + "px"; d.style.top = y + "px";
  }
  function esconderDica() { $("maquete-dica").hidden = true; }

  /* =====================================================================
     O detalhe ao lado (no celular, embaixo): resumo, área, pallet, destaque.
     Também é a forma de usar a maquete sem o 3D (lista de áreas e pallets).
     ===================================================================== */
  const cab = (titulo, sub, fechar = true) => `<div class="mi-topo"><div><h4>${titulo}</h4>${sub ? `<div class="mi-sub">${sub}</div>` : ""}</div>${fechar
    ? `<button type="button" class="mi-fechar" data-acao="fechar" aria-label="Fechar"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ""}</div>`;
  const grade = (itens) => `<div class="mi-grade">${itens.map(([v, r]) => `<div class="mi-cx"><b>${v}</b><small>${r}</small></div>`).join("")}</div>`;
  const ptFaixa = (i) => `<span class="pt" style="background:var(${FAIXAS[E.faixa[i]].cor})"></span>`;
  const itemPallet = (i, extra) => {
    const p = E.pallets[i];
    return `<button type="button" class="mi-item" data-pallet="${i}">${ptFaixa(i)}<span class="tx">Etiqueta ${esc(p.etiqueta)} · OP ${esc(p.op)}<small>${esc(extra ?? `${nomeSituacao(p.situacao)} · ${p.etapa || "sem próxima etapa"}`)}</small></span><span class="v">${idadeTexto(E.dias[i])}</span></button>`;
  };
  const barrasIdade = (idx) => {
    const c = [0, 0, 0]; idx.forEach((i) => c[E.faixa[i]]++);
    const tot = idx.length || 1;
    return `<div class="mi-barras">${[2, 1, 0].map((f) => `<div class="mi-barra"><span>${FAIXAS[f].nome}</span><span class="t"><span style="width:${(c[f] / tot) * 100}%;background:var(${FAIXAS[f].cor})"></span></span><span class="v">${fmtInt(c[f])}</span></div>`).join("")}</div>`;
  };
  const miniIdade = (o) => { const tot = o.visiveis || 1; return `<span class="mi-mini">${[2, 1, 0].map((f) => `<span style="width:${(o.contagem[f] / tot) * 100}%;background:var(${FAIXAS[f].cor})"></span>`).join("")}</span>`; };
  const conjuntos = {
    velho1ano: () => new Set(E.pallets.map((_, i) => i).filter((i) => E.dias[i] > 365)),
    sempeso: () => new Set(E.pallets.map((_, i) => i).filter((i) => !(Number(E.pallets[i].kg) > 0))),
  };
  function renderInspetor() {
    const el = $("maquete-inspetor"), t = E.painel;
    const html = t.tipo === "pallet" ? painelPallet(t.chave) : t.tipo === "area" ? painelArea(t.chave) : t.tipo === "destaque" && E.destaque ? painelDestaque() : painelResumo();
    el.innerHTML = (E.destaque && t.tipo !== "destaque" ? `<div class="mi-destaque"><span>Mostrando: <b>${esc(E.destaque.titulo)}</b></span><button type="button" data-acao="limpar">Mostrar todos</button></div>` : "") + html;
  }
  function painelResumo() {
    const vis = E.pallets.map((_, i) => i).filter(visivel);
    const kg = vis.reduce((s, i) => s + kgOk(E.pallets[i]), 0);
    const areas = [...areaObj.values()].filter((o) => o.visiveis).sort((a, b) => b.visiveis - a.visiveis);
    const c1 = conjuntos.velho1ano().size, c2 = conjuntos.sempeso().size;
    const cheia = areas[0];
    const fora = E.fora.filter(visivel);
    return cab("Resumo do WIP", "Toque numa área na maquete ou na lista", false)
      + grade([[fmtInt(vis.length), "pallets"], [fmtT(kg), "toneladas"], [fmtInt(areas.length), "áreas"]])
      + `<div class="mi-titulo">Para conferir</div>`
      + `<button type="button" class="mi-missao" data-destaque="velho1ano" aria-pressed="${E.destaque?.chave === "velho1ano"}"><span class="lin"><b>OP com mais de 1 ano</b><span class="n">${fmtInt(c1)}</span></span><small>Ainda no WIP: provável etiqueta não baixada</small></button>`
      + `<button type="button" class="mi-missao" data-destaque="sempeso" aria-pressed="${E.destaque?.chave === "sempeso"}"><span class="lin"><b>Sem peso</b><span class="n">${fmtInt(c2)}</span></span><small>Pallet com metro e peso zerado ou negativo</small></button>`
      + (cheia ? `<button type="button" class="mi-missao" data-area="${cheia.area.id}"><span class="lin"><b>Área mais cheia</b><span class="n">${fmtInt(cheia.visiveis)}</span></span><small>${esc(cheia.area.nome)}: ${fmtT(cheia.kg)} t</small></button>` : "")
      + `<div class="mi-titulo">Áreas</div><div class="mi-lista">${areas.map((o) => `<button type="button" class="mi-item" data-area="${o.area.id}"><span class="tx">${esc(o.area.nome)}${miniIdade(o)}</span><span class="v">${fmtInt(o.visiveis)}</span></button>`).join("") || `<p class="mi-nota">Nenhum pallet com os filtros escolhidos.</p>`}</div>`
      + (fora.length ? `<p class="mi-nota">${fmtInt(fora.length)} pallets em locais que a planta ainda não tem: ${esc([...new Set(fora.map((i) => E.pallets[i].local))].slice(0, 6).join(", "))}.</p>` : "");
  }
  function painelArea(id) {
    const o = areaObj.get(id), a = o.area, todos = E.porArea.get(id) || [], idx = todos.filter(visivel);
    const ops = new Set(idx.map((i) => E.pallets[i].op)).size;
    const antigos = [...idx].sort((x, y) => E.dias[y] - E.dias[x]);
    const mostra = E.todosDaArea ? antigos : antigos.slice(0, 10);
    return `<button type="button" class="mi-voltar" data-acao="voltar">‹ ${E.destaque ? esc(E.destaque.titulo) : "Resumo"}</button>`
      + cab(esc(a.nome), `${esc(a.setor)} · ${a.locais.map(esc).join(", ")}${a.inativa ? " · máquina fora de operação" : ""}`)
      + (idx.length !== todos.length ? `<p class="mi-nota" style="margin-top:6px">${fmtInt(idx.length)} de ${fmtInt(todos.length)} pallets com os filtros escolhidos</p>` : "")
      + grade([[fmtInt(idx.length), "pallets"], [fmtT(o.kg), "toneladas"], [fmtInt(ops), "OPs"]])
      + barrasIdade(idx)
      + (a.estimada ? `<p class="mi-nota estimada">Posição na planta estimada: os nomes das máquinas não se leem na planta baixa.${ehAdmin() ? " Corrija em Ajustar planta." : ""}</p>` : "")
      + (mostra.length ? `<div class="mi-titulo">${E.todosDaArea ? "Todos, da OP mais antiga para a mais nova" : "Mais antigos aqui"}</div><div class="mi-lista">${mostra.map((i) => itemPallet(i)).join("")}</div>`
        + (antigos.length > 10 && !E.todosDaArea ? `<button type="button" class="mi-mais" data-acao="todos">Ver os ${fmtInt(antigos.length)} pallets</button>` : "")
        : `<p class="mi-nota">Nenhum pallet com os filtros escolhidos.</p>`);
  }
  function painelPallet(i) {
    const p = E.pallets[i], a = AREAS.find((x) => x.id === E.areaDe[i]);
    const irmaos = E.pallets.map((_, j) => j).filter((j) => j !== i && E.pallets[j].op === p.op);
    const alertas = [];
    if (E.dias[i] > 365) alertas.push(`OP aberta há ${idadeTexto(E.dias[i])} e o pallet ainda está no WIP como “${esc(nomeSituacao(p.situacao))}”: provável etiqueta que não foi baixada.`);
    if (Number(p.kg) < 0) alertas.push(`Peso negativo no banco (${fmtKg(Number(p.kg))}): conferir o apontamento.`);
    else if (!(Number(p.kg) > 0)) alertas.push("Sem peso apontado.");
    const inicio = p.inicioD ? p.inicioD.toLocaleDateString("pt-BR") : "—";
    return `<button type="button" class="mi-voltar" data-acao="voltar">‹ ${esc(a ? a.nome : "Resumo")}</button>`
      + cab(`<small class="mi-sub" style="display:block;margin:0 0 2px">Etiqueta</small><span class="mi-etiqueta">${esc(p.etiqueta)}</span>`, "")
      + `<div class="mi-pilulas"><span class="mi-pilula"><span class="pt" style="background:var(--text-secondary)"></span>${esc(nomeSituacao(p.situacao))}</span><span class="mi-pilula"><span class="pt" style="background:var(${FAIXAS[E.faixa[i]].cor})"></span>${FAIXAS[E.faixa[i]].nome}</span></div>`
      + `<div class="mi-campos">
          <div><small>OP</small><b>${esc(p.op)}</b></div>
          <div><small>Situação da OP</small><b>${esc(p.situacao_op || "—")}</b></div>
          <div class="largo"><small>Cliente</small><b>${esc(p.cliente || "—")}</b></div>
          <div><small>Onde está</small><b>${esc(a ? a.nome : p.local)}</b></div>
          <div><small>Próxima etapa</small><b>${esc(p.etapa || "—")}</b></div>
          <div><small>Peso</small><b>${Number(p.kg) ? fmtKg(Number(p.kg)) : "Sem peso"}</b></div>
          <div><small>Metros</small><b>${Number(p.metros) ? fmtInt(Number(p.metros)) + " m" : "—"}</b></div>
          <div><small>Início da OP</small><b>${inicio}</b></div>
          <div><small>Idade</small><b>${idadeTexto(E.dias[i])}</b></div>
        </div>`
      + alertas.map((t) => `<div class="mi-alerta">${t}</div>`).join("")
      + (irmaos.length ? `<div class="mi-titulo">Outros ${fmtInt(irmaos.length)} pallets da OP ${esc(p.op)}</div><div class="mi-lista">${irmaos.slice(0, 8).map((j) => itemPallet(j,
          `${AREAS.find((x) => x.id === E.areaDe[j])?.nome || E.pallets[j].local} · ${nomeSituacao(E.pallets[j].situacao)}`)).join("")}</div>
          <button type="button" class="mi-mais" data-acao="op" data-op="${esc(p.op)}">Mostrar só a OP ${esc(p.op)} na maquete</button>` : "");
  }
  function painelDestaque() {
    const d = E.destaque, idx = [...d.conjunto].filter(visivel);
    const kg = idx.reduce((s, i) => s + kgOk(E.pallets[i]), 0);
    const porArea = new Map();
    idx.forEach((i) => { const a = E.areaDe[i] || "_fora"; porArea.set(a, (porArea.get(a) || 0) + 1); });
    const lista = [...porArea].sort((x, y) => y[1] - x[1]);
    return `<button type="button" class="mi-voltar" data-acao="limpar">‹ Resumo</button>`
      + cab(esc(d.titulo), esc(d.sub || ""))
      + grade([[fmtInt(idx.length), "pallets"], [fmtT(kg), "toneladas"], [fmtInt(porArea.size), "áreas"]])
      + barrasIdade(idx)
      + `<div class="mi-titulo">Onde estão</div><div class="mi-lista">${lista.map(([a, n]) => `<button type="button" class="mi-item"${a === "_fora" ? " disabled" : ` data-area="${a}"`}><span class="tx">${esc(a === "_fora" ? "Fora da planta" : AREAS.find((x) => x.id === a).nome)}</span><span class="v">${fmtInt(n)}</span></button>`).join("")}</div>`
      + (idx.length <= 12 ? `<div class="mi-titulo">Pallets</div><div class="mi-lista">${idx.map((i) => itemPallet(i)).join("")}</div>` : "");
  }
  function cliqueNoInspetor(ev) {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.acao === "fechar") { if (E.foco) fecharArea(); else { desmarcar(); E.painel = { tipo: "resumo" }; renderInspetor(); } }
    else if (b.dataset.acao === "voltar") voltar();
    else if (b.dataset.acao === "limpar") definirDestaque(null);
    else if (b.dataset.acao === "todos") { E.todosDaArea = true; renderInspetor(); }
    else if (b.dataset.acao === "op") destacarOP(b.dataset.op);
    else if (b.dataset.destaque) definirDestaque(E.destaque?.chave === b.dataset.destaque ? null : b.dataset.destaque);
    else if (b.dataset.pallet) selecionar(Number(b.dataset.pallet));
    else if (b.dataset.area) abrirArea(b.dataset.area);
  }
  function voltar() {
    if (E.painel.tipo === "pallet") {
      desmarcar();
      E.painel = E.foco ? { tipo: "area", chave: E.foco } : E.destaque ? { tipo: "destaque" } : { tipo: "resumo" };
      renderInspetor();
    } else if (E.foco) fecharArea({ semVoo: false });
    else definirDestaque(null);
  }
  function definirDestaque(chave, extra) {
    if (E.foco) fecharArea({ rapido: true });
    if (!chave) E.destaque = null;
    else if (chave === "velho1ano") E.destaque = { chave, titulo: "OP com mais de 1 ano", sub: "Ainda no WIP: provável etiqueta não baixada", conjunto: conjuntos.velho1ano() };
    else if (chave === "sempeso") E.destaque = { chave, titulo: "Sem peso", sub: "Pallets com metro e peso zerado ou negativo", conjunto: conjuntos.sempeso() };
    else E.destaque = { chave, ...extra };
    E.painel = E.destaque ? { tipo: "destaque" } : { tipo: "resumo" };
    aplicarFiltros();
    if (webgl && E.destaque) {
      const caixa = new THREE.Box3();
      for (const i of E.destaque.conjunto) { const o = areaObj.get(E.areaDe[i]); if (o) caixa.expandByPoint(o.coluna.position); }
      if (!caixa.isEmpty()) voarParaCaixa(caixa, 40);
    }
  }
  function destacarOP(op) {
    const conjunto = new Set(E.pallets.map((_, i) => i).filter((i) => E.pallets[i].op === op));
    const clientes = [...new Set([...conjunto].map((i) => E.pallets[i].cliente).filter(Boolean))];
    definirDestaque(`op:${op}`, { titulo: `OP ${op}`, sub: clientes.join(", "), conjunto });
    const areas = new Set([...conjunto].map((i) => E.areaDe[i]).filter(Boolean));
    if (areas.size === 1) abrirArea([...areas][0]);
  }
  function destacarCliente(nome) {
    const conjunto = new Set(E.pallets.map((_, i) => i).filter((i) => E.pallets[i].cliente === nome));
    definirDestaque(`cliente:${nome}`, { titulo: nome, sub: `${fmtInt(new Set([...conjunto].map((i) => E.pallets[i].op)).size)} OPs no WIP`, conjunto });
  }

  /* =====================================================================
     Ajustar planta (só administrador): arrastar cada área para o lugar certo
     ===================================================================== */
  let arrasto = null, historico = [], escolhida = null;
  const planoChao = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PISO);
  const ehAdmin = () => (typeof papel === "function" ? papel() : papel) === "admin";
  function ligarAjuste() {
    const b = $("maquete-ajustar");
    const mostrarBotao = () => { b.hidden = !(ehAdmin() && webgl); };
    mostrarBotao();
    document.addEventListener("gualapack:perfil", mostrarBotao);
    b.addEventListener("click", () => alternarAjuste());
    addEventListener("pointermove", moverArrasto);
    addEventListener("pointerup", soltarArrasto);
    addEventListener("pointercancel", soltarArrasto);
    addEventListener("keydown", (ev) => {
      if (!E.editando || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); desfazer(); }
      else if (ev.key.toLowerCase() === "r" && !ev.ctrlKey && !ev.metaKey) girar();
    });
  }
  function alternarAjuste(ligar = !E.editando) {
    if (!ehAdmin() || !webgl) return;
    if (ligar && E.foco) fecharArea({ rapido: true });
    E.editando = ligar;
    $("maquete-ajustar").setAttribute("aria-pressed", String(ligar));
    $("maquete-rotulos").classList.toggle("longe", false);
    const barra = $("maquete-edicao");
    barra.hidden = !ligar;
    escolher(null);
    if (ligar) { E.modoAntes = E.modo; if (E.modo !== "planta") { E.modo = "planta"; visaoGeral(); } }
    else if (E.modoAntes && E.modoAntes !== E.modo) { E.modo = E.modoAntes; visaoGeral(); }
  }
  function atualizarBarra() {
    const barra = $("maquete-edicao"), a = AREAS.find((x) => x.id === escolhida);
    const faltam = AREAS.filter((x) => x.estimada).length;
    barra.innerHTML = `<div class="txt"><span>${a ? `<b>${esc(a.nome)}</b> · arraste para mover` : "Arraste cada máquina para o lugar dela na planta"}</span>
      <small>${faltam ? `${faltam} de ${AREAS.length} áreas ainda estimadas` : "Todas as áreas conferidas"}</small></div>
      <button type="button" data-ed="girar" ${a ? "" : "disabled"} title="Girar 90° (R)">Girar</button>
      <button type="button" data-ed="desfazer" ${historico.length ? "" : "disabled"} title="Desfazer (Ctrl+Z)">Desfazer</button>
      <button type="button" data-ed="concluir" class="primario">Concluir</button>`;
    barra.onclick = (ev) => { const d = ev.target.closest("[data-ed]")?.dataset.ed; if (d === "girar") girar(); else if (d === "desfazer") desfazer(); else if (d === "concluir") alternarAjuste(false); };
  }
  function escolher(id) {
    escolhida = id;
    for (const [aid, o] of areaObj) o.rotuloEl.classList.toggle("escolhida", aid === id && E.editando);
    atualizarBarra();
  }
  function pontoNoChao(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ponteiro.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raio.setFromCamera(ponteiro, camera);
    return raio.ray.intersectPlane(planoChao, new THREE.Vector3());
  }
  function iniciarArrasto(ev, id) {
    const p = pontoNoChao(ev), a = AREAS.find((x) => x.id === id);
    if (!p || !a) return;
    ev.preventDefault(); ev.stopPropagation();
    escolher(id);
    arrasto = { a, inicio: p, maq: a.maquina ? { ...a.maquina } : null, est: { ...a.estoque }, moveu: false };
    controles.enabled = false;
  }
  function moverArrasto(ev) {
    if (!arrasto) return;
    const p = pontoNoChao(ev);
    if (!p) return;
    const dx = Math.round((p.x - arrasto.inicio.x) * 4) / 4, dz = Math.round((p.z - arrasto.inicio.z) * 4) / 4;   // passos de 0,25 m
    if (dx || dz) arrasto.moveu = true;
    const { a } = arrasto, o = areaObj.get(a.id);
    if (a.maquina) { a.maquina.x = arrasto.maq.x + dx; a.maquina.z = arrasto.maq.z + dz; o.maquina.position.set(a.maquina.x, PISO, a.maquina.z); }
    a.estoque.x = arrasto.est.x + dx; a.estoque.z = arrasto.est.z + dz;
    o.piso.position.set(a.estoque.x, PISO, a.estoque.z);
    o.coluna.position.set(a.estoque.x, PISO + 0.1, a.estoque.z);
    posicionarColuna(o);
    pedirQuadro();
  }
  function soltarArrasto() {
    if (!arrasto) return;
    const { a, maq, est, moveu } = arrasto;
    arrasto = null;
    controles.enabled = true;
    if (!moveu) return;
    historico.push({ id: a.id, maquina: maq, estoque: est, estimada: a.estimada, ajustada: a.ajustada });
    a.estimada = false; a.ajustada = true;
    areaObj.get(a.id).rotuloEl.classList.remove("estimada");
    salvar(a);
  }
  function girar() {
    const a = AREAS.find((x) => x.id === escolhida);
    if (!a) return;
    historico.push({ id: a.id, maquina: a.maquina ? { ...a.maquina } : null, estoque: { ...a.estoque }, estimada: a.estimada, ajustada: a.ajustada });
    const c = a.maquina || a.estoque, e = a.estoque, rx = e.x - c.x, rz = e.z - c.z;   // gira 90° em torno da máquina
    e.x = c.x - rz; e.z = c.z + rx; [e.w, e.d] = [e.d, e.w];
    if (a.maquina) [a.maquina.w, a.maquina.d] = [a.maquina.d, a.maquina.w];
    a.estimada = false; a.ajustada = true;
    montarArea(a);
    salvar(a);
  }
  function desfazer() {
    const h = historico.pop();
    if (!h) return;
    const a = AREAS.find((x) => x.id === h.id);
    if (a.maquina && h.maquina) Object.assign(a.maquina, h.maquina);
    Object.assign(a.estoque, h.estoque);
    a.estimada = h.estimada; a.ajustada = h.ajustada;
    montarArea(a);
    escolher(a.id);
    if (a.ajustada) salvar(a); else restaurar(a);
  }
  const r2 = (v) => Math.round(v * 100) / 100;
  const posicao = (r) => (r ? { x: r2(r.x), z: r2(r.z), w: r2(r.w), d: r2(r.d) } : null);
  async function salvar(a) {
    atualizarBarra(); pedirQuadro();
    const { error } = await client.rpc("wip_area_salvar", { p_id: a.id, p_maquina: posicao(a.maquina), p_estoque: posicao(a.estoque) });
    avisoEdicao(error ? `Não salvou ${a.nome}: ${error.message || "erro do banco"}` : `${a.nome}: posição salva`);
  }
  async function restaurar(a) {
    atualizarBarra(); pedirQuadro();
    const { error } = await client.rpc("wip_area_restaurar", { p_id: a.id });
    avisoEdicao(error ? `Não desfez ${a.nome}: ${error.message || "erro do banco"}` : `${a.nome}: voltou à posição estimada`);
  }
  function avisoEdicao(texto) {
    const s = $("maquete-edicao").querySelector(".txt small");
    if (s) s.textContent = texto;
  }

  /* =====================================================================
     Tema, introdução e o que o painel chama
     ===================================================================== */
  function ehEscuro() {
    const t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function cores() {
    const cs = getComputedStyle(document.documentElement), v = (x) => cs.getPropertyValue(x).trim() || "#888";
    const e = ehEscuro();
    return {
      faixa: FAIXAS.map((f) => "#" + new THREE.Color(v(f.cor)).lerp(new THREE.Color(e ? "#000000" : "#ffffff"), e ? 0 : 0.12).getHexString()), acento: v("--accent"),
      laje: e ? "#141a23" : "#f3f6fa", parede: e ? "#243041" : "#ffffff", maquina: e ? "#283648" : "#ffffff",
      topo: e ? "#3d4e64" : "#c6d0dc", piso: e ? "#1b2533" : "#dde5ee", pisoAtivo: e ? "#1d3550" : "#c7dcf2",
      linha: e ? "#a9bdd6" : "#33475e", linhaOpac: e ? 0.55 : 0.78, bandeja: e ? "#1b2330" : "#ffffff",
    };
  }
  function aplicarTema() {
    if (!webgl) return;
    const c = cores();
    mats.laje.color.set(c.laje); mats.parede.color.set(c.parede); mats.maquina.color.set(c.maquina); mats.inativa.color.set(c.maquina);
    mats.topo.color.set(c.topo); mats.sala.color.set(c.maquina); mats.bandeja.color.set(c.bandeja); mats.haste.color.set(c.acento);
    if (mats.planta) { mats.planta.color.set(c.linha); mats.planta.opacity = c.linhaOpac; }
    for (const [id, o] of areaObj) {
      o.matPiso.color.set(id === E.foco ? c.pisoAtivo : c.piso);
      o.segs.forEach((s, k) => s.material.color.set(c.faixa[k]));
    }
    const corT = new THREE.Color();
    for (let k = 0; k < E.ladrilhos.count; k++) E.ladrilhos.setColorAt(k, corT.set(c.faixa[E.faixa[E.slots[k]]]));
    if (E.ladrilhos.instanceColor) E.ladrilhos.instanceColor.needsUpdate = true;
    E.farol.children.forEach((m) => m.material.color.set(c.acento));
    luzCeu.intensity = ehEscuro() ? 1.15 : 1.7; luzSol.intensity = ehEscuro() ? 1.45 : 2.0;
    luzCeu.groundColor.set(ehEscuro() ? 0x1a2433 : 0x9aa9bb);
    pedirQuadro();
  }
  function introducao() {
    // as colunas sobem do chão, da esquerda para a direita; a câmera desce até a fábrica
    const v = visao("maquete");
    controles.target.copy(CENTRO);
    const dist = distanciaPara(BX[1] - BX[0], BZ[1] - BZ[0], v.polar, v.azimute);
    camera.position.setFromSpherical(new THREE.Spherical(dist * 1.35, 0.62, v.azimute - 0.45)).add(CENTRO);
    camera.lookAt(CENTRO);
    renderer.compile(cena, camera);
    const ordem = [...areaObj.values()].sort((a, b) => a.coluna.position.x - b.coluna.position.x);
    ordem.forEach((o, k) => {
      const alvo = [...o.altAlvo];
      o.alt = [0, 0, 0]; posicionarColuna(o);
      setTimeout(() => animar(reduz() ? 0 : 700, (q) => { o.alt = alvo.map((h) => h * q); posicionarColuna(o); }), reduz() ? 0 : 200 + k * 40);
    });
    visaoGeral(reduz() ? 0 : 1500);
  }
  function mostrarEstado(texto) {
    estadoEl.hidden = false; estadoEl.classList.add("falha"); estadoEl.textContent = texto;
  }

  // busca do painel: etiqueta e OP pelo número, cliente pelo nome
  function buscar(q) {
    q = String(q || "").trim();
    const out = [];
    if (!q) return out;
    if (/^\d+$/.test(q) && q.length >= 3) {
      for (let i = 0; i < E.pallets.length && out.length < 3; i++) if (String(E.pallets[i].etiqueta).startsWith(q)) {
        const p = E.pallets[i];
        out.push({ tipo: "pallet", chave: i, rotulo: `Etiqueta ${p.etiqueta}`, sub: `OP ${p.op} · ${AREAS.find((a) => a.id === E.areaDe[i])?.nome || p.local} · ${nomeSituacao(p.situacao)}` });
      }
      const ops = new Map();
      E.pallets.forEach((p) => { if (String(p.op).startsWith(q)) ops.set(p.op, (ops.get(p.op) || 0) + 1); });
      [...ops].slice(0, 3).forEach(([op, k]) => out.push({ tipo: "op", chave: op, rotulo: `OP ${op}`, sub: `${fmtInt(k)} pallet${k === 1 ? "" : "s"} no WIP` }));
    } else if (q.length >= 3) {
      const qn = nrm(q), cli = new Map();
      E.pallets.forEach((p) => { if (nrm(p.cliente).includes(qn)) cli.set(p.cliente, (cli.get(p.cliente) || 0) + 1); });
      [...cli].sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([c, k]) => out.push({ tipo: "cliente", chave: c, rotulo: c, sub: `${fmtInt(k)} pallets no WIP` }));
    }
    return out;
  }
  function irPara(alvo) {
    if (!alvo) return;
    if (alvo.busca != null) {
      const r = buscar(alvo.busca)[0];
      if (!r) { definirDestaque(null); $("maquete-inspetor").insertAdjacentHTML("afterbegin", `<p class="mi-nota" style="margin:0 0 10px">Nenhuma etiqueta ou OP começa com ${esc(alvo.busca)} no WIP.</p>`); return; }
      alvo = r;
    }
    palco.scrollIntoView({ behavior: reduz() ? "auto" : "smooth", block: "center" });
    if (alvo.tipo === "pallet") selecionar(alvo.chave);
    else if (alvo.tipo === "op") destacarOP(alvo.chave);
    else if (alvo.tipo === "cliente") destacarCliente(alvo.chave);
  }

  montarTudo();
  return {
    mostrar() { redimensionar(); pedirQuadro(); },
    buscar,
    irPara,
  };
}
