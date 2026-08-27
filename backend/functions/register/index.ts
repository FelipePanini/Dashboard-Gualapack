// Supabase Edge Function: register
//
// Único ponto de entrada para criar uma conta nova no Painel de Produção.
// Roda no servidor (Deno), nunca no navegador — por isso pode usar a
// SERVICE_ROLE_KEY com segurança. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY
// são injetadas automaticamente pelo runtime do Supabase em toda Edge
// Function — não é preciso configurar nenhum secret manualmente.
//
// Fluxo:
//   1. Recebe { email, password, fullName, inviteKey }
//   2. Valida formato básico dos campos
//   3. Chama a função Postgres validate_and_consume_invite(inviteKey)
//      usando o client "admin" (service role) — essa função só pode ser
//      chamada com esse privilégio (revoke em schema.sql).
//   4. Se a chave for válida, cria o usuário via Admin API e grava o
//      perfil (role vem da própria chave de convite, o cliente NUNCA
//      escolhe seu próprio role).
//   5. Se a chave for inválida/expirada/esgotada, rejeita ANTES de criar
//      qualquer usuário.
//
// Deploy: pelo Dashboard (Edge Functions > Deploy a new function, cole este
// arquivo) ou via CLI: supabase functions deploy register --no-verify-jwt
// Em ambos os casos, desligue "Enforce JWT Verification" para esta função —
// quem chama ainda não tem sessão, é o próprio cadastro. A proteção real
// está na chave de convite, não em um JWT.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const JSON_HEADERS = { "Content-Type": "application/json" };

// Rate limiting simples em memória (por instância) — mitiga tentativas de
// força bruta contra a chave de convite. Para múltiplas instâncias/escala
// maior, trocar por um contador no Postgres ou no Upstash/Redis.
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000; // 10 minutos
const MAX_ATTEMPTS = 8;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: "too_many_attempts", message: "Muitas tentativas. Tente novamente em alguns minutos." }),
      { status: 429, headers: JSON_HEADERS },
    );
  }

  let body: { email?: string; password?: string; fullName?: string; inviteKey?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: JSON_HEADERS });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const fullName = (body.fullName ?? "").trim();
  const inviteKey = (body.inviteKey ?? "").trim();

  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: "invalid_email" }), { status: 400, headers: JSON_HEADERS });
  }
  if (password.length < 12) {
    return new Response(
      JSON.stringify({ error: "weak_password", message: "A senha precisa ter pelo menos 12 caracteres." }),
      { status: 400, headers: JSON_HEADERS },
    );
  }
  if (fullName.length < 2) {
    return new Response(JSON.stringify({ error: "invalid_name" }), { status: 400, headers: JSON_HEADERS });
  }
  if (!inviteKey) {
    return new Response(JSON.stringify({ error: "missing_invite_key" }), { status: 400, headers: JSON_HEADERS });
  }

  // Só cria usuário se a chave passar aqui. Nenhum efeito colateral antes disso.
  const { data: inviteResult, error: inviteError } = await admin
    .rpc("validate_and_consume_invite", { plain_key: inviteKey })
    .single();

  if (inviteError || !inviteResult?.valid) {
    return new Response(
      JSON.stringify({ error: "invalid_invite_key", message: "Chave de convite inválida, expirada ou já utilizada." }),
      { status: 403, headers: JSON_HEADERS },
    );
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // painel interno: sem etapa extra de confirmação por e-mail
    user_metadata: { full_name: fullName },
  });

  if (createError || !created?.user) {
    const alreadyExists = createError?.message?.toLowerCase().includes("already registered");
    return new Response(
      JSON.stringify({
        error: alreadyExists ? "email_already_registered" : "signup_failed",
        message: alreadyExists ? "Este e-mail já está cadastrado." : "Não foi possível concluir o cadastro.",
      }),
      { status: alreadyExists ? 409 : 500, headers: JSON_HEADERS },
    );
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    full_name: fullName,
    role: inviteResult.granted_role,
    area: "Produção",
  });

  if (profileError) {
    // Usuário já foi criado no Auth; não deixamos órfão sem perfil.
    await admin.auth.admin.deleteUser(created.user.id);
    return new Response(JSON.stringify({ error: "profile_creation_failed" }), { status: 500, headers: JSON_HEADERS });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
});
