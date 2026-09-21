-- ============================================================================
-- Prémios Melhores do Ano Portugal — SEED inicial (idempotente)
-- Edição 2026 + 12 cidades + 8 categorias + configurações do sítio.
-- Executar DEPOIS da migração 0001.
-- ============================================================================

-- Campanha 2026 ---------------------------------------------------------------
insert into public.campaigns (name, slug, year, start_at, end_at, status, results_public)
values (
  'Prémios Melhores do Ano Portugal 2026',
  'premios-melhores-do-ano-portugal-2026',
  2026,
  '2026-03-01T00:00:00Z',
  '2026-12-15T23:59:59Z',
  'votacao',
  false
)
on conflict (slug) do update set
  name = excluded.name,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  status = excluded.status;

-- Cidades --------------------------------------------------------------------
insert into public.cities (name, slug, district, description, active) values
  ('Lisboa', 'lisboa', 'Lisboa', 'A capital à beira-Tejo: bairros históricos, miradouros e uma cena gastronómica vibrante.', true),
  ('Porto', 'porto', 'Porto', 'A Invicta: caves do vinho do Porto, ribeira classificada e comércio de bairro com alma.', true),
  ('Braga', 'braga', 'Braga', 'A cidade mais antiga de Portugal, jovem de espírito e cheia de talento local.', true),
  ('Coimbra', 'coimbra', 'Coimbra', 'Cidade do conhecimento, do fado e das repúblicas estudantis.', true),
  ('Faro', 'faro', 'Faro', 'Porta de entrada do Algarve, entre a Ria Formosa e o centro histórico.', true),
  ('Aveiro', 'aveiro', 'Aveiro', 'A Veneza de Portugal: canais, moliceiros e ovos-moles.', true),
  ('Guimarães', 'guimaraes', 'Braga', 'O berço da nação, com um centro histórico Património Mundial.', true),
  ('Viseu', 'viseu', 'Viseu', 'Cidade-jardim do Dão, capital dos vinhos e da boa mesa beirã.', true),
  ('Funchal', 'funchal', 'Madeira', 'Anfiteatro atlântico de jardins, bordado e gastronomia madeirense.', true),
  ('Évora', 'evora', 'Évora', 'Museu a céu aberto no coração do Alentejo.', true),
  ('Leiria', 'leiria', 'Leiria', 'Cidade do Lis, entre o castelo medieval e as praias da costa de prata.', true),
  ('Setúbal', 'setubal', 'Setúbal', 'Entre o Sado e a Arrábida: choco frito, moscatel e golfinho-roaz.', true)
on conflict (slug) do update set
  name = excluded.name,
  district = excluded.district,
  description = excluded.description,
  active = excluded.active;

-- Categorias -------------------------------------------------------------------
insert into public.categories (name, slug, description, icon, active) values
  ('Barbearias', 'barbearias', 'Corte, barba e cuidado de cavalheiro.', 'Scissors', true),
  ('Restaurantes', 'restaurantes', 'Da tasca tradicional à alta gastronomia.', 'UtensilsCrossed', true),
  ('Pastelarias', 'pastelarias', 'Doçaria, padaria artesanal e pastel de nata.', 'Croissant', true),
  ('Cafés', 'cafes', 'A bica, o café de bairro e a esplanada.', 'Coffee', true),
  ('Salões de Beleza', 'saloes-de-beleza', 'Cabelo, estética e bem-estar.', 'Sparkles', true),
  ('Ginásios', 'ginasios', 'Fitness, treino funcional e desporto local.', 'Dumbbell', true),
  ('Lojas Locais', 'lojas-locais', 'Comércio de rua, mercearias e artesanato.', 'Store', true),
  ('Hotelaria', 'hotelaria', 'Hotéis, alojamento local e turismo rural.', 'BedDouble', true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  active = excluded.active;

-- Configurações do sítio ---------------------------------------------------------
insert into public.site_settings (key, value, description) values
  ('site_name', '"Prémios Melhores do Ano Portugal"', 'Nome oficial do sítio.'),
  ('active_campaign_slug', '"premios-melhores-do-ano-portugal-2026"', 'Slug da edição activa.'),
  ('maintenance_mode', 'false', 'Quando true, o sítio público mostra página de manutenção.'),
  ('results_visible', 'false', 'Quando true, a página de resultados fica pública.'),
  ('voting_rules', '"Um voto por pessoa, por categoria, por cidade e por edição."', 'Resumo das regras de votação.'),
  ('branding', '{"tagline": "A sua cidade. A sua escolha. O seu voto.", "primaryCta": "Escolher a minha cidade"}', 'Textos de marca.')
on conflict (key) do nothing;

-- Negócios de exemplo (Braga · Barbearias) ---------------------------------------
-- Nota: servem apenas para validar o fluxo cidade → categoria → participantes.
with braga as (select id from public.cities where slug = 'braga' limit 1)
insert into public.businesses (name, slug, description, phone, address, city_id, active, verified)
select
  x.name, x.slug, x.description, x.phone, x.address, braga.id, true, true
from braga,
(values
  ('Barbearia do Largo', 'barbearia-do-largo', 'Barbearia clássica no coração de Braga. Corte de precisão e barba com toalha quente desde 1998.', '+351 253 000 111', 'Largo do Paço 12, Braga'),
  ('Navalha de Ouro', 'navalha-de-ouro', 'Estilo contemporâneo, barbeiros premiados e ambiente de clube de cavalheiros.', '+351 253 000 222', 'Rua de São Marcos 45, Braga'),
  ('Corte & Tradição', 'corte-e-tradicao', 'Três gerações de barbeiros. O corte à antiga com rigor moderno.', '+351 253 000 333', 'Avenida da Liberdade 88, Braga')
) as x(name, slug, description, phone, address)
on conflict (slug) do nothing;

-- Ligar negócios às categorias + inscrição na campanha 2026 ----------------------
with
  camp as (select id from public.campaigns where slug = 'premios-melhores-do-ano-portugal-2026' limit 1),
  cat as (select id from public.categories where slug = 'barbearias' limit 1)
insert into public.business_categories (business_id, category_id)
select b.id, cat.id
from public.businesses b, cat
where b.slug in ('barbearia-do-largo', 'navalha-de-ouro', 'corte-e-tradicao')
on conflict do nothing;

with
  camp as (select id from public.campaigns where slug = 'premios-melhores-do-ano-portugal-2026' limit 1),
  cat as (select id from public.categories where slug = 'barbearias' limit 1)
insert into public.campaign_entries (campaign_id, city_id, category_id, business_id, active, featured, position)
select camp.id, b.city_id, cat.id, b.id, true,
  case when b.slug = 'barbearia-do-largo' then true else false end,
  case when b.slug = 'barbearia-do-largo' then 1 when b.slug = 'navalha-de-ouro' then 2 else 3 end
from public.businesses b, camp, cat
where b.slug in ('barbearia-do-largo', 'navalha-de-ouro', 'corte-e-tradicao')
on conflict (campaign_id, city_id, category_id, business_id) do nothing;

-- Negócios de exemplo (Braga · Restaurantes) -------------------------------------
-- FASE 4C: segunda categoria de teste multicategoria na cidade de Braga.
-- Reutiliza campanha 'premios-melhores-do-ano-portugal-2026', cidade 'braga'
-- e categoria 'restaurantes'. Idempotente via ON CONFLICT (slug) DO NOTHING.
with braga as (select id from public.cities where slug = 'braga' limit 1)
insert into public.businesses (name, slug, description, phone, address, city_id, active, verified)
select
  x.name, x.slug, x.description, x.phone, x.address, braga.id, true, true
from braga,
(values
  ('Restaurante Sabores do Minho', 'restaurante-sabores-do-minho', 'Cozinha tradicional minhota com produtos do mercado de Braga. Arroz de pato, bacalhau à Braga e vinho verde da região.', '+351 253 100 111', 'Rua do Souto 27, Braga'),
  ('Mesa de Braga', 'mesa-de-braga', 'Cozinha de autor com raízes minhotas. Menu de degustação sazonal e carta de vinhos do Cávado.', '+351 253 100 222', 'Praça da República 14, Braga'),
  ('Cantinho Minhoto', 'cantinho-minhoto', 'Tasca familiar no centro histórico de Braga. Petiscos, caldo verde e rojões à moda do Minho.', '+351 253 100 333', 'Rua de São João 63, Braga')
) as x(name, slug, description, phone, address)
on conflict (slug) do nothing;

-- Ligar restaurantes às categorias + inscrição na campanha 2026 ------------------
with
  camp as (select id from public.campaigns where slug = 'premios-melhores-do-ano-portugal-2026' limit 1),
  cat as (select id from public.categories where slug = 'restaurantes' limit 1)
insert into public.business_categories (business_id, category_id)
select b.id, cat.id
from public.businesses b, cat
where b.slug in ('restaurante-sabores-do-minho', 'mesa-de-braga', 'cantinho-minhoto')
on conflict do nothing;

with
  camp as (select id from public.campaigns where slug = 'premios-melhores-do-ano-portugal-2026' limit 1),
  cat as (select id from public.categories where slug = 'restaurantes' limit 1)
insert into public.campaign_entries (campaign_id, city_id, category_id, business_id, active, featured, position)
select camp.id, b.city_id, cat.id, b.id, true,
  case when b.slug = 'restaurante-sabores-do-minho' then true else false end,
  case when b.slug = 'restaurante-sabores-do-minho' then 1 when b.slug = 'mesa-de-braga' then 2 else 3 end
from public.businesses b, camp, cat
where b.slug in ('restaurante-sabores-do-minho', 'mesa-de-braga', 'cantinho-minhoto')
on conflict (campaign_id, city_id, category_id, business_id) do nothing;

-- Patrocinadores ---------------------------------------------------------------
insert into public.sponsors (name, slug, tier, active, position) values
  ('Banco Atlântico', 'banco-atlantico', 'ouro', true, 1),
  ('Pastéis & C.ª', 'pasteis-e-ca', 'prata', true, 2)
on conflict (slug) do update set
  name = excluded.name,
  tier = excluded.tier,
  active = excluded.active,
  position = excluded.position;
