// ============================================================================
// collect-bases.js — extrai as BASES LÓGICAS do catálogo a partir dos
// arquivos originais, com rastreabilidade de origem.
// ----------------------------------------------------------------------------
// Separado de build-database-central.js porque a lógica é diferente: lá as
// abas são definidas por TABLE_DEFS (formato Supabase); aqui são definidas
// por bases-catalog.js (formato inventário), com cabeçalho em linha
// explícita, casamento de várias abas por base e colunas de origem.
// ============================================================================

import * as XLSX from "xlsx";
import { normalize, RETENTION_MONTHS } from "./lib.js";
import { BASES } from "./bases-catalog.js";

// Bases que são log de evento e crescem sem limite: aplicam a mesma janela
// de 12 meses já usada na carga do Supabase. Sem isso o arquivo central
// passaria de 1 GB só com as abas de apontamento repetidas dos Base Aparas.
const RETENCAO_POR_BASE = {
  DB_APONTAMENTOS_HIST: "dt_producao",
  DB_PRODUCAO_OP: "dt_producao",
};

// Colunas de rastreabilidade adicionadas a TODA linha consolidada, para
// responder depois "de onde veio esse número?".
export const COLUNAS_ORIGEM = ["arquivo_origem", "aba_origem", "origem", "data_importacao"];

function basesDoArquivo(fileName) {
  const norm = normalize(fileName);
  return BASES.filter((b) => b.fileKeywords.some((k) => norm.includes(k)));
}

// Casa aba por normalização; prefere igualdade exata e cai pra "contém".
function abasDaBase(base, sheetNames) {
  const alvos = base.sheetMatch.map(normalize);
  const exatas = sheetNames.filter((n) => alvos.includes(normalize(n)));
  const escolhidas = exatas.length
    ? exatas
    : sheetNames.filter((n) => alvos.some((a) => normalize(n).includes(a)));
  return base.multiSheet ? escolhidas : escolhidas.slice(0, 1);
}

// Converte a aba em objetos usando a linha de cabeçalho declarada no
// catálogo (headerRow), não por auto-detecção — as planilhas reais têm
// linha de título acima do cabeçalho em vários casos.
function linhasDaAba(sheet, headerRow) {
  const cru = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  const idx = headerRow ?? 0;
  if (cru.length <= idx) return { headers: [], linhas: [] };
  const headers = (cru[idx] ?? []).map((h) => String(h ?? "").trim());
  const linhas = cru.slice(idx + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => {
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = r[i] ?? ""; });
      return o;
    });
  return { headers, linhas };
}

function paraIso(valor, tipo) {
  let d;
  if (valor instanceof Date) d = valor;
  else if (typeof valor === "number") d = new Date(Math.round((valor - 25569) * 86400 * 1000));
  else {
    const p = new Date(String(valor));
    if (Number.isNaN(p.getTime())) return null;
    d = p;
  }
  if (Number.isNaN(d.getTime())) return null;
  return tipo === "date" ? d.toISOString().slice(0, 10) : d.toISOString();
}

// Percentual vem do Excel como 0.38 (formatado como 38%) ou como "38%".
// Normaliza pra número em pontos percentuais.
function paraNumero(valor) {
  if (typeof valor === "number") return valor;
  const s = String(valor).trim();
  if (s.endsWith("%")) {
    const n = Number(s.slice(0, -1).replace(/\./g, "").replace(",", "."));
    return Number.isNaN(n) ? null : n;
  }
  const n = Number(s.replace(/\s/g, "").replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

function converterLinha(linha, base) {
  const saida = {};
  for (const [chave, valor] of Object.entries(linha)) {
    const destino = base.colunas[normalize(chave)];
    if (!destino) continue; // coluna que não interessa a esta base
    if (valor === "" || valor === null || valor === undefined) saida[destino] = null;
    else if (base.date?.[destino]) saida[destino] = paraIso(valor, base.date[destino]);
    else if (base.numeric?.includes(destino)) {
      const n = paraNumero(valor);
      // O Excel guarda percentual como fração (0.38 exibido como 38%).
      // Converte pra pontos percentuais, que é a unidade usada no resto
      // do projeto (ex: apara_pct = 6.4).
      saida[destino] = n !== null && destino.endsWith("_pct") && Math.abs(n) <= 1.5 ? n * 100 : n;
    } else saida[destino] = typeof valor === "string" ? valor.trim() : valor;
  }
  return saida;
}

// Retorna Map: nome da aba DB_ -> { linhas, colunas, origens[], erros[] }
export function coletarBases(fileName, bytes, importadoEm) {
  const bases = basesDoArquivo(fileName);
  if (bases.length === 0) return new Map();

  // Uma leitura por arquivo com TODAS as abas necessárias — ler aba por aba
  // descompactaria o zip inteiro a cada chamada (foi o que travou o inspetor).
  const nomes = XLSX.read(bytes, { type: "array", bookSheets: true }).SheetNames;
  const necessarias = new Set();
  const planoPorBase = new Map();
  for (const base of bases) {
    const abas = abasDaBase(base, nomes);
    if (abas.length === 0) continue;
    planoPorBase.set(base, abas);
    abas.forEach((a) => necessarias.add(a));
  }
  if (necessarias.size === 0) return new Map();

  const wb = XLSX.read(bytes, { type: "array", sheets: Array.from(necessarias) });

  const corte = new Date();
  corte.setMonth(corte.getMonth() - RETENTION_MONTHS);

  const resultado = new Map();
  for (const [base, abas] of planoPorBase) {
    const bucket = resultado.get(base.sheet) ?? { linhas: [], colunas: new Set(), origens: [], erros: [] };
    for (const aba of abas) {
      try {
        const sheet = wb.Sheets[aba];
        if (!sheet) continue;
        const { headers, linhas } = linhasDaAba(sheet, base.headerRow);
        if (linhas.length === 0) continue;

        // Algumas bases (TMR) guardam a identidade do recurso no nome da aba
        // e um rótulo descritivo numa linha acima do cabeçalho. O nome da
        // aba é o identificador confiável: a aba "TMR - L04" tem o rótulo
        // "Laminação" na linha 2, igual à aba "TMR - Laminação", que é o
        // processo inteiro — usar o rótulo confundiria máquina com processo.
        let recurso = null, recursoRotulo = null;
        if (base.recursoFromRow != null) {
          recurso = aba.replace(/^\s*TMR\s*-\s*/i, "").trim() || aba;
          const cru = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
          recursoRotulo = String(cru[base.recursoFromRow]?.[0] ?? "").trim() || null;
        }

        let convertidas = linhas.map((l) => converterLinha(l, base));
        convertidas = convertidas.filter((l) => Object.values(l).some((v) => v !== null && v !== ""));

        const colRetencao = RETENCAO_POR_BASE[base.sheet];
        const antes = convertidas.length;
        if (colRetencao) {
          convertidas = convertidas.filter((l) => l[colRetencao] && new Date(l[colRetencao]) >= corte);
        }

        for (const l of convertidas) {
          if (recurso) {
            l.recurso = recurso;
            l.recurso_rotulo = recursoRotulo;
            // R18/R20/L04 são máquinas; Flexo/Roto/Laminação/Corte são
            // processos que agregam várias máquinas.
            l.granularidade = /^(r\d+|l\d+|reb)/i.test(recurso) ? "maquina" : "processo";
          }
          l.arquivo_origem = fileName;
          l.aba_origem = aba;
          l.origem = base.origem;
          l.data_importacao = importadoEm;
          bucket.linhas.push(l);
          Object.keys(l).forEach((c) => bucket.colunas.add(c));
        }

        bucket.origens.push({
          arquivo: fileName, aba, lidas: linhas.length, mantidas: convertidas.length,
          descartadas_retencao: colRetencao ? antes - convertidas.length : 0,
          cabecalhos: headers.filter(Boolean),
        });
      } catch (err) {
        bucket.erros.push(`${fileName} [${aba}]: ${err.message}`);
      }
    }
    if (bucket.linhas.length || bucket.erros.length || bucket.origens.length) {
      resultado.set(base.sheet, bucket);
    }
  }
  return resultado;
}

export { BASES };
