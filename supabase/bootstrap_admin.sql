-- ============================================================================
-- Prémios Melhores do Ano Portugal — Bootstrap do primeiro super administrador
-- Executar MANUALMENTE no Supabase SQL Editor, UMA vez.
--
-- Passo 1: No Dashboard do Supabase, ir a Authentication > Users > Add user
--          (criar com email + palavra-passe forte) e COPIAR o UUID gerado.
-- Passo 2: Substituir <USER_UUID> e <EMAIL> abaixo e executar este ficheiro.
-- Passo 3: Iniciar sessão em /admin/login com essas credenciais.
--
-- NUNCA commitar este ficheiro com UUIDs ou emails reais.
-- NUNCA criar contas admin via código do frontend (sem auto-registo).
-- ============================================================================

-- Colar o UUID do utilizador criado em Authentication > Users:
--   User UUID: 00000000-0000-0000-0000-000000000000
--   Email:     admin@melhoresdoano.pt

insert into public.profiles (id, email, role, display_name)
values (
  '<USER_UUID>',
  '<EMAIL>',
  'super_admin',
  'Coordenação do Prémio'
)
on conflict (id) do update set
  role = 'super_admin',
  email = excluded.email;

-- Verificação (deve devolver 1 linha com role = super_admin):
-- select id, email, role, created_at from public.profiles where role = 'super_admin';
