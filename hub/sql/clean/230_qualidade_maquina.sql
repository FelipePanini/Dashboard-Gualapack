-- Qualidade (aparas) de cada máquina, para o OEE dos cartões (decisão do dono em
-- 08/10/2026: OEE = qualidade × performance × disponibilidade).
--
-- Apara da máquina = refugo apontado nela ÷ (esse refugo + peso final das OPs que
-- passaram por ela). O peso final é o peso bruto da OP nas rebobinadeiras: só
-- entram OPs que já foram pesadas lá. Somadas, as aparas das máquinas dão a apara
-- apontada da fábrica.
--
-- Cada par máquina × OP entra uma vez só, no último dia em que a máquina produziu
-- a OP, com todo o refugo dela nessa OP: a soma de um período não conta a mesma OP
-- duas vezes.
-- Conferido em 08/10/2026, set/2026: qualidade de 90,7% (REB 01) a 99,6% (L03).
create or replace table clean.qualidade_maquina_dia as
with peso as (
  select trim(num_ordem) as num_ordem, sum(peso_bruto) as peso
  from clean.base_prod
  where maquina_real in ('REB 01', 'REB 04', 'REB 05', 'REB 09', 'REB 10')
  group by 1
  having sum(peso_bruto) > 0
), passou as (
  select upper(trim(maquina)) as maquina, trim(num_ordem) as num_ordem, max(dia) as dia
  from clean.machine_card
  where classe = 'PRODUZINDO' and nullif(trim(num_ordem), '') is not null
  group by 1, 2
), refugo as (
  select upper(trim(maquina_real)) as maquina, trim(num_ordem) as num_ordem, sum(refugo) as kg
  from clean.base_prod
  where refugo > 0
  group by 1, 2
)
select p.dia, p.maquina,
       sum(coalesce(r.kg, 0))  as refugo_kg,
       sum(w.peso)             as peso_ops_kg,
       count(*)                as ops
from passou p
join peso w using (num_ordem)
left join refugo r on r.maquina = p.maquina and r.num_ordem = p.num_ordem
group by 1, 2;
