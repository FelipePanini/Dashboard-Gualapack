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
  url: "https://iwocigbdywkypvagrrjk.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3b2NpZ2JkeXdreXB2YWdycmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MjQ1NzAsImV4cCI6MjEwMzQwMDU3MH0.J3s2IdmRR2LHA1YCxTOJRLX30Q-D8SvbHJMFGFyNazw",
  registerFunctionUrl: "https://iwocigbdywkypvagrrjk.supabase.co/functions/v1/register",
};
