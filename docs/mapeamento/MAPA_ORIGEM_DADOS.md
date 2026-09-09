# Mapa de origem dos dados

Responde a pergunta "de onde veio esse número?" para cada indicador do painel,
e mostra o caminho completo de cada base até o Supabase.

## Fluxo atual

```
ARQUIVOS ORIGINAIS (Drive, 21 arquivos)
        │
        ├─ build-database-central.js  (GitHub Actions, manual)
        │      lê os originais, normaliza, escreve as abas DB_
        ▼
DATABASE_GUALAPACK.xlsx  (Drive, ~177 MB)
        │
        ├─ sync.js  (GitHub Actions, diário 06:00 UTC)
        │      lê SÓ este arquivo; decide INSERT / troca-por-arquivo / upsert
        ▼
SUPABASE  (9 tabelas + 10 views)
        │
        ▼
DASHBOARD  (GitHub Pages, lê só as views)
```

## Rastreabilidade dentro do arquivo central

Toda linha consolidada carrega quatro colunas de origem:

| Coluna | Conteúdo | Exemplo |
|---|---|---|
| `arquivo_origem` | Nome do arquivo no Drive | `Refugo Aparas.xlsx` |
| `aba_origem` | Nome da aba dentro dele | `Refugo - JGR` |
| `origem` | Rótulo lógico da base | `REFUGO_DIARIO_JGR` |
| `data_importacao` | Quando a consolidação rodou | `2026-09-09T16:41:08Z` |

As abas que vão para o Supabase carregam também `_source_file`, usado pela
carga para trocar as linhas de um arquivo sem duplicar (delete-then-insert
por arquivo de origem).

## Caminho de cada indicador do painel

| Indicador (painel) | View | Tabela | Aba de origem | Arquivo |
|---|---|---|---|---|
| Apara apontada % | `v_perda_por_classificacao` | `apontamentos` | Base Máquina_Embalagem | Indicadores Diário |
| Apara confirmada % | `v_fardos_mensal` | `fardos_aparas` | COMPLETOS | Sequenciamento (mensal) |
| TMR médio | `v_maquinas_resumo` | `apontamentos` | Base Máquina_Embalagem | Indicadores Diário |
| Aderência ao plano | `v_maquinas_resumo` | `aderencia_programacao` | — | ⚠️ **sem arquivo de origem** |
| Perda por motivo | `v_perda_por_motivo` | `apontamentos` | Base Máquina_Embalagem | Indicadores Diário |
| Perda por máquina | `v_maquinas_resumo` | `apontamentos` | Base Máquina_Embalagem | Indicadores Diário |
| Downtime por status | `v_downtime_por_status` | `apontamentos` | Base Máquina_Embalagem | Indicadores Diário |
| Refugo mensal (scrap) | `v_refugo_mensal` | `refugo_aparas_historico` | Conta Refugo | Refugo Aparas |
| Refugo por máquina | `v_refugo_producao_maquina` | `refugo_producao` | Consulta Perda | Refugo Produção |
| Produção mensal (kg) | `v_producao_kg_mensal` | `producao_kg` | Base Apontamentos (kg) | Indicadores Diário |
| Ordens com maior refugo | `v_ops_refugo` | `apontamentos` | Base Máquina_Embalagem | Indicadores Diário |
| Linha do tempo (Gantt) | `v_apontamentos_ultimo_dia` | `apontamentos` | Base Máquina_Embalagem | Indicadores Diário |
| Catálogo de máquinas | `v_maquinas_resumo` | `maquinas` | DIM_EQTOS & GRUPO EQTO | Machine Card |
| **Produtividade (m²/h)** | — | — | — | ⚠️ **não existe fonte ligada** |
| **Velocidade nominal** | — | — | — | ⚠️ **não existe fonte ligada** |

### Três pontos de atenção

1. **`aderencia_programacao` não tem arquivo de origem.** A definição espera um
   arquivo com "historico_aderencia" ou "aderencia_programacao" no nome, e
   **nenhum arquivo da pasta casa com isso**. A tabela está órfã: o indicador
   "Aderência ao Plano" no painel sai de dado que não é atualizado por ninguém.
   A fonte real provável é `Aderência Semanal.xlsx` → `ADERÊNCIA DIÁRIA`.

2. **Produtividade (m²/h) e velocidade estão vazias no painel** porque nenhuma
   base ligada tem metro quadrado nem meta de velocidade. As fontes existem:
   - m²: `Machine Card → Produção (Metros)` (Produção M², Largura Real)
   - meta de velocidade: `Indicadores Diário → Dinamica` (m/hora, m/min por máquina)

3. **`tendencia_mensal` está vazia (0 linhas).** O mapeamento aponta para a aba
   "Dados Prod" de Graficos Tendência, mas essa aba tem blocos lado a lado em vez
   de colunas nomeadas — nenhuma coluna casou e a carga descartou tudo sem erro.

## Dependência inversa: quem usa cada arquivo

| Arquivo | Alimenta hoje | Alimentaria (bases mapeadas, não ligadas) |
|---|---|---|
| Indicadores Diário 2025/2026 | `apontamentos`, `producao_kg` | metas, classificação oficial, Base Apontamento |
| Sequenciamento (9 mensais) | `fardos_aparas` | detalhe por fardo, fora-processo, formulários, 2 cadastros |
| Sequenciamento Acumulado 2026 | `fardos_aparas` (1.724 linhas) | ⚠️ a confirmar se duplica os mensais |
| Refugo Aparas | `refugo_aparas_historico` (5 de 15 col) | produção diária, refugo diário ×2, limites |
| Refugo Produção | `refugo_producao` | G_m², larguras, controle de perdas |
| Machine Card 2025/Genérico | `maquinas` (35 linhas de 699k) | horas, produção m², absenteísmo, MOD/MOI, cores |
| Base Aparas 2024/25/26/Genérico | `apontamentos` (via BASE_DETALHE) | BASE_PROD (cliente/SKU), engenharia, SKU |
| Graficos Tendência | nada (carga quebrada) | TMR, borra, lote médio, volumes, scrap |
| Aderência Semanal | **nada** | aderência diária/semanal, programação, entregas |

## Onde cada regra de tratamento acontece

| Regra | Onde | Por quê |
|---|---|---|
| Normalização de nome de coluna | `lib.js → normalize()` | Cabeçalhos vêm em CamelCase colado (`CodApont`) |
| Apelidos de coluna | `lib.js → HEADER_ALIASES` | `usr_tipodaperda` → `tipo_perda` etc. |
| Retenção de 12 meses | `lib.js → RETENTION_DATE_COL` | Evitar estourar o plano free do Supabase |
| Troca por arquivo | `lib.js → REPLACE_BY_SOURCE` | Tabelas de evento não têm chave natural |
| Descarte de linha sem chave | `sync.js` e `collect-bases.js` | Rodapé de planilha quebrava a carga inteira |
| Cabeçalho em linha declarada | `bases-catalog.js → headerRow` | Várias abas têm título acima do cabeçalho |
| Percentual fração → pontos | `collect-bases.js` | Excel guarda 38% como 0.38 |
