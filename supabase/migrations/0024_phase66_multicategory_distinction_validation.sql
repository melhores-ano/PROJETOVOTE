-- FASE 6.6 — distinções multicategoria
-- Corrige somente a validação modalidade x categoria.
-- award_modality_categories é a autoridade N:N.
create or replace function public.award_distinctions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_program uuid;
  v_modality_program uuid;
  v_modality_category uuid;
  v_category_program uuid;
  v_program_country text;
  v_city_country text;
  v_business_city uuid;
begin
  select c.award_program_id into v_campaign_program
  from public.campaigns c where c.id = new.campaign_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: campaign_id % não existe.', new.campaign_id
      using errcode = '23503';
  end if;

  select m.award_program_id, m.category_id into v_modality_program, v_modality_category
  from public.award_modalities m where m.id = new.modality_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: modality_id % não existe.', new.modality_id
      using errcode = '23503';
  end if;

  select c.award_program_id into v_category_program
  from public.categories c where c.id = new.category_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: category_id % não existe.', new.category_id
      using errcode = '23503';
  end if;

    -- 1. Modalidade deve estar associada à categoria através da relação N:N.
    if not exists (
        select 1
        from public.award_modality_categories amc
        where amc.modality_id = new.modality_id
          and amc.category_id = new.category_id
    ) then
        raise exception 'FASE5C38_CATEGORY_MISMATCH: modalidade % não está associada à categoria %.',
            new.modality_id, new.category_id
            using errcode = '23514';
    end if;

  -- 2. Programas cruzados (campanha × modalidade × categoria) → recusa.
  if v_campaign_program is distinct from v_modality_program
     or v_campaign_program is distinct from v_category_program then
    raise exception 'FASE5C38_PROGRAM_MISMATCH: campanha (programa=%) × modalidade (programa=%) × categoria (programa=%) incompatíveis. Cruzamento entre programas recusado.',
      v_campaign_program, v_modality_program, v_category_program
      using errcode = '23514';
  end if;

  -- 3. Cidade de outro país/programa → recusa.
  select p.country_code into v_program_country
  from public.award_programs p where p.id = v_campaign_program;
  select ci.country_code into v_city_country
  from public.cities ci where ci.id = new.city_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: city_id % não existe.', new.city_id
      using errcode = '23503';
  end if;
  if v_city_country is distinct from v_program_country then
    raise exception 'FASE5C38_COUNTRY_MISMATCH: cidade % (país=%) fora do país do programa (%).',
      new.city_id, v_city_country, v_program_country
      using errcode = '23514';
  end if;

  -- 4. Empresa fora da cidade → recusa (country_code deriva de city_id).
  select b.city_id into v_business_city
  from public.businesses b where b.id = new.business_id;
  if not found then
    raise exception 'FASE5C38_COHERENCE: business_id % não existe.', new.business_id
      using errcode = '23503';
  end if;
  if v_business_city is distinct from new.city_id then
    raise exception 'FASE5C38_CITY_MISMATCH: empresa % estabelecida na cidade %, não em %.',
      new.business_id, v_business_city, new.city_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;