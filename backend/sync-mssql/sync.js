// ============================================================================
// sync.js — carga direta do SQL Server (Metrics) no Supabase.
// ----------------------------------------------------------------------------
// Roda SÓ no runner self-hosted, dentro da rede/VPN da Gualapack — o
// GitHub Actions normal (nuvem) não alcança sbrjag-db.br.gpk.gpk-grp.local.
// Ver backend/README-mssql-sync.md pro setup.
//
// Cobre só as 2 tabelas que não têm nenhum outro escritor hoje
// (producao_metros, programacao_futura) — de propósito. apontamentos e
// producao_kg já são gravadas pelo sync-drive.js a partir das planilhas;
// ligar as duas fontes na mesma tabela ao mesmo tempo reproduziria o
// mesmo tipo de bug de duplicação/mistura de fonte já corrigido antes
// (ver commit "fix(sync): limpa linhas órfãs..."). Migrar essas duas pro
// SQL Server é um passo separado, deliberado, que exige comparar os
// números das duas fontes antes de desligar a planilha.
//
// Troca-por-JANELA-DE-DATA em vez de troca-por-arquivo (não existe
// "arquivo" aqui): producao_metros apaga a janela de retenção e regrava;
// programacao_futura é uma foto do planejado a partir de agora, então
// apaga tudo e regrava inteira a cada rodada.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { connect, queryProducaoMetros, queryProgramacaoFutura, RETENTION_MONTHS } from "./lib.js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MSSQL_DOMAIN", "MSSQL_USER", "MSSQL_PASSWORD"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function logStart() {
  const { data, error } = await supabase.from("sync_log").insert({ status: "running" }).select("id").single();
  if (error) throw new Error(`Não consegui abrir o log de carga: ${error.message}`);
  return data.id;
}
async function logFinish(id, status, detalhe, linhas) {
  await supabase.from("sync_log").update({ status, finished_at: new Date().toISOString(), detalhe, linhas_gravadas: linhas }).eq("id", id);
}

async function gravar(table, rows) {
  let gravadas = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`Erro gravando em ${table}: ${error.message}`);
    gravadas += chunk.length;
  }
  return gravadas;
}

async function main() {
  const logId = await logStart();
  let totalLinhas = 0;
  const resumo = [];

  let pool;
  try {
    console.log("Conectando no SQL Server (sbrjag-db.br.gpk.gpk-grp.local)...");
    pool = await connect();
    console.log("Conectado.");

    // --- producao_metros: troca a janela de retenção ---
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
    const metros = await queryProducaoMetros(pool);
    console.log(`[consulta] producao_metros: ${metros.length} linhas`);
    const { error: delErrM } = await supabase.from("producao_metros").delete().gte("dt_producao", cutoff.toISOString().slice(0, 10));
    if (delErrM) throw new Error(`Erro limpando producao_metros: ${delErrM.message}`);
    const gravadasM = await gravar("producao_metros", metros);
    console.log(`[ok] producao_metros: ${gravadasM} linhas`);
    resumo.push(`producao_metros: ${gravadasM}`);
    totalLinhas += gravadasM;

    // --- programacao_futura: foto inteira, sem janela de retenção ---
    const prog = await queryProgramacaoFutura(pool);
    console.log(`[consulta] programacao_futura: ${prog.length} linhas`);
    const { error: delErrP } = await supabase.from("programacao_futura").delete().gte("id", 0);
    if (delErrP) throw new Error(`Erro limpando programacao_futura: ${delErrP.message}`);
    const gravadasP = await gravar("programacao_futura", prog);
    console.log(`[ok] programacao_futura: ${gravadasP} linhas`);
    resumo.push(`programacao_futura: ${gravadasP}`);
    totalLinhas += gravadasP;

    await logFinish(logId, "ok", resumo.join(" | "), totalLinhas);
    console.log(`Carga concluída: ${totalLinhas} linhas no total.`);
  } catch (err) {
    console.error("Carga falhou:", err);
    await logFinish(logId, "error", String(err?.message ?? err), totalLinhas);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.close();
  }
}

main();
