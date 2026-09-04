// ============================================================================
// ingest — recebe planilhas reais enviadas pela tela demo/upload.html
// ----------------------------------------------------------------------------
// Chamada direto do navegador (client.functions.invoke), com a sessão do
// usuário logado. Verifica que quem chama é admin (role = 'admin' em
// profiles), depois faz o parse da aba enviada (SheetJS) e upsert na tabela
// escolhida — ver backend/README-dados.md pro mapeamento planilha -> tabela.
//
// Corpo esperado (POST):
//   {
//     "table": "apontamentos",
//     "fileName": "Indicadores Diário - 2026.xlsx",
//     "sheetName": "Base Máquina_Embalagem",   // opcional — várias abas
//     "contentBase64": "<arquivo (ou a aba já cortada) em base64>"
//   }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

// Tabela -> colunas que devem virar número (o resto fica como veio: texto).
const NUMERIC_COLUMNS: Record<string, string[]> = {
  maquinas: [],
  apontamentos: [
    "qtd_horas", "qtd_produzida", "desperdicio_acerto", "desperdicio_virando",
    "peso_bruto_bobina", "kg_perda",
  ],
  fardos_aparas: ["numero", "qtd_bruta_kg", "qtd_liquida_kg"],
  aderencia_maquinas_diaria: ["qtd_produzida", "qtd_horas"],
  aderencia_programacao: [
    "qtd_produzido", "qtd_planejado", "meta_qtd_acerto", "qtd_acerto_real",
    "min_set_prog", "min_set_real", "qtd_prod_kg", "meta_mts_hora", "qtd_hor_p",
  ],
  refugo_aparas_historico: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"],
  tendencia_mensal: ["ano", "volume_prod_corte_km", "lote_medio_km", "volume_prod_kg", "aparas_kg", "aparas_pct"],
};

// Tabela -> TODAS as colunas de verdade (id gerada automaticamente não
// entra aqui). Qualquer coluna da planilha que, depois de normalizada e
// verificado o alias, não estiver nesta lista é IGNORADA em vez de travar
// a carga inteira — as planilhas reais sempre trazem colunas extras
// (rótulos de pivot, campos que não usamos) que não têm por que derrubar
// o resto da linha.
const ALLOWED_COLUMNS: Record<string, string[]> = {
  maquinas: ["id", "grupo", "considerar"],
  apontamentos: [
    "num_ordem", "cod_recurso", "cod_apont", "cod_desc", "dt_producao", "hora_inicio", "hora_fim",
    "qtd_horas", "qtd_produzida", "turno", "desperdicio_acerto", "desperdicio_virando", "peso_bruto_bobina",
    "tipo_perda", "kg_perda", "nome_operador", "tipo_produto", "cod_estrutura", "des_num_ordem", "cod_est",
    "processo", "classificacao", "nome_cliente",
  ],
  fardos_aparas: [
    "codigo", "dp_fp", "refugo", "refile", "data", "numero", "qtd_bruta_kg", "qtd_liquida_kg",
    "nome", "classificacao", "tipo",
  ],
  aderencia_maquinas_diaria: [
    "num_ordem", "dt_producao", "qtd_produzida", "cod_recurso", "qtd_horas", "classificacao",
    "descricao", "cod_estrutura", "turno", "cod_desc", "cod_apont",
  ],
  aderencia_programacao: [
    "cod_cliente", "cod_estrutura", "recurso_ctr", "tipo_produto", "num_ordem", "dt_saida_maquina",
    "descricao", "cliente", "atividade", "qtd_produzido", "qtd_planejado", "meta_qtd_acerto",
    "qtd_acerto_real", "min_set_prog", "min_set_real", "qtd_prod_kg", "meta_mts_hora", "qtd_hor_p", "cilindro",
  ],
  refugo_aparas_historico: ["data", "volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf"],
  tendencia_mensal: ["mes", "ano", "volume_prod_corte_km", "lote_medio_km", "volume_prod_kg", "aparas_kg", "aparas_pct"],
};

// Tabela -> colunas de data/hora (o Excel entrega essas como número de série,
// não como texto — precisam de conversão especial, não só Number()).
// "date" -> vira "AAAA-MM-DD"; "timestamp" -> vira ISO completo.
const DATE_COLUMNS: Record<string, Record<string, "date" | "timestamp">> = {
  apontamentos: { dt_producao: "date", hora_inicio: "timestamp", hora_fim: "timestamp" },
  fardos_aparas: { data: "date" },
  aderencia_maquinas_diaria: { dt_producao: "date" },
  aderencia_programacao: { dt_saida_maquina: "timestamp" },
  refugo_aparas_historico: { data: "date" },
};

// Tabelas com chave natural (não a "id" gerada) usam onConflict pra virar
// upsert de verdade — sem isso, reenviar o mesmo mês/dia duplicaria linhas.
// "maquinas" não está aqui porque sua chave (id) já é a primary key da
// tabela — o Supabase usa ela como conflito por padrão, sem precisar dizer.
const CONFLICT_COLUMNS: Record<string, string> = {
  refugo_aparas_historico: "data",
  tendencia_mensal: "mes,ano",
};

// Mesma ideia, mas usada pra DEDUPLICAR a lista de linhas antes de gravar —
// mesmo com onConflict certo, o Postgres rejeita um upsert que tenta
// atualizar a MESMA chave duas vezes dentro do mesmo lote ("ON CONFLICT DO
// UPDATE command cannot affect row a second time"), e planilhas reais têm
// linhas repetidas (ex: máquina cadastrada duas vezes no Machine Card).
const DEDUPE_KEY: Record<string, string> = {
  ...CONFLICT_COLUMNS,
  maquinas: "id",
};

function dedupeRows(rows: Record<string, unknown>[], keyCols: string | undefined): Record<string, unknown>[] {
  if (!keyCols) return rows;
  const cols = keyCols.split(",");
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = cols.map((c) => String(row[c] ?? "")).join("|");
    map.set(key, row); // a última ocorrência da chave vence
  }
  return Array.from(map.values());
}

const ALLOWED_TABLES = new Set(Object.keys(NUMERIC_COLUMNS));

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cabeçalhos reais vêm em "CamelCase" grudado (ex: "CodApont", "NumOrdem"),
// sem espaço nem underscore separando as palavras — por isso insere "_"
// entre uma letra minúscula/número e a maiúscula seguinte ANTES de baixar
// pra minúsculo, senão "CodApont" viraria "codapont" em vez de "cod_apont".
function normalizeHeader(name: string): string {
  return String(name)
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Colunas cujo nome real na planilha não bate nem depois de normalizar
// (prefixo "usr_" do sistema de origem, abreviações diferentes etc.) —
// mapeadas manualmente pro nome que usamos no banco.
const HEADER_ALIASES: Record<string, string> = {
  usr_tipodaperda: "tipo_perda",
  usr_kgdaperda: "kg_perda",
  usr_peso_bruto_bobina: "peso_bruto_bobina",
  dp_ou_fp: "dp_fp",           // "DP ou FP" na planilha de fardos
  n: "numero",                 // "Nº" na planilha de fardos
  mini_set_real: "min_set_real", // "Mini_Set_Real" (typo na planilha de origem)
  date: "data",                 // "DATE" no Refugo Aparas
  type_of_machine: "id",        // "Type of Machine" no Machine Card
  machine_group: "grupo",       // caso um dia o cabeçalho venha limpo
  machine_group_considerar: "grupo", // "Machine Group Considerar ?" — como o
                                      // cabeçalho realmente vem no Machine Card
                                      // (texto quebrado em duas linhas numa
                                      // célula só); confirmado via log em
                                      // 2026-09-04.
};

// O Excel guarda datas como número de série (dias desde 30/12/1899) — o
// SheetJS só converte pra objeto Date sozinho se a célula tiver formatação
// de data nos metadados, o que nem sempre vem preservado. Por isso qualquer
// coluna marcada em DATE_COLUMNS passa por aqui, aceitando os três formatos
// possíveis que podem chegar: já um Date, um número de série, ou texto.
function excelValueToIso(value: unknown, kind: "date" | "timestamp"): string | null {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = new Date(Math.round((value - 25569) * 86400 * 1000));
  } else {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return null;
    date = parsed;
  }
  if (Number.isNaN(date.getTime())) return null;
  return kind === "date" ? date.toISOString().slice(0, 10) : date.toISOString();
}

// Algumas planilhas (ex: "Graficos Tendência") têm uma linha de título
// mesclada acima do cabeçalho de verdade (célula A preenchida, o resto
// vazio) — sheet_to_json trata essa linha como cabeçalho e joga os nomes de
// coluna reais pra dentro dos dados. Lê cru (header:1) e usa a primeira
// linha com mais de 1 célula preenchida como cabeçalho de verdade — pra
// planilhas sem linha de título (a maioria), isso já é a linha 1.
// deno-lint-ignore no-explicit-any
function sheetToRows(sheet: any): Record<string, unknown>[] {
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  let headerIdx = raw.findIndex((row) => row.filter((c) => String(c).trim() !== "").length > 1);
  if (headerIdx === -1) headerIdx = 0;
  const headers = raw[headerIdx].map((h) => String(h ?? "").trim());
  return raw.slice(headerIdx + 1)
    .filter((row) => row.some((c) => String(c).trim() !== ""))
    .map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] ?? ""; });
      return obj;
    });
}

function coerceRow(
  row: Record<string, unknown>,
  numericCols: string[],
  dateCols: Record<string, "date" | "timestamp">,
  allowedCols: string[],
) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = normalizeHeader(key);
    const col = HEADER_ALIASES[normalized] ?? normalized;
    if (!allowedCols.includes(col)) continue; // coluna que não existe na tabela — ignora, não trava a carga
    if (value === "" || value === undefined || value === null) {
      out[col] = null;
    } else if (dateCols[col]) {
      out[col] = excelValueToIso(value, dateCols[col]);
    } else if (numericCols.includes(col)) {
      const n = Number(String(value).replace(/\./g, "").replace(",", "."));
      out[col] = Number.isNaN(n) ? Number(value) : n;
    } else {
      out[col] = value;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 1. Confirma que quem chamou é um usuário logado e com role = admin.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ ok: false, error: "não autenticado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ ok: false, error: "sessão inválida" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profile?.role !== "admin") {
    return new Response(JSON.stringify({ ok: false, error: "restrito a administradores" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Faz o parse da planilha e grava.
  const { data: logRow } = await supabase.from("sync_log").insert({ status: "running" }).select("id").single();

  try {
    const body = await req.json();
    const table = body.table as string;
    const fileName = (body.fileName as string) ?? "arquivo";
    const contentBase64 = body.contentBase64 as string;
    const sheetName = body.sheetName as string | undefined;

    if (!ALLOWED_TABLES.has(table)) throw new Error(`Tabela não permitida: ${table}`);
    if (!contentBase64) throw new Error("Nenhum arquivo enviado.");

    const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
    const workbook = XLSX.read(bytes, { type: "array" });
    const targetSheet = sheetName && workbook.SheetNames.includes(sheetName) ? sheetName : workbook.SheetNames[0];
    const sheet = workbook.Sheets[targetSheet];
    const rawRows: Record<string, unknown>[] = sheetToRows(sheet);

    if (rawRows.length === 0) throw new Error(`"${fileName}" (aba "${targetSheet}") está vazia.`);

    const numericCols = NUMERIC_COLUMNS[table] ?? [];
    const dateCols = DATE_COLUMNS[table] ?? {};
    const allowedCols = ALLOWED_COLUMNS[table] ?? [];
    const rows = rawRows.map((r) => coerceRow(r, numericCols, dateCols, allowedCols));

    // Se nenhuma coluna da planilha bateu com a tabela, é sinal de aba/arquivo
    // errado — melhor avisar claro do que gravar centenas de linhas vazias.
    if (rows.every((r) => Object.keys(r).length === 0)) {
      throw new Error(
        `Nenhuma coluna de "${fileName}" [${targetSheet}] bate com a tabela "${table}". ` +
        `Cabeçalhos recebidos: ${Object.keys(rawRows[0]).join(", ")}`
      );
    }

    const conflictCols = CONFLICT_COLUMNS[table];
    const dedupedRows = dedupeRows(rows, DEDUPE_KEY[table]);

    let gravadas = 0;
    for (let i = 0; i < dedupedRows.length; i += 500) {
      const chunk = dedupedRows.slice(i, i + 500);
      const { error } = conflictCols
        ? await supabase.from(table).upsert(chunk, { onConflict: conflictCols })
        : await supabase.from(table).upsert(chunk);
      if (error) throw new Error(`Erro gravando em ${table}: ${error.message}`);
      gravadas += chunk.length;
    }

    await supabase
      .from("sync_log")
      .update({
        status: "ok",
        finished_at: new Date().toISOString(),
        linhas_gravadas: gravadas,
        detalhe: `${fileName} [${targetSheet}] -> ${table} (por ${userData.user.email})`,
      })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: true, table, sheet: targetSheet, linhas: gravadas }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    await supabase
      .from("sync_log")
      .update({ status: "error", finished_at: new Date().toISOString(), detalhe: String(err) })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
