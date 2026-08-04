# Changelog — Painel Admin

Todas as mudanças notáveis deste projeto são registradas aqui.
Numeração: v1.0.0 fica reservado para quando o conjunto inicial de
funcionalidades administrativas planejadas estiver completo.

## v1.3.0 — 2026-08-04

- "Criar novo usuário" e "Permitir autocadastro" movidos da tela de um
  módulo específico para a tela de escolha de módulo — já que são
  funcionalidades do Hub inteiro, não de um módulo isolado, ficam visíveis
  uma vez só, antes de escolher o que gerenciar

## v1.2.0 — 2026-08-04

- Toggle global "Permitir que qualquer pessoa se cadastre", via Management
  API do Supabase (`disable_signup`); vale para o Hub inteiro, não varia por
  módulo
- Nova variável de ambiente exigida no Worker: `SUPABASE_MANAGEMENT_TOKEN`
  (token de acesso pessoal do Supabase, configurado como Secret)
- Avaliado e descartado: toggle isolado de "recuperação de senha por
  e-mail" — o Supabase não oferece esse controle separado (só é possível
  desligar e-mail de autenticação por completo, o que bloquearia
  confirmação de cadastro e magic link junto); o botão "Redefinir senha"
  já existente no painel cobre essa necessidade sem depender de e-mail

## v1.1.0 — 2026-08-04

- Criação de novo usuário direto pelo painel (e-mail + senha inicial), via
  Admin API do Supabase (nível do Hub, não depende do módulo selecionado)
- Usuário criado assim nasce sem nenhum módulo habilitado — precisa ser
  liberado manualmente pelo toggle "Módulo habilitado" em cada módulo
  desejado

## v1.0.0 — 2026-08-02

- Reforma completa para o modelo de projeto único (Hub): Banca Pro, Controle
  Financeiro e Plano de Saúde agora vivem no mesmo projeto Supabase, então
  login e checagem de admin acontecem uma única vez, sempre contra o Hub
- Seletor de "projeto" virou seletor de "módulo" — a navegação é a mesma,
  mas agora escolhe qual conjunto de dados exibir, não qual projeto logar
- Nova coluna "Módulo habilitado" em todas as tabelas: concede ou revoga o
  acesso de um usuário a um módulo inteiro (`habilitado` em
  `profiles_modulos`), algo que não existia antes — cada usuário podia ser
  bloqueado só por app individual (IA/documentos), nunca do módulo como um
  todo
- Toggles de IA e de documentos migraram de `profiles` (por projeto) para
  `profiles_modulos` (por usuário × módulo); gravação via upsert, já que a
  linha pode não existir ainda para um módulo nunca concedido
- Plano de Saúde entra como módulo com contagem de procedimentos e toggle de
  envio de documentos (bucket `documentos_saude`); não tem toggle de IA, já
  que esse app não tem funcionalidade de IA
- Função `storage_usage_por_usuario()` generalizada para aceitar qualquer
  bucket como parâmetro, servindo Controle Financeiro e Plano de Saúde
- Conjunto inicial de funcionalidades administrativas planejadas
  considerado completo — primeira versão v1.0.0

## v0.9.0 — 2026-07-27

- Nova coluna "IA: Busca de Liga" no Banca Pro (terceiro tipo de uso de IA,
  além de Bilhetes e Estatísticas; coluna `ai_calls_liga` em `profiles`)
- Nova coluna "Armazenamento" no Controle Financeiro, mostrando o espaço em
  MB usado por cada usuário no bucket de documentos (via função
  `storage_usage_por_usuario()`), só informativo, sem limite aplicado

## v0.8.0 — 2026-07-25

- Login único: a autenticação e a checagem de admin sempre acontecem contra
  o projeto Controle Financeiro (ADMIN_PROJECT_KEY), independente de qual
  projeto será gerenciado depois
- Depois de logado, a escolha de projeto (Banca Pro / Controle Financeiro)
  não exige um novo login — a troca entre projetos é livre
- Conta de admin dedicada (fabioscheffermoraes@me.com) criada no Controle
  Financeiro para servir como porta de entrada do painel

## v0.7.0 — 2026-07-25

- Contadores de uso de IA separados por tipo no Banca Pro: "IA: Bilhetes"
  (leitura de bilhete por foto/texto) e "IA: Estatísticas" (análise de risco)
- Colunas `ai_calls_bilhete` e `ai_calls_estatisticas` em `profiles`,
  incrementadas via funções dedicadas chamadas pelo Worker do Banca Pro
- No Controle Financeiro (só uma função de IA), a coluna "Usos de IA"
  continua mostrando o total único, sem separação

## v0.6.0 — 2026-07-25

- Toggle de envio de documentos por usuário, só no Controle Financeiro
  (coluna `documents_enabled` em `profiles`, exibida apenas quando esse
  projeto está selecionado)
- Bloqueio real via políticas RLS restritivas no Storage (bucket
  `documentos`) e na tabela `documentos_armazenados`, somadas às políticas
  já existentes sem substituí-las
- Ocultação visual do botão de guardar arquivo e do checkbox "guardar
  também" no Controle Financeiro quando desativado

## v0.5.0 — 2026-07-25

- Contagem de usos de IA por usuário (coluna `ai_calls_count` em `profiles`,
  incrementada via função `increment_ai_calls_count()` chamada pelos Workers
  do Banca Pro e do Controle Financeiro após cada leitura de IA bem-sucedida)
- Contagem de registros por usuário (apostas no Banca Pro, lançamentos no
  Controle Financeiro), exibida como coluna no painel
- Objetivo: observar o uso real antes de decidir uma cota — nenhum limite
  aplicado ainda

## v0.4.0 — 2026-07-25

- Toggle de acesso à IA por usuário (coluna `ai_enabled` na tabela `profiles`)
- Bloqueio correspondente aplicado nos Workers do Banca Pro e do Controle
  Financeiro: as rotas `/api/ler-bilhete`, `/api/analisar-aposta` e
  `/api/ler-documento` agora exigem o token de sessão do usuário e checam
  `ai_enabled` antes de chamar qualquer provedor de IA

## v0.3.0 — 2026-07-25

- Redefinição de senha por usuário (gera senha aleatória via Supabase Admin
  API, sem depender de e-mail)

## v0.2.0 — 2026-07-25

- Listagem de usuários (e-mail, data de cadastro, último login)
- Remoção de usuários

## v0.1.0 — 2026-07-25

- Seletor de projeto (Banca Pro / Controle Financeiro)
- Login administrativo com checagem de permissão `is_admin`
