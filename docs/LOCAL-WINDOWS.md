# Visualização local no Windows — PROJETOVOTE

## Objetivo

Abrir o site público e a interface de login do painel administrativo no PC, **sem deploy, sem migrations e sem modificar dados de produção**.

## Passos no PowerShell

1. Instalar Node.js 22 LTS e Git, se ainda não estiverem instalados.
2. Abrir o PowerShell na pasta do projeto. Para usar exatamente as alterações desta auditoria, atualizar a branch `audit/security-migrations-baseline-20261106` **apenas se a árvore de trabalho estiver limpa**:
   ```powershell
   git status
   git fetch origin
   git switch audit/security-migrations-baseline-20261106
   git pull --ff-only origin audit/security-migrations-baseline-20261106
   ```
   Se houver alterações locais não guardadas, **não** usar `git reset --hard`, `git clean` ou sobrescrever ficheiros; preservar o trabalho e pedir orientação.
3. Executar:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
   ```
   O script instala dependências com `npm ci` quando necessário, cria `.env.local` apenas se ainda não existir e inicia Vite na porta 8080. Não executa migrações nem usa chaves secretas.

## URLs

- Site público: http://127.0.0.1:8080/#/pt/
- Login administrativo: http://127.0.0.1:8080/#/admin/login
- Painel protegido: http://127.0.0.1:8080/#/admin
- Preview DEV sem base de dados: http://127.0.0.1:8080/#/dev/preview-5c316

O router usa `hash` por omissão. Se `VITE_ROUTER_MODE=browser` estiver definido em `.env.local`, as URLs serão sem `/#`; recomendamos `hash` para este arranque.

## Painel admin com dados reais

Para iniciar sessão, definir em `.env.local`:
```dotenv
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA_ANON
VITE_ROUTER_MODE=hash
```

A URL e a chave **anon/publishable** devem ser obtidas em Supabase > Project Settings > API. **Nunca** introduzir `service_role`, `sb_secret_...`, JWT secret ou palavra-passe de administrador no repositório ou neste chat. `.env.local` é ignorado pelo Git. Reiniciar o Vite depois de alterar o ficheiro.

A autenticação exige uma conta existente no Supabase Auth com perfil `public.profiles` e `role='admin'` ou `'super_admin'`. Não há login fictício nem bypass de autorização no modo local. Sem estas configurações, o site público usa dados fallback e o formulário admin aparece, mas **não autentica**.

**Atenção:** apontar a app local ao projeto Supabase de produção permite que ações de escrita efetuadas no painel admin alterem dados reais. Para apenas visualizar, não guardar/editar/apagar registos. O ideal é usar um projeto Supabase de staging para testes funcionais.

## Retomar trabalho

Estado em 2026-11-06: PR #1, branch `audit/security-migrations-baseline-20261106`. Auditorias 0022–0024 documentadas; três categorias sem área (`cafes`, `ginasios`, `saloes-de-beleza`) com proposta SQL de reparação em `docs/audits/proposals/category-area-repair.sql`; histórico de migrations remoto até 0017, com conflito local de versão 0014. Não executar `db push`, `migration repair` ou o script de reparação em produção sem aprovação e backup.

Se a porta 8080 estiver ocupada, encerrar o processo que a utiliza antes de repetir o script. Para parar o servidor: Ctrl+C.
