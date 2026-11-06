# Verificação semântica RLS e triggers — 2026-11-06

Consultas somente leitura ao Supabase de produção, cruzadas com migrations 0018–0021.

## RLS: sete policies confirmadas

As seis policies `admin manage ...` nas tabelas `participant_invitations`, `category_areas`, `distinction_package_adoptions`, `magazine_editions`, `magazine_features` e `magazine_images` têm:
- `cmd = ALL`;
- `roles = {authenticated}`;
- `qual = is_admin()`;
- `with_check = is_admin()`.

A policy `public read active category_areas` tem:
- `cmd = SELECT`, `roles = {anon,authenticated}`;
- filtro `active = true` e programa correspondente `award_programs.active = true`;
- sem `with_check`, esperado para SELECT.

Estas expressões correspondem ao comportamento de acesso previsto pelas migrations. A ativação de RLS foi verificada em todas as sete tabelas na inspeção anterior.

## Triggers: eventos e funções confirmados

- participant_invitations: touch BEFORE UPDATE; check_scope BEFORE INSERT/UPDATE; audit AFTER INSERT/UPDATE.
- category_areas: touch BEFORE UPDATE; audit AFTER INSERT/UPDATE.
- distinction_package_adoptions: touch BEFORE UPDATE; audit AFTER INSERT/UPDATE.
- magazine_editions: touch BEFORE UPDATE; validate BEFORE INSERT/UPDATE; audit AFTER INSERT/UPDATE.
- magazine_features: touch BEFORE UPDATE; validate BEFORE INSERT/UPDATE; audit AFTER INSERT/UPDATE.
- magazine_images: audit AFTER INSERT/DELETE.

As consultas retornam linhas por evento; duas linhas para um trigger INSERT/UPDATE **não** significam triggers duplicados.

## Limitações e próximos passos

Ainda falta comparar os corpos das funções de trigger, índices não-PK, constraints completas, grants e o histórico de migrations. A presença de policy/trigger com assinatura compatível não prova equivalência de todos os objetos.

**Nenhuma escrita em produção.** Não executar `db push` nem marcar migrations como aplicadas sem reconciliação e aprovação.
