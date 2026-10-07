-- Cadastro oficial: código de apontamento -> classe de horas.
-- É a tabela-padrão Classificação_Apontamentos (08 - Tabelas Padrões),
-- congelada em config/classificacao_apontamentos.csv em 05/10/2026: o hub não
-- lê mais planilha pra isso. O ERP tem o próprio cadastro (CodigosApontamento),
-- mas ele não separa INATIVIDADE nem FIM TURNO, que a regra do TMR do BI
-- tira das horas totais. Código novo sem classe vira aviso (checagem 010) e
-- entra como SEM CLASSIFICACAO, como antes.
--   classe       PRODUZINDO | SETUP | INICIALIZACAO | IMPRODUTIVO | INATIVIDADE | FIM TURNO (sem acento)
--   classe_tmr   a mesma, com a grafia da tabela-padrão (é a que vai nas horas do Machine Card)
--   classe_disp  PRODUZINDO | IMPRODUTIVO | PLANEJADO
create or replace table clean.classificacao as
select cod,
       descricao,
       upper(strip_accents(trim(classe_disponibilidade)))  as classe_disp,
       upper(strip_accents(trim(classe)))                  as classe,
       upper(trim(classe))                                 as classe_tmr
from cfg.classificacao
where cod is not null;
