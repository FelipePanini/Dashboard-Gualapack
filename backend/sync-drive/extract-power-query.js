// ============================================================================
// extract-power-query.js — lê a definição da consulta Power Query (Fonte,
// filtros, junções) direto de dentro do .xlsx, sem precisar abrir no Excel.
// ----------------------------------------------------------------------------
// Um .xlsx é um zip. Quando a aba usa "Dados > Consultas e Conexões", o
// código M por trás do editor visual (a mesma coisa que aparece em "Etapas
// Aplicadas") fica guardado numa parte interna chamada "DataMashup" — um
// blob binário: 4 bytes de versão + 4 bytes de tamanho (little-endian) +
// um MINI-ZIP dentro do zip, com o arquivo "Formulas/Section1.m" contendo
// o código M em texto puro. É esse texto que mostra Sql.Database(...) e
// cada passo seguinte.
//
// Só leitura. Não grava em lugar nenhum, não altera nenhum arquivo do
// Drive. Temporário: apagar depois de mapear as origens (ver conversa com
// o usuário em 2026-09-11 sobre eliminar o upload manual de planilha).
// ============================================================================

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { driveClient, listFolderFiles, downloadFile, normalize } from "./lib.js";

const required = ["DRIVE_FOLDER_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Faltando variável de ambiente: ${key}`);
    process.exit(1);
  }
}

// Arquivos que o usuário pediu pra mapear, na ordem pedida.
const ALVOS = [
  "Aderência Semanal.xlsx",
  "Base Aparas - Genérico.xlsx",
];

function unzipEntry(zipPath, entryName) {
  // unzip trata [ ] ? * como wildcard na seleção de membro, mesmo passando
  // o argumento direto (sem shell) — "[Content_Types].xml" precisa escapar
  // os colchetes ou "caution: filename not matched" e sai sem erro real.
  const escapado = entryName.replace(/([[\]?*])/g, "\\$1");
  try {
    return execFileSync("unzip", ["-p", zipPath, escapado], { maxBuffer: 1024 * 1024 * 64 });
  } catch {
    return null;
  }
}

function listEntries(zipPath) {
  try {
    const out = execFileSync("unzip", ["-Z1", zipPath], { maxBuffer: 1024 * 1024 * 8 }).toString("utf8");
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// Acha a parte do DataMashup: primeiro pelo Content_Types (correto,
// independe de como o Excel nomeou o arquivo), com fallback pros nomes
// que versões mais antigas do Excel costumam usar.
// O Excel grava alguns customXml/itemN.xml em UTF-16LE com BOM (FF FE) —
// decodificar como UTF-8 dá "mojibake" (cada caractere ASCII intercalado
// com um byte nulo) e nenhuma comparação de texto bate. Detecta o BOM e
// usa a codificação certa; sem BOM, assume UTF-8 (o padrão OPC comum).
function textoDoXml(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString("utf16le", 2);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.toString("utf8", 3);
  return bytes.toString("utf8");
}

function findMashupPartName(zipPath) {
  const ct = unzipEntry(zipPath, "[Content_Types].xml");
  if (ct) {
    const m = /<Override PartName="([^"]+)" ContentType="[^"]*dataMashup[^"]*"/i.exec(textoDoXml(ct));
    if (m) return m[1].replace(/^\//, "");
  }
  // Fallback: pode haver VÁRIOS customXml/itemN.xml (propriedades do
  // documento, metadados do Excel etc.) — em vez de pegar o primeiro que
  // bater no nome, abre cada um e confirma que o CONTEÚDO é mesmo um
  // DataMashup.
  const entries = listEntries(zipPath);
  const candidatos = entries.filter((e) => /customXml\/item\d+\.xml$/i.test(e));
  for (const c of candidatos) {
    const bytes = unzipEntry(zipPath, c);
    if (bytes && /DataMashup/i.test(textoDoXml(bytes).slice(0, 2000))) return c;
  }
  return candidatos[0] ?? null;
}

function parseMashup(bytes) {
  // Duas formas conhecidas: (a) o próprio part já é o binário do
  // DataMashup; (b) o part é um XML tipo <DataMashup>BASE64</DataMashup>
  // (customXml — o caso de todo arquivo real conferido em 2026-09-11,
  // sempre em UTF-16LE com BOM).
  let bin = bytes;
  const full = textoDoXml(bytes);
  if (full.slice(0, 200).includes("<DataMashup") || full.startsWith("<?xml") || full.startsWith("﻿<?xml")) {
    const m = /<DataMashup[^>]*>([\s\S]+?)<\/DataMashup>/.exec(full);
    if (!m) return { erro: `tag <DataMashup> não encontrada no XML (${full.length} chars, começa com: ${full.slice(0, 120)})` };
    bin = Buffer.from(m[1].replace(/\s+/g, ""), "base64");
  }
  if (bin.length < 8) return { erro: `binário curto demais (${bin.length} bytes)` };
  const version = bin.readUInt32LE(0);
  const pkgLen = bin.readUInt32LE(4);
  const pkgBytes = bin.subarray(8, 8 + pkgLen);
  if (pkgBytes.length < 4 || pkgBytes[0] !== 0x50 || pkgBytes[1] !== 0x4b) {
    return {
      erro: `pacote não começa com assinatura PK — version=${version} pkgLen=${pkgLen} binLen=${bin.length} ` +
        `primeiros 24 bytes=${bin.subarray(0, 24).toString("hex")}`,
    };
  }
  return { pkgBytes };
}

async function main() {
  const drive = driveClient();
  const files = await listFolderFiles(drive);
  const tmp = mkdtempSync(path.join(tmpdir(), "pq-"));

  for (const nomeAlvo of ALVOS) {
    const file = files.find((f) => normalize(f.name) === normalize(nomeAlvo));
    console.log(`\n${"=".repeat(78)}\n## ${nomeAlvo}`);
    if (!file) {
      console.log("  [não encontrado na pasta do Drive]");
      continue;
    }

    const t0 = Date.now();
    const bytes = await downloadFile(drive, file);
    console.log(`  baixado: ${(bytes.length / 1024 / 1024).toFixed(1)} MB em ${Date.now() - t0}ms`);

    const xlsxPath = path.join(tmp, "arquivo.xlsx");
    writeFileSync(xlsxPath, bytes);

    // Conexões "clássicas" (OLEDB/ODBC) às vezes trazem servidor/base em
    // texto puro mesmo sem Power Query — vale sempre conferir.
    const connections = unzipEntry(xlsxPath, "xl/connections.xml");
    if (connections) {
      console.log("\n  --- xl/connections.xml (conexões registradas) ---");
      console.log("  " + connections.toString("utf8").replace(/></g, ">\n  <").slice(0, 4000));
    } else {
      console.log("\n  [sem xl/connections.xml — planilha sem conexão externa registrada, ou já é cópia estática]");
    }

    const mashupPart = findMashupPartName(xlsxPath);
    if (!mashupPart) {
      console.log("  [sem parte DataMashup — não usa Power Query, ou o Excel guardou de um jeito não previsto aqui]");
      continue;
    }
    console.log(`  parte do DataMashup: "${mashupPart}"`);

    const mashupBytes = unzipEntry(xlsxPath, mashupPart);
    if (!mashupBytes) {
      console.log("  [não consegui ler a parte do DataMashup]");
      continue;
    }

    const resultado = parseMashup(mashupBytes);
    if (resultado.erro) {
      console.log(`  [DataMashup em formato inesperado: ${resultado.erro}]`);
      continue;
    }

    const pkgPath = path.join(tmp, "mashup.zip");
    writeFileSync(pkgPath, resultado.pkgBytes);
    const entradas = listEntries(pkgPath);
    const formulaEntry = entradas.find((e) => /Formulas\/Section\d+\.m$/i.test(e)) ?? "Formulas/Section1.m";
    const secaoM = unzipEntry(pkgPath, formulaEntry);
    if (!secaoM) {
      console.log(`  [não achei "${formulaEntry}" dentro do pacote — entradas encontradas: ${entradas.join(", ")}]`);
      continue;
    }

    console.log(`\n  --- código M (${formulaEntry}) ---`);
    console.log(secaoM.toString("utf8"));
  }
}

main().catch((err) => {
  console.error("Extração falhou:", err);
  process.exit(1);
});
