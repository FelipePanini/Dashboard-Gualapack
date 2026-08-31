// ============================================================================
// sync-daily — carga diária dos dados reais de produção
// ----------------------------------------------------------------------------
// Roda 1x por dia (agendada via pg_cron, ver backend/README-sync.md), sempre
// no servidor — nunca é chamada pelo navegador. Faz três coisas:
//
//   1. Lê os arquivos CSV mais recentes de uma pasta do Google Drive (os
//      exports diários dos BIs + as planilhas manuais, tudo na mesma pasta
//      combinada que a produção mantém).
//   2. Faz o parse de cada CSV esperado (um por tabela).
//   3. Upsert nas tabelas de backend/schema_data.sql, usando a service_role
//      key (grava mesmo com RLS ativo, porque service_role ignora RLS).
//
// Cada arquivo CSV precisa ter cabeçalho com os nomes de coluna abaixo — é o
// "contrato" entre a pasta na nuvem e este código. Ajuste os nomes de coluna
// aqui se o export real vier com nomes diferentes (mais fácil mudar aqui do
// que pedir pra mudar o export).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_DRIVE_FOLDER_ID = Deno.env.get("SYNC_DRIVE_FOLDER_ID") ?? "";
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get("SYNC_GOOGLE_SERVICE_ACCOUNT") ?? "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Nome do arquivo esperado na pasta -> tabela de destino.
// Cada um é o export diário (CSV) de uma base: BI ou planilha manual.
const FILE_MAP: Record<string, string> = {
  "maquinas_diario.csv": "maquinas_diario",
  "perdas_diario.csv": "perdas_diario",
  "ops_diario.csv": "ops_diario",
  "wip_diario.csv": "wip_diario",
  "carteira_diario.csv": "carteira_diario",
  "apontamentos.csv": "apontamentos",
};

async function getGoogleAccessToken(): Promise<string> {
  const sa = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const toSign = `${enc(header)}.${enc(claim)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBinary(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign));
  const jwt = `${toSign}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`Falha ao autenticar no Google: ${JSON.stringify(json)}`);
  return json.access_token;
}

function pemToBinary(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function listDriveFiles(token: string): Promise<Record<string, string>> {
  const url = `https://www.googleapis.com/drive/v3/files?q='${GOOGLE_DRIVE_FOLDER_ID}'+in+parents&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  const map: Record<string, string> = {};
  for (const f of json.files ?? []) map[f.name] = f.id;
  return map;
}

async function downloadDriveFile(token: string, fileId: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return await res.text();
}

// Parser de CSV simples (sem dependências) — assume vírgula, sem campos com
// vírgula/aspas escapadas dentro (os exports de origem não têm texto livre
// complexo). Se algum export vier mais "sujo", trocar por uma lib de CSV.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

Deno.serve(async (_req) => {
  const { data: logRow } = await supabase
    .from("sync_log")
    .insert({ status: "running" })
    .select("id")
    .single();

  try {
    if (!GOOGLE_DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_JSON) {
      throw new Error(
        "SYNC_DRIVE_FOLDER_ID / SYNC_GOOGLE_SERVICE_ACCOUNT não configurados nos secrets da função."
      );
    }

    const token = await getGoogleAccessToken();
    const files = await listDriveFiles(token);

    let totalLinhas = 0;
    for (const [fileName, table] of Object.entries(FILE_MAP)) {
      const fileId = files[fileName];
      if (!fileId) continue; // arquivo ainda não chegou nessa pasta hoje — ok, tenta de novo amanhã

      const csvText = await downloadDriveFile(token, fileId);
      const rows = parseCsv(csvText);
      if (rows.length === 0) continue;

      // upsert em lotes de 500 pra não estourar o payload
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await supabase.from(table).upsert(chunk);
        if (error) throw new Error(`Erro gravando em ${table}: ${error.message}`);
      }
      totalLinhas += rows.length;
    }

    await supabase
      .from("sync_log")
      .update({ status: "ok", finished_at: new Date().toISOString(), linhas_gravadas: totalLinhas })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: true, linhas: totalLinhas }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    await supabase
      .from("sync_log")
      .update({ status: "error", finished_at: new Date().toISOString(), detalhe: String(err) })
      .eq("id", logRow?.id);

    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
