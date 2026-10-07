-- Banco da fábrica (hub/banco.py e hub/extracoes.py): o que foi extraído vira
-- raw.banco__*. Enquanto uma extração não rodou nenhuma vez, a tabela dela
-- fica vazia (com estas colunas) e as regras abaixo dão "sem dados", sem erro.
create table if not exists raw.banco__apontamentos (
  id_apontamento varchar, num_ordem varchar, cod_recurso varchar, cod_apont varchar, cod_apont_2 varchar, cod_desc varchar,
  dt_producao timestamp, hora_inicio timestamp, hora_fim timestamp, qtd_horas double, qtd_produzida double,
  turno varchar, tipo_produto varchar, des_num_ordem varchar, descricao varchar, cod_est varchar, cod_estrutura varchar,
  processo varchar, classificacao varchar, cod_ativ varchar, desperdicio_acerto double, desperdicio_virando double,
  usr_peso_bruto_bobina double, usr_bobina varchar, usr_grupofiltro varchar, usr_kgdaperda double,
  usr_tipodaperda varchar, dt_inclusao timestamp, dt_alteracao timestamp);
create table if not exists raw.banco__estrutura_largura (cod_estrutura varchar, pfmt_pag_l double);
create table if not exists raw.banco__maquina_agora (
  maquina varchar, num_ordem varchar, descricao varchar, cliente varchar, processo varchar, atividade double,
  dt_hora_inicio timestamp, dt_hora_inicio_acerto timestamp, dt_hora_inicio_producao timestamp, bons double,
  qtd_planejado double, vmprogramada double, termino_previsto timestamp, termino_programado timestamp);
create table if not exists raw.banco__programacao (
  idwo double, num_ordem varchar, nome_cliente varchar, titulo varchar, cod_ativ varchar, processo varchar,
  status_op varchar, maquina varchar, dt_ini_plan varchar, dt_fim_plan varchar, dt_entrega timestamp,
  qtd_planejada double, qtd_produzida double, saldo double, producao_hora double);
create table if not exists raw.banco__wip (
  op varchar, id varchar, op_hora_inicio timestamp, cod_ativ varchar, local_estoque varchar, op_cliente varchar,
  op_qtd_planejado double, op_qtd_produzido_ativ double, qtd_metro_linear double, qtd_kg double,
  status_wip varchar, status_op varchar);
create table if not exists raw.banco__carteira (
  num_pedido varchar, cod_cliente double, nome varchar, situacao double, status varchar, data_do_pedido timestamp,
  data_desejada_cliente timestamp, data_pcp timestamp, data_negociada timestamp, cod_item_estoque varchar,
  descricao varchar, unidade varchar, quantidade double, quantidade_faturada double, total_kg double,
  tipo_produto varchar, segmento varchar);
create table if not exists raw.banco__gramatura_produto (cod_item varchar, gramatura_total double);
create table if not exists raw.banco__faturamento (
  data_emissao timestamp, nota_fiscal double, razao_social varchar, sku varchar, quantidade double, un varchar,
  m2 double, gramatura_total double, tipo_de_produto varchar, segmento varchar, pedido varchar, num_ordem varchar);
create table if not exists raw.banco__entregas (
  cliente varchar, num_pedido varchar, num_nota double, tipo_produto varchar, codigo varchar, descricao varchar,
  dt_pedido timestamp, dt_cliente timestamp, faturado timestamp, data_pcp timestamp, lead_time double, dif double,
  status_desempenho varchar);
create table if not exists raw.banco__setup (
  recurso_ctr varchar, num_ordem varchar, atividade varchar, tipo_produto varchar, dt_saida_maquina timestamp,
  min_set_prog double, mini_set_real double, qtd_produzido double, qtd_planejado double, meta_mts_hora double,
  qtd_hor_p double);
create table if not exists raw.banco__laudos (
  num_laudo double, status_laudo varchar, nome_cliente varchar, num_op varchar, dt_laudo timestamp, analises double);
