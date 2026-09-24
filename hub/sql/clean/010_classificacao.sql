-- Cadastro oficial: código de apontamento -> classe de horas (aba ClassificaçãoOficial).
-- Código com um dígito ganha zero à esquerda pra casar com o apontamento ('4' -> '04').
create or replace table clean.classificacao as
select case when length(trim(cast(cod as varchar))) = 1
            then '0' || trim(cast(cod as varchar))
            else trim(cast(cod as varchar)) end                         as cod,
       trim(cast(descricao as varchar))                                 as descricao,
       upper(strip_accents(trim(cast(classificacao_disp as varchar))))  as classe_disp,  -- PRODUZINDO | IMPRODUTIVO | PLANEJADO
       upper(strip_accents(trim(cast(classificacao as varchar))))       as classe        -- SETUP | INICIALIZACAO | IMPRODUTIVO | INATIVIDADE | FIM TURNO | PRODUZINDO
from raw.indicadores__classificacao
where cod is not null;
