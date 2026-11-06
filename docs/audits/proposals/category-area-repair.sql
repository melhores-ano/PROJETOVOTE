-- PROPOSTA PARA TESTE ISOLADO. NÃO EXECUTAR EM PRODUÇÃO SEM APROVAÇÃO.
-- Não pertence a supabase/migrations enquanto o conflito de versão 0014 não for reconciliado.
-- Reparação limitada às três associações category -> category_areas.
begin;
do $$
declare
  v_program uuid;
  v_count integer;
begin
  select id into strict v_program
  from public.award_programs
  where slug = 'melhores-do-ano-portugal';

  select count(*) into v_count
  from public.categories c
  where c.award_program_id = v_program
    and c.slug in ('cafes', 'ginasios', 'saloes-de-beleza');
  if v_count <> 3 then
    raise exception 'CATEGORY_AREA_REPAIR: esperadas 3 categorias, encontradas %', v_count;
  end if;

  select count(*) into v_count
  from public.category_areas a
  where a.award_program_id = v_program
    and a.slug in ('restauracao-gastronomia', 'saude-bem-estar', 'beleza-estetica');
  if v_count <> 3 then
    raise exception 'CATEGORY_AREA_REPAIR: esperadas 3 areas, encontradas %', v_count;
  end if;

  if exists (
    select 1
    from public.categories c
    join public.category_areas a on a.id = c.area_id
    where c.award_program_id = v_program
      and c.slug in ('cafes', 'ginasios', 'saloes-de-beleza')
      and a.slug is distinct from
        case c.slug
          when 'cafes' then 'restauracao-gastronomia'
          when 'ginasios' then 'saude-bem-estar'
          when 'saloes-de-beleza' then 'beleza-estetica'
        end
  ) then
    raise exception 'CATEGORY_AREA_REPAIR: categoria associada a area inesperada; revisao manual obrigatoria';
  end if;

  -- Falha também se area_id apontar para um UUID sem correspondência, por precaução.
  if exists (
    select 1
    from public.categories c
    left join public.category_areas a on a.id = c.area_id
    where c.award_program_id = v_program
      and c.slug in ('cafes', 'ginasios', 'saloes-de-beleza')
      and c.area_id is not null and a.id is null
  ) then
    raise exception 'CATEGORY_AREA_REPAIR: area_id sem referencia valida';
  end if;

  update public.categories c
  set area_id = a.id
  from public.category_areas a
  where c.award_program_id = v_program
    and a.award_program_id = v_program
    and a.slug = case c.slug
      when 'cafes' then 'restauracao-gastronomia'
      when 'ginasios' then 'saude-bem-estar'
      when 'saloes-de-beleza' then 'beleza-estetica'
      else null
    end
    and c.slug in ('cafes', 'ginasios', 'saloes-de-beleza')
    and c.area_id is distinct from a.id;

  select count(*) into v_count
  from public.categories c
  join public.category_areas a on a.id = c.area_id
  where c.award_program_id = v_program
    and a.award_program_id = v_program
    and a.slug = case c.slug
      when 'cafes' then 'restauracao-gastronomia'
      when 'ginasios' then 'saude-bem-estar'
      when 'saloes-de-beleza' then 'beleza-estetica'
      else null
    end
    and c.slug in ('cafes', 'ginasios', 'saloes-de-beleza');
  if v_count <> 3 then
    raise exception 'CATEGORY_AREA_REPAIR: validacao final falhou (%/3)', v_count;
  end if;
end $$;
commit;
