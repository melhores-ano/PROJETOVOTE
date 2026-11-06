# Auditoria de autorização administrativa e Storage — 2026-11-06

**Escopo:** leitura de metadados e definições SQL do projeto Supabase `agtgtcnwfrskvpegxoir`. Nenhum dado ou permissão alterado.

## RPCs administrativas de apuramento

As seguintes funções remotas são `SECURITY DEFINER`, estão acessíveis via `EXECUTE` ao papel `anon` e **contêm** referência a `is_admin()` e instrução `RAISE EXCEPTION`:

| Função | Argumentos |
|---|---|
| `get_admin_tally` | `p_campaign_id uuid, p_city_id uuid, p_category_id uuid` |
| `get_admin_modality_tally` | `p_campaign_id uuid, p_city_id uuid, p_category_id uuid, p_modality_id uuid` |
| `get_admin_vote_overview` | `p_campaign_id uuid` |
| `get_admin_vote_timeline` | `p_campaign_id uuid, p_days integer` |

A presença textual da guarda não prova, isoladamente, que todos os caminhos de execução estejam protegidos. **Ainda não foram executados testes de invocação sob o papel anónimo.**

A definição remota de `public.is_admin()` foi inspecionada:

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$function$
```

Assim, o predicado usa `auth.uid()` e os papéis guardados em `profiles`, em vez de aceitar apenas a existência de uma sessão. Isto é um indício positivo, sujeito à revisão das políticas de escrita de `profiles` e dos corpos completos das RPCs.

## Políticas de Storage observadas

Em `storage.objects`, foram identificadas oito policies:

- `public read images` e `public read magazine images`: `SELECT` para `anon` e `authenticated`, limitado aos buckets públicos correspondentes.
- `admin upload images` e `admin upload magazine images`: `INSERT` para `authenticated` com `WITH CHECK` que exige bucket permitido e `is_admin()`.
- `admin update images` e `admin update magazine images`: `UPDATE` para `authenticated` com `USING` que exige bucket permitido e `is_admin()`.
- `admin delete images` e `admin delete magazine images`: `DELETE` para `authenticated` com `USING` que exige bucket permitido e `is_admin()`.

Os quatro buckets gerais são `city-images`, `business-logos`, `business-covers`, `sponsor-logos`; o bucket editorial é `magazine-images`.

**Nota:** não foi verificado o comportamento de `UPDATE` em teste de execução; avaliar `WITH CHECK` explícito conforme as regras de acesso pretendidas, sem assumir uma falha explorável.

## Avaliação atual

- **Evidência positiva:** as quatro RPCs administrativas examinadas referenciam a guarda `is_admin()`; a guarda verifica `auth.uid()` contra `profiles.role`.
- **Evidência positiva:** uploads, atualizações e eliminações de Storage exigem `authenticated` e `is_admin()` nas policies inspecionadas.
- **Risco residual:** `anon` ainda tem `EXECUTE` nas RPCs administrativas; rever privilégios mínimos e chamadas legítimas antes de propor `REVOKE`.
- **Pendente:** testar as RPCs como anónimo em ambiente seguro, auditar escrita em `profiles`, rever corpos completos das funções e as Edge Functions de votação.

## Próximos passos

1. Inspecionar policies e grants de `public.profiles`, incluindo qualquer função que permita alterar `role`.
2. Auditar funções administrativas completas e dependências de `is_admin()`.
3. Construir testes de autorização que não modifiquem dados de produção.
4. Preparar alterações de permissões numa migration nova **somente após** aprovação do plano e validação em ambiente isolado.
