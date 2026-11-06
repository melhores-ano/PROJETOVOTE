# Plano de redução de privilégios de tabela — 2026-11-06

**Estado: proposta, NÃO aplicada.** Baseada em consultas somente leitura ao Supabase `agtgtcnwfrskvpegxoir`.

## Evidência observada

Os papéis de API `anon` e `authenticated` têm privilégios `TRUNCATE` e `TRIGGER` em **todas as 31 tabelas** do esquema `public`. A verificação em `profiles` confirma também grants amplos de `SELECT`, `INSERT`, `UPDATE`, `DELETE` e `REFERENCES`.

**Importante:** `TRUNCATE` não é filtrado por RLS, ao contrário de `DELETE`. Não concluir que a Data API expõe uma operação de truncagem; o risco depende das superfícies SQL/RPC e das permissões efetivas. Mesmo assim, esses grants são desnecessariamente amplos para papéis destinados a pedidos de clientes.

## Mudança candidata (apenas para revisão)

A correção proposta é retirar `TRUNCATE` e `TRIGGER` de `anon` e `authenticated` nas tabelas `public`, preservando `SELECT`, `INSERT`, `UPDATE` e `DELETE` e respetivas políticas RLS. Antes de aplicar, verificar se algum procedimento legítimo executa `TRUNCATE` ou cria triggers usando estes papéis.

**Não incluir esta mudança em migrations ativas até passar pelos testes e obter aprovação.**

## Consulta de verificação antes/depois (somente leitura)

```sql
select grantee, privilege_type, count(*) as tables_with_grant
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('TRUNCATE', 'TRIGGER')
group by grantee, privilege_type
order by grantee, privilege_type;
```

Resultado observado em 2026-11-06: quatro linhas, cada uma com `tables_with_grant = 31`.

## Plano de testes antes de aprovar a correção

1. Criar ambiente de staging com esquema equivalente e dados de teste não pessoais.
2. Executar testes do frontend, autenticação, CRUD administrativo, apuramento e votação.
3. Inspecionar funções `SECURITY DEFINER` e outras dependências de privilégios SQL.
4. Aplicar revogações apenas no staging e repetir os testes.
5. Confirmar que a consulta acima devolve zero grants de `TRUNCATE`/`TRIGGER` para os dois papéis.
6. Preparar backup, rollback e janela de implementação, para aprovação explícita antes de qualquer alteração na produção.

## Outros riscos separados

- `profiles.role DEFAULT 'admin'`: avaliar o fluxo de criação de perfis, sem alterar automaticamente o default.
- RPCs administrativas executáveis por `anon`: têm guardas `is_admin()` observadas; faltam testes comportamentais.
- Histórico remoto de migrations: não sincronizar sem reconciliação por objeto.
