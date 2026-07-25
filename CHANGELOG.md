# Changelog — Painel Admin

Todas as mudanças notáveis deste projeto são registradas aqui.
Numeração: v1.0.0 fica reservado para quando o conjunto inicial de
funcionalidades administrativas planejadas estiver completo.

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
