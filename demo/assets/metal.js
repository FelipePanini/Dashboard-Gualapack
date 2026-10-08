/* Metal líquido na marca e no assistente (o visual do hero-liquid-metal do
   cult-ui, com o mesmo shader LiquidMetal da Paper Design, sem React).

   Onde:  data-metal="g"      o G da barra lateral (sobre o quadrado azul)
          data-metal="marca"  o "Gualapack" do topo (e o da tela de entrada)
          data-metal="anel"   o anel em volta do botão do assistente e do selo
                              do cabeçalho do chat (o recorte do anel é CSS)

   As letras foram pré-processadas uma vez (toProcessedLiquidMetal, a mesma
   função do componente) a partir do contorno da Playfair Display Italic 700:
   assets/metal-g.png, metal-guala.png e metal-pack.png. O texto continua na
   página (leitor de tela) e só some da vista depois que o metal desenha; sem
   WebGL ou sem o CDN, fica a marca de sempre.
   Movimento: o próprio shader pausa fora da tela e com a aba oculta; com
   "reduzir movimento", fica parado. */
// O shader vem do CDN por import dinâmico: se o CDN falhar, fica só um aviso
// e a marca de sempre (um import estático viraria erro na página).
const CDN = "https://cdn.jsdelivr.net/npm/@paper-design/shaders@0.0.81/+esm";
let ShaderMount, liquidMetalFragmentShader, getShaderColorFromString, LiquidMetalShapes, ShaderFitOptions;

const BASE = new URL(".", import.meta.url);
const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// Caixas das imagens em unidades da fonte (1000 por em), com 24 de margem:
// [x, y do topo (y para baixo, linha de base em 0), largura, altura]
const CAIXA = { guala: [14, -819, 2736.4, 857], pack: [-114.6, -819, 2280.4, 1024] };
const AVANCO_GUALA = 2752;   // onde o "pack" começa (avanço do "Guala" com kerning)

// Tinta (o shader aplica em "color burn": tinta clara = cromo claro)
const TINTA = {
  claro:  { g: "#dcecfb", guala: "#ffffff", pack: "#5c9fe0", anel: "#a9d1f5" },
  escuro: { g: "#dcecfb", guala: "#ffffff", pack: "#7db8f0", anel: "#8fc1ee" },
};
// Preset cromado do shader (o padrão do LiquidMetal), mais calmo nas letras
const PARAMS = { u_contour: .4, u_distortion: .12, u_softness: .25, u_repetition: 2.2, u_shiftRed: .3, u_shiftBlue: .3, u_angle: 70 };
const VELOCIDADE = { g: .5, guala: .5, pack: .5, anel: 1 };

const raiz = document.documentElement;
const reduz = window.matchMedia("(prefers-reduced-motion: reduce)");
const escuroSistema = window.matchMedia("(prefers-color-scheme: dark)");
const tema = () => { const t = raiz.getAttribute("data-theme"); return t === "dark" || (t !== "light" && escuroSistema.matches) ? "escuro" : "claro"; };

const imagens = {};
function imagem(nome){
  if(!imagens[nome]){
    const i = new Image();
    i.src = nome ? new URL(`metal-${nome}.png`, BASE).href : PIXEL;
    imagens[nome] = i.decode().then(() => i);
  }
  return imagens[nome];
}

const montados = [];   // { mount, tipo }
async function montar(alvo, tipo, nomeImagem){
  const img = await imagem(nomeImagem || "");
  const mount = new ShaderMount(alvo, liquidMetalFragmentShader, {
    u_colorBack: getShaderColorFromString("#00000000"),
    u_colorTint: getShaderColorFromString(TINTA[tema()][tipo]),
    u_image: img, u_isImage: !!nomeImagem, u_shape: LiquidMetalShapes.none,
    ...PARAMS,
    u_fit: ShaderFitOptions.contain, u_scale: 1, u_rotation: 0, u_offsetX: 0, u_offsetY: 0,
    u_originX: .5, u_originY: .5, u_worldWidth: 0, u_worldHeight: 0,
  }, undefined, reduz.matches ? 0 : VELOCIDADE[tipo], 0, 2, 1600 * 1600, ["u_image"]);
  montados.push({ mount, tipo });
  return mount;
}

function camada(pai, css){
  const el = document.createElement("span");
  el.className = "metal-camada";
  el.setAttribute("aria-hidden", "true");
  Object.assign(el.style, css);
  pai.appendChild(el);
  return el;
}

// "Gualapack": as duas partes alinhadas pela linha de base real do texto, em
// em (acompanham o tamanho da fonte se a tela mudar de largura)
async function marca(el){
  if(document.fonts && document.fonts.ready) await document.fonts.ready;   // mede na Playfair, não na reserva
  const fs = parseFloat(getComputedStyle(el).fontSize) || 21;
  const marco = document.createElement("span");
  marco.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  el.appendChild(marco);
  const base = (marco.getBoundingClientRect().top - el.getBoundingClientRect().top) / fs;   // em
  marco.remove();
  el.classList.add("metal-palco");
  const em = v => v.toFixed(4) + "em";
  const pos = (nome, x0) => { const [x, y, w, h] = CAIXA[nome];
    return { left: em((x0 + x) / 1000), top: em(base + y / 1000), width: em(w / 1000), height: em(h / 1000) }; };
  await montar(camada(el, pos("guala", 0)), "guala", "guala");
  await montar(camada(el, pos("pack", AVANCO_GUALA)), "pack", "pack");
}

async function iniciar(){
  const alvos = [...document.querySelectorAll("[data-metal]")];
  if(!alvos.length) return;
  try{
    ({ ShaderMount, liquidMetalFragmentShader, getShaderColorFromString, LiquidMetalShapes, ShaderFitOptions } = await import(CDN));
    if(!ShaderMount) throw new Error("shader sem ShaderMount");
  }catch(e){
    console.warn("Metal líquido indisponível (CDN); fica a marca de sempre.", e);
    return;
  }
  for(const el of alvos){
    try{
      const tipo = el.dataset.metal;
      if(tipo === "marca") await marca(el);
      else if(tipo === "g"){ el.classList.add("metal-palco"); await montar(camada(el, { inset: "2px" }), "g", "g"); }
      else if(tipo === "anel") await montar(el, "anel", "");
      el.classList.add("metal-ativo");   // o CSS esconde o texto/fundo só agora
    }catch(e){
      console.warn("Metal líquido indisponível; fica a marca de sempre.", e);
      return;
    }
  }
  const retingir = () => montados.forEach(({ mount, tipo }) => mount.setUniforms({ u_colorTint: getShaderColorFromString(TINTA[tema()][tipo]) }));
  new MutationObserver(retingir).observe(raiz, { attributes: true, attributeFilter: ["data-theme"] });
  escuroSistema.addEventListener("change", retingir);
  reduz.addEventListener("change", () => montados.forEach(({ mount, tipo }) => mount.setSpeed(reduz.matches ? 0 : VELOCIDADE[tipo])));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
