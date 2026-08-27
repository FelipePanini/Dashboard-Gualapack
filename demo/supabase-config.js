// Configuração pública do Supabase para o front-end.
//
// IMPORTANTE: a "anon key" abaixo é feita para ser pública — ela só permite
// o que as regras de Row Level Security (RLS) do banco autorizarem (veja
// backend/schema.sql). NUNCA coloque aqui a "service_role key": essa sim é
// secreta e só pode viver do lado do servidor (Edge Function).
//
// Preencha os dois valores depois de criar o projeto no Supabase:
// Project Settings > API > Project URL / anon public key.
window.SUPABASE_CONFIG = {
  url: "https://SEU-PROJETO.supabase.co",
  anonKey: "SUA_ANON_KEY_PUBLICA_AQUI",
  registerFunctionUrl: "https://SEU-PROJETO.functions.supabase.co/register",
};
