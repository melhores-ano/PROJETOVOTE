# Auditoria de escalada de privilégios — profiles (2026-11-06)

Escopo: inspeção **somente leitura** do Supabase `agtgtcnwfrskvpegxoir`. Não foram criados utilizadores nem executadas operações de escrita.

## Evidências do esquema remoto

- `public.profiles`: RLS ativo (`relrowsecurity=true`), sem `FORCE ROW LEVEL SECURITY`.
- Colunas: `id uuid NOT NULL`, `email text NOT NULL`, `role text NOT NULL DEFAULT 'admin'`, `display_name`, `created_at`, `updated_at`.
- Trigger observado: `profiles_touch` em `BEFORE UPDATE`, executa `touch_updated_at()`.
- Policies:
  - `users read own profile`: `SELECT TO authenticated USING (id = auth.uid() OR is_super_admin())`.
  - `super_admin manage profiles`: `ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin())`.
- Os papéis `anon` e `authenticated` possuem grants de tabela amplos, inclusive `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` e `TRIGGER`; as policies RLS limitam operações DML por linha, **mas RLS não protege necessariamente operações como TRUNCATE**. Verificar exposição efetiva da API e reduzir grants de operações desnecessárias mediante migration testada.
- `is_super_admin()` é `STABLE SECURITY DEFINER`, com `search_path=public`; retorna `EXISTS` de `profiles.id = auth.uid()` e `role = 'super_admin'`.

## Avaliação

**Ponto positivo:** as policies de `INSERT`/`UPDATE`/`DELETE` exigem `is_super_admin()`, impedindo que uma sessão comum atualize diretamente a sua própria linha para obter o papel administrativo via operações RLS normais.

**Ponto de atenção:** `role DEFAULT 'admin'` é permissivo para qualquer via de inserção privilegiada que não especifique explicitamente o papel. Não alterar o default sem mapear o processo de provisionamento de administradores.

**Ponto de atenção adicional:** os grants `TRUNCATE` e `TRIGGER` a papéis de API são excessivos e exigem avaliação. Não afirmar explorabilidade via Data API sem verificar a superfície realmente exposta.

## Testes pendentes

1. Inspecionar funções, triggers e processos de criação de perfis (incluindo Auth e quaisquer funções de serviço).
2. Testar em ambiente isolado: sessão anónima, utilizador comum, administrador e superadministrador; verificar `SELECT`, `INSERT`, `UPDATE role`, `DELETE` e RPCs administrativas.
3. Comparar grants efetivos com requisitos da aplicação, preparando revogações mínimas e testadas.
4. Verificar se `is_super_admin()` e `is_admin()` são seguras face a funções auxiliares e a políticas de `profiles`.

## Política de mudança

Nenhum `REVOKE`, alteração de default, trigger ou policy deve ser aplicado diretamente em produção sem aprovação, teste de regressão e plano de rollback.
