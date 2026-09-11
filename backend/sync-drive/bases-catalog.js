// ============================================================================
// bases-catalog.js — catálogo das BASES LÓGICAS encontradas nas planilhas
// ----------------------------------------------------------------------------
// Fase de MAPEAMENTO (set/2026): o objetivo aqui é levar o MÁXIMO de dado
// para o DATABASE_GUALAPACK.xlsx, sem decidir ainda o que continua e o que
// será descontinuado. Uma planilha pode conter VÁRIAS bases lógicas — cada
// aba relevante vira uma entrada aqui.
//
// Este catálogo é só descoberta/consolidação. Quem decide o que vai pro
// Supabase continua sendo DB_SHEET_NAME em lib.js (as 7 abas já validadas).
// As bases novas entram no arquivo central como inventário, e o sync não
// as toca até decidirmos.
//
// Campos de cada base:
//   sheet          nome da aba DB_ no arquivo central
//   origem         rótulo lógico curto (vai na coluna "origem" de cada linha)
//   fileKeywords   casa com o nome do arquivo (normalizado)
//   sheetMatch     casa com o nome da aba (normalizado); pode casar VÁRIAS
//   multiSheet     true = consolida todas as abas que casarem (ex: TMR - *)
//   headerRow      índice (base 0) da linha de cabeçalho; null = auto-detect
//   colunas        mapa "coluna normalizada da planilha" -> "coluna destino".
//                  Só o que estiver aqui é levado; o resto é ignorado.
//   numeric/date   coerção de tipo por coluna DESTINO
//   granularidade  1 linha = o quê (documentação, vai pro DB_CONTROLE)
//   classificacao  hipótese inicial: PRINCIPAL | COMPLEMENTAR | REDUNDANTE |
//                  LEGADA | AUXILIAR | INCERTA
//   observacao     nota livre pro relatório
// ============================================================================

export const BASES = [
  // --------------------------------------------------------------------------
  // Graficos Tendência.xlsx — 14 abas. Só "Dados Prod" estava mapeada (e
  // quebrada: o cabeçalho real é uma linha de blocos lado a lado).
  // --------------------------------------------------------------------------
  {
    sheet: "DB_TMR", origem: "TMR",
    fileKeywords: ["tendencia"], sheetMatch: ["tmr"], multiSheet: true,
    headerRow: 2, // L1=DISPONIBILIDADE, L2=nome do recurso, L3=cabeçalho
    recursoFromRow: 1, // o nome do recurso está na linha 2 da aba
    colunas: {
      mes: "mes", setup: "setup_pct", inicializacao: "inicializacao_pct",
      improdutivo: "improdutivo_pct", inativo: "inativo_pct", produzindo: "produzindo_pct",
      disponibilidade: "disponibilidade_pct", horas_totais: "horas_totais",
    },
    numeric: ["setup_pct", "inicializacao_pct", "improdutivo_pct", "inativo_pct", "produzindo_pct", "disponibilidade_pct", "horas_totais"],
    date: {},
    granularidade: "1 linha por recurso (máquina ou processo) x mês",
    classificacao: "PRINCIPAL",
    observacao: "7 abas: TMR - R18/R20/L04 são MÁQUINA; TMR - Flexo/Roto/Laminação/Corte são PROCESSO. Laminação/L04/Corte não têm a coluna Inicialização.",
  },
  {
    sheet: "DB_BORRA", origem: "BORRA",
    fileKeywords: ["tendencia"], sheetMatch: ["borra"], multiSheet: true,
    headerRow: 0,
    colunas: { mes: "mes", produzido: "produzido_kg", descarte: "descarte_kg" },
    numeric: ["produzido_kg", "descarte_kg"], date: {},
    granularidade: "1 linha por tipo de borra (tinta/adesivo) x mês",
    classificacao: "COMPLEMENTAR",
    observacao: "Duas abas: 'Borra de Tinta' e 'Borra de Adesivo'. Nenhuma está no dashboard hoje.",
  },
  {
    sheet: "DB_LOTE_MEDIO", origem: "LOTE_MEDIO",
    fileKeywords: ["tendencia"], sheetMatch: ["lote_medio"],
    headerRow: 1,
    colunas: { mes: "mes", km: "lote_medio_km" },
    numeric: ["lote_medio_km"], date: {},
    granularidade: "1 linha por mês",
    classificacao: "COMPLEMENTAR",
    observacao: "Também aparece dentro da aba 'Dados Prod' como um dos blocos — possível redundância.",
  },

  // --------------------------------------------------------------------------
  // Refugo Aparas.xlsx — 10 abas. Só "Conta Refugo " estava mapeada, e
  // apenas 5 das 15 colunas dela eram lidas.
  // --------------------------------------------------------------------------
  {
    sheet: "DB_REFUGO_APARAS_MENSAL", origem: "REFUGO_APARAS_MENSAL",
    fileKeywords: ["refugo_aparas"], sheetMatch: ["conta_refugo"],
    headerRow: 0,
    colunas: {
      date: "data", volume_jgr: "volume_jgr", scrap_jgr: "scrap_jgr",
      volume_orf: "volume_orf", scrap_orf: "scrap_orf",
      volume_total: "volume_total", scrap_total: "scrap_total",
      jgr: "pct_jgr", of: "pct_of", gualapack: "pct_gualapack",
      scrap_s_refile: "scrap_sem_refile",
    },
    numeric: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf", "volume_total", "scrap_total", "pct_jgr", "pct_of", "pct_gualapack", "scrap_sem_refile"],
    date: { data: "date" },
    granularidade: "1 linha por mês",
    classificacao: "PRINCIPAL",
    observacao: "Já alimenta refugo_aparas_historico, mas hoje só 5 das 15 colunas são lidas. Contém meses futuros (projeção) — vai até dez/2026.",
  },
  {
    sheet: "DB_REFUGO_APARAS_HIST", origem: "REFUGO_APARAS_HIST",
    fileKeywords: ["refugo_aparas"], sheetMatch: ["historico_refugo"],
    headerRow: 0,
    colunas: {
      date: "data", volume_jgr: "volume_jgr", scrap_jgr: "scrap_jgr",
      volume_orf: "volume_orf", scrap_orf: "scrap_orf", of: "pct_of", ytd: "ytd",
    },
    numeric: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf", "pct_of", "ytd"],
    date: { data: "date" },
    granularidade: "1 linha por mês",
    classificacao: "REDUNDANTE",
    observacao: "Mesmas colunas base de 'Conta Refugo' + YTD, porém com menos colunas e menos linhas (37 vs 66). Forte candidata a redundância — comparar antes de decidir.",
  },
  {
    sheet: "DB_PRODUCAO_DIARIA", origem: "PRODUCAO_DIARIA",
    fileKeywords: ["refugo_aparas"], sheetMatch: ["producao"],
    headerRow: 1, // L1 = "DAILY PRODUCTION SCHEDULE" (título)
    colunas: {
      year: "ano", month: "mes_num", date: "data",
      segment_i: "segmento_i", segment_ii: "segmento_ii",
      plant_jgr: "qtd_jgr", plant_orf: "qtd_orf", total: "qtd_total",
    },
    numeric: ["ano", "mes_num", "qtd_jgr", "qtd_orf", "qtd_total"],
    date: { data: "date" },
    granularidade: "1 linha por dia x segmento",
    classificacao: "PRINCIPAL",
    observacao: "6.990 linhas desde 2022. NÃO está mapeada hoje. Produção diária por segmento e planta (JGR/ORF).",
  },
  {
    sheet: "DB_REFUGO_DIARIO_JGR", origem: "REFUGO_DIARIO_JGR",
    fileKeywords: ["refugo_aparas"], sheetMatch: ["refugo_jgr"],
    headerRow: 1,
    colunas: {
      year: "ano", month: "mes_num", date: "data",
      refugo_jgr: "refugo_kg", refile_jgr: "refile_kg", total_jgr: "total_kg",
    },
    numeric: ["ano", "mes_num", "refugo_kg", "refile_kg", "total_kg"],
    date: { data: "date" },
    granularidade: "1 linha por dia (planta JGR)",
    classificacao: "PRINCIPAL",
    observacao: "1.617 linhas desde 2022. NÃO mapeada hoje. Refugo/refile diário da planta JGR.",
  },
  {
    sheet: "DB_REFUGO_DIARIO_OF", origem: "REFUGO_DIARIO_OF",
    fileKeywords: ["refugo_aparas"], sheetMatch: ["refugo_of"],
    headerRow: 1,
    colunas: {
      year: "ano", month: "mes_num", date: "data",
      refugo_orf: "refugo_kg", borra_kg: "borra_kg", refile_orf: "refile_kg", total_orf: "total_kg",
    },
    numeric: ["ano", "mes_num", "refugo_kg", "borra_kg", "refile_kg", "total_kg"],
    date: { data: "date" },
    granularidade: "1 linha por dia (planta ORF)",
    classificacao: "PRINCIPAL",
    observacao: "1.342 linhas desde 2022. NÃO mapeada hoje. Tem coluna BORRA que a versão JGR não tem.",
  },
  {
    sheet: "DB_REFUGO_CLASSIFICACAO", origem: "REFUGO_CLASSIFICACAO",
    fileKeywords: ["refugo_aparas"], sheetMatch: ["refugo_confirmado_classificacao"],
    headerRow: 0,
    colunas: { data: "data", classificacao: "classificacao", peso: "peso_kg", tipo: "tipo" },
    numeric: ["peso_kg"], date: { data: "date" },
    granularidade: "1 linha por dia x classificação",
    classificacao: "COMPLEMENTAR",
    observacao: "623 linhas. Classifica refugo em DENTRO/FORA PROCESSO. NÃO mapeada hoje.",
  },
  {
    sheet: "DB_LIMITE_FARDO", origem: "LIMITE_FARDO",
    fileKeywords: ["refugo_aparas"], sheetMatch: ["limite_fardo"],
    headerRow: 0,
    colunas: {
      mes: "mes_texto", date: "data", volume_jgr: "volume_jgr", scrap_jgr: "scrap_jgr",
      volume_orf: "volume_orf", scrap_orf: "scrap_orf", perda: "pct_perda",
      producao: "producao_kg", limite_max: "limite_max_kg", quanto_pode_descartar: "saldo_descarte_kg",
    },
    numeric: ["volume_jgr", "scrap_jgr", "volume_orf", "scrap_orf", "pct_perda", "producao_kg", "limite_max_kg", "saldo_descarte_kg"],
    date: { data: "date" },
    granularidade: "1 linha por mês",
    classificacao: "COMPLEMENTAR",
    observacao: "META/LIMITE de descarte por mês. NÃO mapeada hoje — é a única fonte de meta que encontrei até agora.",
  },

  // --------------------------------------------------------------------------
  // Sequenciamento dos Fardos (9 arquivos mensais + acumulado) — 9 abas cada.
  // Só "COMPLETOS" estava mapeada.
  // --------------------------------------------------------------------------
  {
    sheet: "DB_APARAS_DETALHE", origem: "APARAS_DETALHE",
    fileKeywords: ["sequenciamento"], sheetMatch: ["detalhes1"],
    headerRow: 1, // L1 = "Detalhes do Soma de ..."
    colunas: {
      codigo: "codigo", dp_ou_fp: "dp_fp", refugo: "refugo", refile: "refile",
      data: "data", n: "numero", qtd_bruta_kg: "qtd_bruta_kg",
      qtd_liquida_kg: "qtd_liquida_kg", nome: "operador",
      classificacao: "classificacao_cod", tipo: "classificacao_desc",
    },
    numeric: ["numero", "qtd_bruta_kg", "qtd_liquida_kg", "classificacao_cod"],
    date: { data: "date" },
    granularidade: "1 linha por fardo",
    classificacao: "REDUNDANTE",
    observacao: "Mesmas colunas de COMPLETOS (que já alimenta fardos_aparas), mas é o drill-down do pivot e traz a descrição da classificação. Comparar com COMPLETOS antes de decidir.",
  },
  {
    sheet: "DB_APARAS_FORA_PROCESSO", origem: "APARAS_FORA_PROCESSO",
    fileKeywords: ["sequenciamento"], sheetMatch: ["detalhes_fp"],
    headerRow: 0,
    colunas: {
      dia: "dia", n_fardo: "numero_fardo", roda_de_carroca: "roda_carroca",
      lixo: "lixo", amostra: "amostra", outros: "outros",
      observacao: "observacao", qtd_kg: "qtd_kg",
    },
    numeric: ["dia", "numero_fardo", "roda_carroca", "lixo", "amostra", "outros", "qtd_kg"],
    date: {},
    granularidade: "1 linha por evento fora de processo",
    classificacao: "COMPLEMENTAR",
    observacao: "711 linhas por arquivo. Detalha o refugo FORA de processo (roda de carroça, lixo, amostra). NÃO mapeada hoje.",
  },
  {
    sheet: "DB_APARAS_FORMULARIOS", origem: "APARAS_FORMULARIOS",
    fileKeywords: ["sequenciamento"], sheetMatch: ["formularios"],
    headerRow: 0,
    colunas: { op: "op", descricao: "descricao", data: "data", peso: "peso_kg", tipo: "tipo", setor: "setor" },
    numeric: ["peso_kg"], date: { data: "date" },
    granularidade: "1 linha por formulário de descarte (OP/descrição/data)",
    classificacao: "COMPLEMENTAR",
    observacao: "329 linhas por arquivo. Liga descarte a OP e SETOR — é a única base que traz SETOR. NÃO mapeada hoje.",
  },
  {
    sheet: "DB_MOTIVOS_APARAS", origem: "CADASTRO_CLASSIFICACAO",
    fileKeywords: ["sequenciamento"], sheetMatch: ["classificacao"],
    headerRow: 1,
    colunas: { codigo: "codigo", classificacao: "descricao" },
    numeric: ["codigo"], date: {},
    granularidade: "1 linha por código de classificação (cadastro)",
    classificacao: "AUXILIAR",
    observacao: "Tabela de domínio: 1=PROCESSO PRODUTIVO, 2=TOCOS, 11=REFILE... Usada para traduzir o código em COMPLETOS/Detalhes1.",
  },
  // --------------------------------------------------------------------------
  // Indicadores Diário - 2025/2026.xlsx — 10 abas. Duas já usadas
  // (apontamentos e producao_kg); estas três nunca foram tocadas e são as
  // que destravam indicadores hoje vazios no painel.
  // --------------------------------------------------------------------------
  {
    sheet: "DB_METAS", origem: "METAS",
    fileKeywords: ["indicadores"], sheetMatch: ["metas"],
    headerRow: 0,
    colunas: { data: "data", maquina: "maquina", meta: "meta", chave: "chave_periodo" },
    numeric: ["meta"], date: { data: "date" },
    granularidade: "1 linha por dia x máquina",
    classificacao: "PRINCIPAL",
    observacao: "3.668 linhas. Meta diária por máquina. NÃO mapeada — o painel não tem meta por máquina hoje.",
  },
  {
    sheet: "DB_CLASSIFICACAO_APONT", origem: "CADASTRO_CLASSIFICACAO_APONT",
    fileKeywords: ["indicadores"], sheetMatch: ["classificacao_oficial"],
    headerRow: 0,
    colunas: {
      cod: "cod_apont", descricao: "descricao",
      classificacao_disp: "classificacao_disponibilidade", classificacao: "classificacao_horas",
    },
    numeric: [], date: {},
    granularidade: "1 linha por código de apontamento (cadastro oficial)",
    classificacao: "AUXILIAR",
    observacao: "112 códigos. Liga cod_apont a SETUP/INICIALIZAÇÃO/INATIVIDADE/IMPRODUTIVO — é a definição oficial do TMR. Usar a versão 'Oficial': o código vem zero-padded ('01'), igual ao das bases de evento; a aba 'Classificação' usa '1' e não casaria.",
  },

  // --------------------------------------------------------------------------
  // Machine Card Oficial - 2025/Genérico.xlsx — 26 e 32 abas. Usávamos 1.
  // --------------------------------------------------------------------------
  {
    sheet: "DB_PRODUCAO_METROS", origem: "PRODUCAO_METROS",
    fileKeywords: ["machine_card"], sheetMatch: ["producao_metros"],
    headerRow: 0,
    colunas: {
      num_ordem: "num_ordem", cod_recurso: "cod_recurso", dt_producao: "dt_producao",
      tipo_produto: "tipo_produto", descricao: "descricao", operador: "operador",
      turno: "turno", qtd_horas: "qtd_horas",
      qtd_produzida_metros: "qtd_produzida_m", producao_m: "producao_m2",
      largura_real: "largura_real",
    },
    numeric: ["qtd_horas", "qtd_produzida_m", "producao_m2", "largura_real"],
    date: { dt_producao: "date" },
    granularidade: "1 linha por OP x recurso x dia",
    classificacao: "PRINCIPAL",
    observacao: "É a única base com PRODUÇÃO M² e LARGURA REAL. O KPI de produtividade (m²/h) do painel está vazio hoje por falta exatamente disso.",
  },
  {
    sheet: "DB_ABSENTEISMO", origem: "ABSENTEISMO",
    fileKeywords: ["machine_card"], sheetMatch: ["absenteismo"],
    headerRow: 0,
    colunas: {
      data: "data", planta: "planta", ano: "ano", mes: "mes",
      colaborador: "colaborador", centro_de_custo: "centro_custo",
      local_correto: "local", tipo: "tipo",
      horas_normais_trabalhadas: "horas_normais",
    },
    numeric: ["ano", "horas_normais"], date: { data: "date" },
    granularidade: "1 linha por colaborador x dia",
    classificacao: "COMPLEMENTAR",
    observacao: "4.735 linhas. Abre o domínio de PESSOAS, que o painel não cobre. Contém nome de colaborador — avaliar privacidade antes de levar ao dashboard.",
  },
  {
    sheet: "DB_CORES_POR_OP", origem: "CORES_POR_OP",
    fileKeywords: ["machine_card"], sheetMatch: ["cores_por_op"],
    headerRow: 0,
    colunas: {
      num_ordem: "num_ordem", cod_estrutura: "cod_estrutura", maq: "maquina",
      grupo: "grupo", n_cores: "num_cores", n_ops: "num_ops",
    },
    numeric: ["num_cores", "num_ops"], date: {},
    granularidade: "1 linha por OP x estrutura",
    classificacao: "COMPLEMENTAR",
    observacao: "6.593 linhas. Número de cores por OP — explica tempo de setup em impressão.",
  },

  // --------------------------------------------------------------------------
  // Aderência Semanal.xlsx — 19 abas, NENHUMA usada hoje. A tabela
  // aderencia_programacao do Supabase está órfã (nenhum arquivo a alimenta).
  // --------------------------------------------------------------------------
  // DB_ADERENCIA_DIARIA promovida pra tabela aderencia_programacao em
  // 2026-09-11 (ver TABLE_DEFS em lib.js) — saiu do inventário porque já
  // alimenta o Supabase; sem isso o build-database-central.js tentaria
  // criar a mesma aba duas vezes.
  {
    sheet: "DB_ADERENCIA_SEMANAL", origem: "ADERENCIA_SEMANAL",
    fileKeywords: ["aderencia"], sheetMatch: ["aderencia_semanal"],
    headerRow: 0,
    colunas: {
      maquina: "maquina", op: "num_ordem", descricao: "descricao",
      planejado: "planejado", inicio: "dt_inicio", semana: "semana",
    },
    numeric: ["planejado", "semana"], date: { dt_inicio: "date" },
    granularidade: "1 linha por OP x máquina x semana",
    classificacao: "COMPLEMENTAR",
    observacao: "6.694 linhas. Granularidade semanal — complementa a diária, não substitui.",
  },
  {
    sheet: "DB_PROGRAMACAO", origem: "PROGRAMACAO",
    fileKeywords: ["aderencia"], sheetMatch: ["programacao"],
    headerRow: 0,
    colunas: {
      num_ordem: "num_ordem", maquina: "maquina", dt_ini_plan: "dt_ini_plan",
      qtd_planejada: "qtd_planejada", produto: "produto", chave: "chave_periodo",
    },
    numeric: ["qtd_planejada"], date: { dt_ini_plan: "date" },
    granularidade: "1 linha por OP programada",
    classificacao: "COMPLEMENTAR",
    observacao: "718 linhas. Programação vigente.",
  },
  {
    sheet: "DB_CALENDARIO_SEMANAS", origem: "CALENDARIO",
    fileKeywords: ["aderencia"], sheetMatch: ["semanas"],
    headerRow: 0,
    colunas: { data: "data", semana: "semana" },
    numeric: ["semana"], date: { data: "date" },
    granularidade: "1 linha por dia",
    classificacao: "AUXILIAR",
    observacao: "427 linhas. De-para dia -> semana do ano. Existe em duplicidade ('Semanas' e 'Tabela Semana ').",
  },

  // --------------------------------------------------------------------------
  // Refugo Produção.xlsx — 9 abas, 1 usada.
  // --------------------------------------------------------------------------
  {
    sheet: "DB_CONTROLE_PERDAS", origem: "CONTROLE_PERDAS",
    fileKeywords: ["refugo_producao"], sheetMatch: ["formulario_controle_perdas"],
    headerRow: 0,
    colunas: {
      hora: "hora", peso: "peso_kg", data: "data", op: "num_ordem",
      maquina: "maquina", turno: "turno", nome: "operador",
      valor_sistema: "valor_sistema", status: "status",
      valor_apontado: "valor_apontado", delta_apontado: "delta_apontado",
    },
    numeric: ["peso_kg", "turno", "valor_sistema", "valor_apontado", "delta_apontado"],
    date: { data: "date" },
    granularidade: "1 linha por formulário de perda",
    classificacao: "COMPLEMENTAR",
    observacao: "367 linhas. Compara VALOR SISTEMA x VALOR APONTADO e calcula DELTA — é a única base de DIVERGÊNCIA que existe. Nenhum uso hoje.",
  },

  // --------------------------------------------------------------------------
  // Base Aparas - 2024/2025/2026/Genérico — 7 a 16 abas cada. Só
  // "BASE_DETALHE" estava mapeada (e ia pra tabela apontamentos).
  // Aqui está a maior concentração de dado não usado do Drive inteiro.
  // --------------------------------------------------------------------------
  {
    sheet: "DB_PRODUCAO_OP", origem: "PRODUCAO_OP",
    fileKeywords: ["base_aparas"], sheetMatch: ["base_prod"],
    headerRow: 0,
    colunas: {
      num_ordem: "num_ordem", cod_recurso: "cod_recurso", dt_producao: "dt_producao",
      peso_bruto: "peso_bruto", refugo: "refugo", descricao: "descricao",
      estrutura: "estrutura", processo: "processo", tipo_produto: "tipo_produto",
      considerar: "considerar", maquina_real: "maquina_real",
      cliente: "cliente", tipo_cliente: "tipo_cliente", sku: "sku",
    },
    numeric: ["peso_bruto", "refugo"], date: { dt_producao: "date" },
    granularidade: "1 linha por OP x recurso x dia",
    classificacao: "PRINCIPAL",
    observacao: "NÃO mapeada hoje. É a única base com CLIENTE, TIPO CLIENTE e SKU junto da produção — o painel não tem visão de cliente hoje por falta disso.",
  },
  {
    sheet: "DB_ENGENHARIA", origem: "CADASTRO_ENGENHARIA",
    fileKeywords: ["base_aparas"], sheetMatch: ["engenharia"],
    headerRow: 0,
    colunas: {
      num_ordem: "num_ordem", cod_estrutura: "cod_estrutura", descricao: "descricao",
      cod_item: "cod_item", passo: "passo", largura: "largura",
      nome_cliente: "cliente", cod_cliente: "cod_cliente", cod_sap: "cod_sap",
      tipo_produto: "tipo_produto", horiz_faixa: "horiz_faixa",
      vert_repet: "vert_repet", cilindro: "cilindro", data_emissao: "data_emissao",
    },
    numeric: ["passo", "largura", "horiz_faixa", "vert_repet", "cilindro"],
    date: { data_emissao: "timestamp" },
    granularidade: "1 linha por ordem/estrutura (cadastro de engenharia)",
    classificacao: "AUXILIAR",
    observacao: "~43 mil linhas. Cadastro de produto: passo, largura, cilindro, cliente, código SAP. NÃO mapeado hoje — é o que falta pra calcular produtividade em m²/h.",
  },
  {
    sheet: "DB_SKU", origem: "CADASTRO_SKU",
    fileKeywords: ["base_aparas"], sheetMatch: ["base_sku"],
    headerRow: 0,
    colunas: { codigo_pa: "codigo_pa", codigo_engenharia: "codigo_engenharia" },
    numeric: [], date: {},
    granularidade: "1 linha por SKU (de-para PA x Engenharia)",
    classificacao: "AUXILIAR",
    observacao: "~13 mil linhas. De-para entre código PA e código de engenharia. NÃO mapeado hoje.",
  },
  {
    sheet: "DB_APONTAMENTOS_HIST", origem: "APONTAMENTOS_HIST",
    fileKeywords: ["base_aparas"], sheetMatch: ["base_producao", "base_maq_emb"], multiSheet: true,
    headerRow: 0,
    // Só amostra: são ~1,5 milhão de linhas com as MESMAS 22 colunas que já
    // carregamos via BASE_DETALHE. Copiar tudo levaria o arquivo central a
    // passar de 1 GB sem acrescentar informação nenhuma. O total real de
    // cada aba fica registrado no DB_CONTROLE, e a amostra permite comparar
    // conteúdo e período antes de decidir qual das três é a oficial.
    amostra: 5000,
    colunas: {
      num_ordem: "num_ordem", cod_recurso: "cod_recurso", cod_apont: "cod_apont",
      qtd_produzida: "qtd_produzida", cod_desc: "cod_desc", dt_producao: "dt_producao",
      hora_inicio: "hora_inicio", hora_fim: "hora_fim", qtd_horas: "qtd_horas", turno: "turno",
      usr_peso_bruto_bobina: "peso_bruto_bobina", usr_tipodaperda: "tipo_perda",
      usr_kgdaperda: "kg_perda", nome_operador: "nome_operador", descricao: "descricao",
      tipo_produto: "tipo_produto", cod_estrutura: "cod_estrutura",
      des_num_ordem: "des_num_ordem", cod_est: "cod_est", processo: "processo",
      classificacao: "classificacao", nome_cliente: "nome_cliente",
    },
    numeric: ["qtd_produzida", "qtd_horas", "peso_bruto_bobina", "kg_perda"],
    date: { dt_producao: "date", hora_inicio: "timestamp", hora_fim: "timestamp" },
    granularidade: "1 linha por evento de máquina",
    classificacao: "REDUNDANTE",
    observacao: "ATENÇÃO: 'Base Produção' (389 mil linhas em 2024, 367 mil em 2025), 'BASE_MÁQ_EMB' (168 mil) e 'BASE_DETALHE' (22 mil, a única usada hoje) têm as MESMAS 22 colunas. É a maior sobreposição encontrada — comparar antes de decidir qual é a oficial.",
  },
  {
    sheet: "DB_TIPOS_MATERIAL", origem: "CADASTRO_TIPO_MATERIAL",
    fileKeywords: ["sequenciamento"], sheetMatch: ["tipo_refugo"],
    headerRow: 0,
    colunas: { cod_material: "codigo", descricao: "descricao", peso: "peso_kg" },
    numeric: ["codigo", "peso_kg"], date: {},
    granularidade: "1 linha por tipo de material (cadastro + peso do mês)",
    classificacao: "AUXILIAR",
    observacao: "PET, BOPP, LAMINADOS, PAPELÃO... Cadastro com o peso acumulado do mês junto.",
  },
];

// Abas que são pivot/painel do Excel e NÃO são base de dado tabular —
// registradas aqui pra ficar explícito que foram vistas e descartadas
// como base (não é "esqueci", é "olhei e não é tabela").
export const ABAS_NAO_TABULARES = [
  { arquivo: "Sequenciamento *", aba: "Planilha1", motivo: "Filtros de tabela dinâmica (DP ou FP, REFILE, REFUGO)." },
  { arquivo: "Sequenciamento *", aba: "DIM", motivo: "Tabela dinâmica (DATA/TIPO/DP ou FP -> soma)." },
  { arquivo: "Sequenciamento *", aba: "CONTABILIZAÇÃO", motivo: "Painel de conferência com blocos lado a lado e fórmulas de CHECK." },
  { arquivo: "Refugo Aparas.xlsx", aba: "Porcent. Aparas", motivo: "Tabela dinâmica + bloco de resumo mensal." },
  { arquivo: "Refugo Aparas.xlsx", aba: "Refugo_Separado", motivo: "Mesmo dado de Conta Refugo em formato longo (planta como linha)." },
  { arquivo: "Refugo Aparas.xlsx", aba: "Master Plan", motivo: "Conta Refugo + REFILE/RODA CARROÇA; sobreposição quase total." },
  { arquivo: "Graficos Tendência.xlsx", aba: "Dados Prod", motivo: "Blocos lado a lado (Volume/Lote/Aparas/Vazão) — é painel, não tabela." },
  { arquivo: "Graficos Tendência.xlsx", aba: "Volume (km) / Volume (ton) / Scrap", motivo: "Blocos lado a lado por processo — precisa de parser dedicado por bloco." },
  { arquivo: "Base Aparas - *", aba: "DIM / Dinamica / Planilha3", motivo: "Tabelas dinâmicas (Rótulos de Linha / Soma de ...)." },
  { arquivo: "Base Aparas - *", aba: "Sylvamo", motivo: "Tabela dinâmica filtrada (produção Sylvamo R18/R20)." },
  { arquivo: "Base Aparas - 2025", aba: "Planilha5 e Planilha5 (2)", motivo: "Duas cópias idênticas (4.869 linhas cada) do formato BASE_PROD — provável trabalho manual em rascunho." },
  { arquivo: "Base Aparas - 2025/2026", aba: "Planilha1 / Planilha2", motivo: "Conferência manual OP a OP entre roto e corte, em blocos lado a lado por mês." },
  { arquivo: "Base Aparas - 2025", aba: "Planilha4 / Planilha7", motivo: "Saída de pivot (MÊS|PESO) e lista solta de OPs." },
];

// Divergências de nome de aba entre arquivos do MESMO template — o
// consolidador precisa casar por aproximação, não por nome exato.
export const VARIACOES_DE_NOME = [
  { base: "DB_APARAS_FORA_PROCESSO", variantes: ["DETALHES - FP", "DETALHES"], observacao: "Setembro usa 'DETALHES - FP'; Fevereiro/Março usam só 'DETALHES'." },
  { base: "DB_APONTAMENTOS_HIST", variantes: ["Base Produção", "BASE_MÁQ_EMB", "BASE_DETALHE"], observacao: "Mesmo layout de 22 colunas com três nomes diferentes, às vezes no mesmo arquivo." },
  { base: "DB_MOTIVOS_APARAS", variantes: ["CLASSIFICAÇÃO "], observacao: "A lista de códigos varia entre meses (12, 13 ou 14 linhas) — o cadastro não é estável." },
];
