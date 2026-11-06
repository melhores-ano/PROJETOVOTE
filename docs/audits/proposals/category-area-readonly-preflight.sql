-- Auditoria SOMENTE LEITURA: executar manualmente no SQL Editor do Supabase.
-- Não modifica dados, não regista migrations e não desbloqueia db push.
-- A execução em produção deve ser limitada a SELECT.
select version, name
from supabase_migrations.schema_migrations
order by version;

-- Três associações esperadas. 'missing', 'correct' ou 'unexpected'.
with expected(slug, area_slug) as (
  values ('cafes', 'restauracao-gastronomia'),
         ('ginasios', 'saude-bem-estar'),
         ('saloes-de-beleza', 'beleza-estetica')
)
select e.slug as category_slug, e.area_slug as expected_area_slug,
       c.id as category_id, a.slug as actual_area_slug,
       case when c.id is null then 'missing_category'
            when c.area_id is null then 'missing_area_assignment'
            when a.slug = e.area_slug then 'correct'
            else 'unexpected_area_assignment' end as status
from expected e
left join public.award_programs p on p.slug = 'melhores-do-ano-portugal'
left join public.categories c on c.slug = e.slug and c.award_program_id = p.id
left join public.category_areas a on a.id = c.area_id
order by e.slug;

-- Contagem de categorias sem área, por programa; nenhuma escrita.
select p.slug as program_slug, count(*) as total_categories,
       count(*) filter (where c.area_id is null) as without_area
from public.award_programs p
join public.categories c on c.award_program_id = p.id
where p.slug = 'melhores-do-ano-portugal'
group by p.slug;
