-- ============================================================================
-- FASE 6.5 — Catálogo-base de Áreas e Categorias do programa
-- "Melhores do Ano Portugal" (award_programs.slug = 'melhores-do-ano-portugal')
-- ============================================================================
-- Natureza: ADITIVA · TRANSACIONAL · IDEMPOTENTE · FAIL-CLOSED · PROGRAM-SCOPED.
--
-- ESCOPO DESTA MIGRATION
--   * category_areas: reutilizar "Restauração & Gastronomia"; criar apenas as
--     áreas em falta (Beleza & Estética, Saúde & Bem-Estar, Casa, Construção
--     & Serviços, Automóvel & Mobilidade, Comércio & Lojas, Turismo &
--     Hotelaria, Serviços Profissionais), com sort_order 10..80.
--   * categories: fixar `area_id` das 8 categorias existentes (IDs, slugs e
--     award_program_id INTOCADOS) e criar SOMENTE as categorias em falta
--     (locale='pt-PT', active=true, associadas à área correta).
--
-- FORA DE ESCOPO (NÃO TOCADO)
--   campaign_entries, businesses, participant_invitations,
--   votes, vote_attempts, vote_adjustments,
--   modality_votes, modality_vote_attempts,
--   cast-vote, cast-modality-vote, RPCs de ranking/resultados, RLS.
--
-- PRESERVAÇÃO OBRIGATÓRIA
--   8 categorias existentes (IDs intocados):
--     Restaurantes · Cafés · Pastelarias · Barbearias ·
--     Salões de Beleza · Ginásios · Hotelaria · Lojas Locais
--   Só `categories.area_id` pode ser alterado (e apenas se distinto).
--   Nenhum DELETE / DROP / TRUNCATE é executado.
--
-- PRESSUPOSTOS DE SCHEMA (a confirmar em 0011..0013 antes de aplicar)
--   category_areas(id, award_program_id, name, slug, sort_order, active)
--   categories(id, award_program_id, name, slug, locale, area_id, active)
--   Se algum nome divergir, a transação ABORTA na compilação (fail-closed).
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) RESOLVER award_program_id PELO SLUG  ·  FAIL-CLOSED
-- ---------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
begin
  select id
    into v_program_id
    from award_programs
   where slug = 'melhores-do-ano-portugal'
   limit 1;

  if v_program_id is null then
    raise exception
      'FASE 6.5 — programa "melhores-do-ano-portugal" inexistente. Migration abortada (fail-closed).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) ÁREAS — preservar "Restauração & Gastronomia"; criar só as em falta
-- ---------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
    from award_programs
   where slug = 'melhores-do-ano-portugal'
   limit 1;

  insert into category_areas (award_program_id, name, slug, sort_order, active)
  select v_program_id, d.name, d.slug, d.sort_order, true
    from (values
      ('Restauração & Gastronomia',   'restauracao-gastronomia',   10),
      ('Beleza & Estética',           'beleza-estetica',           20),
      ('Saúde & Bem-Estar',           'saude-bem-estar',           30),
      ('Casa, Construção & Serviços', 'casa-construcao-servicos',  40),
      ('Automóvel & Mobilidade',      'automovel-mobilidade',      50),
      ('Comércio & Lojas',            'comercio-lojas',            60),
      ('Turismo & Hotelaria',         'turismo-hotelaria',         70),
      ('Serviços Profissionais',      'servicos-profissionais',    80)
    ) as d(name, slug, sort_order)
   where not exists (
     select 1
       from category_areas a
      where a.award_program_id = v_program_id
        and a.slug = d.slug
   );
end $$;

-- ---------------------------------------------------------------------------
-- 2) CATEGORIAS EXISTENTES — fixar area_id (IDs intocados).
--    Match por nome normalizado (case-insensitive, trim) para absorver
--    variantes de acentuação/capitalização sem tocar nos IDs.
-- ---------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
    from award_programs
   where slug = 'melhores-do-ano-portugal'
   limit 1;

  update categories c
     set area_id = a.id
    from category_areas a
   where c.award_program_id = v_program_id
     and a.award_program_id = v_program_id
     and (
       (lower(btrim(c.name)) in ('restaurantes','cafés','cafes','pastelarias')
          and a.slug = 'restauracao-gastronomia')
       or
       (lower(btrim(c.name)) in ('barbearias','salões de beleza','saloes de beleza')
          and a.slug = 'beleza-estetica')
       or
       (lower(btrim(c.name)) in ('ginásios','ginasios')
          and a.slug = 'saude-bem-estar')
       or
       (lower(btrim(c.name)) = 'hotelaria'
          and a.slug = 'turismo-hotelaria')
       or
       (lower(btrim(c.name)) = 'lojas locais'
          and a.slug = 'comercio-lojas')
     )
     and c.area_id is distinct from a.id;
end $$;

-- ---------------------------------------------------------------------------
-- 3) CATEGORIAS NOVAS — criar SOMENTE as que não existem no programa
--    (locale='pt-PT', active=true, associadas à área correta).
--    Se `categories.slug` for UNIQUE global em 0011, e outro programa já
--    tiver um slug colidente, a transação ABORTA (fail-closed).
-- ---------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
begin
  select id into v_program_id
    from award_programs
   where slug = 'melhores-do-ano-portugal'
   limit 1;

  insert into categories (award_program_id, name, slug, locale, area_id, active)
  select v_program_id, d.name, d.slug, 'pt-PT', a.id, true
    from (values
      -- Restauração & Gastronomia
      ('Pizzarias',                'pizzarias',                'restauracao-gastronomia'),
      ('Hamburguerias',            'hamburguerias',            'restauracao-gastronomia'),
      -- Beleza & Estética
      ('Cabeleireiros',            'cabeleireiros',            'beleza-estetica'),
      ('Centros de Estética',      'centros-de-estetica',      'beleza-estetica'),
      ('Manicure & Unhas',         'manicure-unhas',           'beleza-estetica'),
      -- Saúde & Bem-Estar
      ('Clínicas Dentárias',       'clinicas-dentarias',       'saude-bem-estar'),
      ('Fisioterapia',             'fisioterapia',             'saude-bem-estar'),
      ('Nutrição',                 'nutricao',                 'saude-bem-estar'),
      ('Clínicas de Saúde',        'clinicas-de-saude',        'saude-bem-estar'),
      -- Casa, Construção & Serviços
      ('Construção & Remodelação', 'construcao-remodelacao',   'casa-construcao-servicos'),
      ('Empresas de Limpeza',      'empresas-de-limpeza',      'casa-construcao-servicos'),
      ('Eletricistas',             'eletricistas',             'casa-construcao-servicos'),
      ('Canalizadores',            'canalizadores',            'casa-construcao-servicos'),
      ('Carpintarias',             'carpintarias',             'casa-construcao-servicos'),
      -- Automóvel & Mobilidade
      ('Oficinas Automóveis',      'oficinas-automoveis',      'automovel-mobilidade'),
      ('Stands Automóveis',        'stands-automoveis',        'automovel-mobilidade'),
      ('Pneus & Serviços Auto',    'pneus-servicos-auto',      'automovel-mobilidade'),
      ('Rent-a-Car',               'rent-a-car',               'automovel-mobilidade'),
      -- Comércio & Lojas
      ('Lojas de Roupa',           'lojas-de-roupa',           'comercio-lojas'),
      ('Lojas de Calçado',         'lojas-de-calcado',         'comercio-lojas'),
      ('Floristas',                'floristas',                'comercio-lojas'),
      ('Ourivesarias',             'ourivesarias',             'comercio-lojas'),
      -- Turismo & Hotelaria
      ('Alojamento Local',         'alojamento-local',         'turismo-hotelaria'),
      ('Agências de Viagens',      'agencias-de-viagens',      'turismo-hotelaria'),
      ('Turismo & Experiências',   'turismo-experiencias',     'turismo-hotelaria'),
      -- Serviços Profissionais
      ('Imobiliárias',             'imobiliarias',             'servicos-profissionais'),
      ('Contabilidade',            'contabilidade',            'servicos-profissionais'),
      ('Seguros',                  'seguros',                  'servicos-profissionais'),
      ('Advocacia',                'advocacia',                'servicos-profissionais'),
      ('Marketing & Publicidade',  'marketing-publicidade',    'servicos-profissionais'),
      ('Informática & Tecnologia', 'informatica-tecnologia',   'servicos-profissionais'),
      ('Fotografia & Vídeo',       'fotografia-video',         'servicos-profissionais')
    ) as d(name, slug, area_slug)
    join category_areas a
      on a.award_program_id = v_program_id
     and a.slug = d.area_slug
   where not exists (
     select 1
       from categories c
      where c.award_program_id = v_program_id
        and c.slug = d.slug
   );
end $$;

-- ---------------------------------------------------------------------------
-- 4) VALIDAÇÃO FAIL-CLOSED — as 8 categorias existentes devem ter área.
-- ---------------------------------------------------------------------------
do $$
declare
  v_program_id uuid;
  v_missing    int;
begin
  select id into v_program_id
    from award_programs
   where slug = 'melhores-do-ano-portugal'
   limit 1;

  select count(*) into v_missing
    from categories c
   where c.award_program_id = v_program_id
     and c.name in (
       'Restaurantes', 'Cafés', 'Pastelarias', 'Barbearias',
       'Salões de Beleza', 'Ginásios', 'Hotelaria', 'Lojas Locais'
     )
     and c.area_id is null;

  if v_missing > 0 then
    raise exception
      'FASE 6.5 — % categoria(s) existente(s) sem area_id atribuído. Migration abortada (fail-closed).',
      v_missing;
  end if;
end $$;

commit;
