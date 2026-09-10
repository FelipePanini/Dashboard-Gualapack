// ============================================================================
// validar-base-apontamento.js — validação ANTES de trocar a fonte do TMR
// ----------------------------------------------------------------------------
// O painel calcula TMR sobre a tabela "apontamentos", que hoje vem da aba
// "Base Máquina_Embalagem" (log completo, mas só das 5 rebobinadeiras) mais
// a "BASE_DETALHE" dos Base Aparas (só refugo, zero horas). Resultado: 11
// das 16 máquinas aparecem com TMR 0%.
//
// A aba "Base Apontamento" do mesmo arquivo tem 379.792 linhas e 25 colunas
// (3 a mais, incluindo CLASSIFICAÇÃO DISP.). A hipótese é que ela seja a
// base completa. Este script confere isso ANTES de mexer na carga:
//   - período coberto
//   - máquinas presentes
//   - horas e eventos "produzindo" por máquina
//   - preenchimento das colunas de classificação
//   - quantas linhas sobram dentro da janela de retenção
//   - comparação lado a lado com a aba usada hoje
//
// Só leitura. Não grava em lugar nenhum. Temporário: apagar depois de decidir.
// ============================================================================

import * as XLSX from "xlsx";
import { driveClient, listFolderFiles, downloadFile, normalize, RETENTION_MONTHS } from "./lib.js";

const required = ["DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

const ABAS = ["Base Apontamento", "Base Máquina_Embalagem"];

function serialParaData(v) {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400 * 1000));
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function analisar(nomeArquivo, nomeAba, linhas, corte) {
  const cab = (linhas[0] ?? []).map((h) => normalize(h));
  const col = (nome) => cab.indexOf(nome);
  const iRec = col("cod_recurso"), iApont = col("cod_apont"), iHoras = col("qtd_horas");
  const iData = col("dt_producao"), iDisp = col("classificacao_disp"), iCH = col("classificacao_horas");

  const porMaquina = new Map();
  const apontamentos = new Map();
  const dispValores = new Map();
  let dentroJanela = 0, semData = 0, minData = null, maxData = null, dispVazio = 0, chVazio = 0;

  for (let i = 1; i < linhas.length; i++) {
    const r = linhas[i];
    if (!r || r.length === 0) continue;
    const rec = String(r[iRec] ?? "").trim();
    if (!rec) continue;

    const d = iData >= 0 ? serialParaData(r[iData]) : null;
    if (!d) semData++;
    else {
      if (!minData || d < minData) minData = d;
      if (!maxData || d > maxData) maxData = d;
      if (d >= corte) dentroJanela++;
    }

    const horas = Number(r[iHoras]) || 0;
    const apont = String(r[iApont] ?? "").trim();
    const m = porMaquina.get(rec) ?? { linhas: 0, horas: 0, produzindo: 0, horasProduzindo: 0 };
    m.linhas++; m.horas += horas;
    if (apont === "20" || apont === "20 ") { m.produzindo++; m.horasProduzindo += horas; }
    porMaquina.set(rec, m);

    apontamentos.set(apont, (apontamentos.get(apont) ?? 0) + 1);

    if (iDisp >= 0) {
      const v = String(r[iDisp] ?? "").trim();
      if (!v) dispVazio++; else dispValores.set(v, (dispValores.get(v) ?? 0) + 1);
    }
    if (iCH >= 0 && !String(r[iCH] ?? "").trim()) chVazio++;
  }

  const total = linhas.length - 1;
  console.log(`\n${"─".repeat(74)}`);
  console.log(`ABA "${nomeAba}"  (${nomeArquivo})`);
  console.log(`  colunas: ${cab.filter(Boolean).length} | linhas: ${total}`);
  console.log(`  período: ${minData ? minData.toISOString().slice(0,10) : "?"} → ${maxData ? maxData.toISOString().slice(0,10) : "?"}`);
  console.log(`  dentro da janela de ${RETENTION_MONTHS} meses: ${dentroJanela} | sem data: ${semData}`);
  console.log(`  tem CLASSIFICAÇÃO DISP.? ${iDisp >= 0 ? `sim (${dispVazio} vazias de ${total})` : "não"}`);
  console.log(`  tem CLASSIFICAÇÃO HORAS? ${iCH >= 0 ? `sim (${chVazio} vazias de ${total})` : "não"}`);
  if (dispValores.size) {
    console.log(`  valores de CLASSIFICAÇÃO DISP.:`);
    [...dispValores].sort((a,b)=>b[1]-a[1]).forEach(([v,n]) => console.log(`      ${String(v).padEnd(22)} ${n}`));
  }

  console.log(`\n  ${"máquina".padEnd(14)} ${"linhas".padStart(8)} ${"horas".padStart(9)} ${"ev.prod".padStart(8)} ${"h.prod".padStart(9)} ${"TMR".padStart(7)}`);
  [...porMaquina].sort((a,b)=>b[1].linhas-a[1].linhas).forEach(([rec,m]) => {
    const tmr = m.horas > 0 ? (m.horasProduzindo / m.horas * 100).toFixed(1) + "%" : "sem dado";
    console.log(`  ${rec.padEnd(14)} ${String(m.linhas).padStart(8)} ${m.horas.toFixed(0).padStart(9)} ${String(m.produzindo).padStart(8)} ${m.horasProduzindo.toFixed(0).padStart(9)} ${tmr.padStart(7)}`);
  });

  console.log(`\n  top 8 códigos de apontamento:`);
  [...apontamentos].sort((a,b)=>b[1]-a[1]).slice(0,8)
    .forEach(([c,n]) => console.log(`      ${String(c || "(vazio)").padEnd(8)} ${n}`));

  return { maquinas: porMaquina.size, linhas: total, dentroJanela };
}

async function main() {
  const drive = driveClient();
  const files = await listFolderFiles(drive);
  const alvos = files.filter((f) => normalize(f.name).includes("indicadores"));
  console.log(`${alvos.length} arquivo(s) "Indicadores Diário" encontrados.`);

  const corte = new Date();
  corte.setMonth(corte.getMonth() - RETENTION_MONTHS);
  console.log(`Janela de retenção: a partir de ${corte.toISOString().slice(0,10)}\n`);

  const resumo = [];
  for (const file of alvos) {
    console.log(`\n${"=".repeat(74)}\n## ${file.name}`);
    const t0 = Date.now();
    const bytes = await downloadFile(drive, file);
    console.log(`   baixado: ${(bytes.length/1024/1024).toFixed(1)} MB em ${Date.now()-t0}ms`);

    // UMA leitura por arquivo com as duas abas: cada XLSX.read descompacta
    // o zip inteiro, e ler aba por aba num arquivo de 87 MB significa
    // descompactar 87 MB duas vezes.
    const t1 = Date.now();
    const wb = XLSX.read(bytes, { type: "array", sheets: ABAS });
    console.log(`   parse das ${ABAS.length} abas: ${Date.now()-t1}ms`);

    for (const aba of ABAS) {
      try {
        const sheet = wb.Sheets[aba];
        if (!sheet) { console.log(`\n   [aba "${aba}" não existe neste arquivo]`); continue; }
        const t2 = Date.now();
        // header:1 devolve array de arrays — bem mais leve que objetos com
        // as 25 chaves repetidas em 380 mil linhas.
        const linhas = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
        console.log(`   [${aba}] ${linhas.length} linhas convertidas em ${Date.now()-t2}ms`);
        const r = analisar(file.name, aba, linhas, corte);
        resumo.push({ arquivo: file.name, aba, ...r });
      } catch (err) {
        console.log(`\n   [ERRO na aba "${aba}"]: ${err.message}`);
      }
    }
  }

  console.log(`\n\n${"=".repeat(74)}\nRESUMO`);
  resumo.forEach((r) => console.log(`  ${r.aba.padEnd(26)} ${r.arquivo.padEnd(30)} ${String(r.linhas).padStart(8)} linhas | ${String(r.maquinas).padStart(3)} máquinas | ${String(r.dentroJanela).padStart(7)} na janela`));
}

main().catch((err) => { console.error("Validação falhou:", err); process.exit(1); });
