-- 0023 — suporte multicategoria na validação de votos de modalidades
-- Altera somente a validação categoria/modalidade.
-- award_modalities.category_id permanece legado.
-- award_modality_categories passa a ser a autoridade N:N.
-- Não altera votos principais, resultados, RLS ou antifraude.

create or replace function public.modality_votes_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_program uuid;
  v_modality_program uuid;
  v_modality_category uuid;
  v_modality_category_allowed boolean;
  v_modality_active boolean;
  v_category_program uuid;
  v_program_country text;
  v_city_country text;
  v_business_city uuid;
  v_entry_id uuid;
begin
  select c.award_program_id into v_campaign_program
  from public.campaigns c where c.id = new.campaign_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: campaign_id % não existe.', new.campaign_id
      using errcode = '23503';
  end if;

  select m.award_program_id, m.category_id, m.active
    into v_modality_program, v_modality_category, v_modality_active
  from public.award_modalities m where m.id = new.modality_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: modality_id % não existe.', new.modality_id
      using errcode = '23503';
  end if;

  select c.award_program_id into v_category_program
  from public.categories c where c.id = new.category_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: category_id % não existe.', new.category_id
      using errcode = '23503';
  end if;

  -- 1. Modalidade pertence a outra categoria → recusa.
  -- 1. Modalidade deve estar associada à categoria através da relação N:N.
  select exists (
    select 1
    from public.award_modality_categories amc
    where amc.modality_id = new.modality_id
      and amc.category_id = new.category_id
  ) into v_modality_category_allowed;

  if not v_modality_category_allowed then
    raise exception 'FASE5C39_CATEGORY_MISMATCH: modalidade % não está associada à categoria %.',
      new.modality_id, new.category_id
      using errcode = '23514';
  end if;

  -- 2. Programas cruzados → recusa.
  if v_campaign_program is distinct from v_modality_program
     or v_campaign_program is distinct from v_category_program then
    raise exception 'FASE5C39_PROGRAM_MISMATCH: campanha (programa=%) × modalidade (programa=%) × categoria (programa=%) incompatíveis. Cruzamento entre programas recusado.',
      v_campaign_program, v_modality_program, v_category_program
      using errcode = '23514';
  end if;

  -- 3. Cidade de outro país/programa → recusa.
  select p.country_code into v_program_country
  from public.award_programs p where p.id = v_campaign_program;
  select ci.country_code into v_city_country
  from public.cities ci where ci.id = new.city_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: city_id % não existe.', new.city_id
      using errcode = '23503';
  end if;
  if v_city_country is distinct from v_program_country then
    raise exception 'FASE5C39_COUNTRY_MISMATCH: cidade % (país=%) fora do país do programa (%).',
      new.city_id, v_city_country, v_program_country
      using errcode = '23514';
  end if;

  -- 4. Empresa fora da cidade → recusa.
  select b.city_id into v_business_city
  from public.businesses b where b.id = new.business_id;
  if not found then
    raise exception 'FASE5C39_COHERENCE: business_id % não existe.', new.business_id
      using errcode = '23503';
  end if;
  if v_business_city is distinct from new.city_id then
    raise exception 'FASE5C39_CITY_MISMATCH: empresa % estabelecida na cidade %, não em %.',
      new.business_id, v_business_city, new.city_id
      using errcode = '23514';
  end if;

  -- 5. Sem participação activa → recusa (requisito do modelo principal).
  select ce.id into v_entry_id
  from public.campaign_entries ce
  where ce.campaign_id = new.campaign_id
    and ce.city_id = new.city_id
    and ce.category_id = new.category_id
    and ce.business_id = new.business_id
    and ce.active = true
  limit 1;
  if not found then
    raise exception 'FASE5C39_NO_PARTICIPATION: empresa % sem participação activa em campanha % × cidade % × categoria %.',
      new.business_id, new.campaign_id, new.city_id, new.category_id
      using errcode = '23514';
  end if;

  -- Preenche campaign_entry_id quando omitido (a Edge envia sempre; este
  -- fallback mantém integridade para escrita via service_role).
  if new.campaign_entry_id is null then
    new.campaign_entry_id := v_entry_id;
  end if;

  -- 6. Modalidade inativa → recusa.
  if v_modality_active is not true then
    raise exception 'FASE5C39_MODALITY_INACTIVE: modalidade % inativa — voto recusado.',
      new.modality_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;
