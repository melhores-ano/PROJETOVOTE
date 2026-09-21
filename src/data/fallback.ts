/**
 * Dados de recurso para preview imediato.
 *
 * FONTE DE VERDADE = base de dados Supabase.
 * Este ficheiro existe APENAS para que o live preview renderize de imediato
 * antes de o Supabase estar configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 * Assim que o Supabase responder, os hooks ignoram estes dados.
 * Nenhum componente deve importar isto directamente — usar os hooks em src/hooks/.
 */
import type { Business, Campaign, Category, City, SiteConfig, Sponsor } from '../types/database';

export const fallbackConfig: SiteConfig = {
  siteName: 'Prémios Melhores do Ano Portugal',
  activeCampaignSlug: 'premios-melhores-do-ano-portugal-2026',
  maintenanceMode: false,
  resultsVisible: false,
  votingRules: 'Um voto por pessoa, por categoria, por cidade e por edição.',
  branding: {
    tagline: 'A sua cidade. A sua escolha. O seu voto.',
    primaryCta: 'Escolher a minha cidade',
  },
};

export const fallbackCampaign: Campaign = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Prémios Melhores do Ano Portugal 2026',
  slug: 'premios-melhores-do-ano-portugal-2026',
  year: 2026,
  start_at: '2026-03-01T00:00:00Z',
  end_at: '2026-12-15T23:59:59Z',
  status: 'votacao',
  results_public: false,
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-10T00:00:00Z',
};

export const fallbackCities: City[] = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Lisboa', slug: 'lisboa', district: 'Lisboa', description: 'A capital à beira-Tejo: bairros históricos, miradouros e uma cena gastronómica vibrante.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Porto', slug: 'porto', district: 'Porto', description: 'A Invicta: caves do vinho do Porto, ribeira classificada e comércio de bairro com alma.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Braga', slug: 'braga', district: 'Braga', description: 'A cidade mais antiga de Portugal, jovem de espírito e cheia de talento local.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Coimbra', slug: 'coimbra', district: 'Coimbra', description: 'Cidade do conhecimento, do fado e das repúblicas estudantis.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000005', name: 'Faro', slug: 'faro', district: 'Faro', description: 'Porta de entrada do Algarve, entre a Ria Formosa e o centro histórico.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000006', name: 'Aveiro', slug: 'aveiro', district: 'Aveiro', description: 'A Veneza de Portugal: canais, moliceiros e ovos-moles.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000007', name: 'Guimarães', slug: 'guimaraes', district: 'Braga', description: 'O berço da nação, com um centro histórico Património Mundial.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000008', name: 'Viseu', slug: 'viseu', district: 'Viseu', description: 'Cidade-jardim do Dão, capital dos vinhos e da boa mesa beirã.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000009', name: 'Funchal', slug: 'funchal', district: 'Madeira', description: 'Anfiteatro atlântico de jardins, bordado e gastronomia madeirense.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000010', name: 'Évora', slug: 'evora', district: 'Évora', description: 'Museu a céu aberto no coração do Alentejo.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000011', name: 'Leiria', slug: 'leiria', district: 'Leiria', description: 'Cidade do Lis, entre o castelo medieval e as praias da costa de prata.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '10000000-0000-4000-8000-000000000012', name: 'Setúbal', slug: 'setubal', district: 'Setúbal', description: 'Entre o Sado e a Arrábida: choco frito, moscatel e golfinho-roaz.', image_url: null, active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
];

export const fallbackCategories: Category[] = [
  { id: '20000000-0000-4000-8000-000000000001', name: 'Barbearias', slug: 'barbearias', description: 'Corte, barba e cuidado de cavalheiro.', icon: 'Scissors', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '20000000-0000-4000-8000-000000000002', name: 'Restaurantes', slug: 'restaurantes', description: 'Da tasca tradicional à alta gastronomia.', icon: 'UtensilsCrossed', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '20000000-0000-4000-8000-000000000003', name: 'Pastelarias', slug: 'pastelarias', description: 'Doçaria, padaria artesanal e pastel de nata.', icon: 'Croissant', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '20000000-0000-4000-8000-000000000004', name: 'Cafés', slug: 'cafes', description: 'A bica, o café de bairro e a esplanada.', icon: 'Coffee', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '20000000-0000-4000-8000-000000000005', name: 'Salões de Beleza', slug: 'saloes-de-beleza', description: 'Cabelo, estética e bem-estar.', icon: 'Sparkles', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '20000000-0000-4000-8000-000000000006', name: 'Ginásios', slug: 'ginasios', description: 'Fitness, cross training e desporto local.', icon: 'Dumbbell', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '20000000-0000-4000-8000-000000000007', name: 'Lojas Locais', slug: 'lojas-locais', description: 'Comércio de rua, mercearias e artesanato.', icon: 'Store', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '20000000-0000-4000-8000-000000000008', name: 'Hotelaria', slug: 'hotelaria', description: 'Hotéis, alojamento local e turismo rural.', icon: 'BedDouble', active: true, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
];

export const fallbackBusinesses: Business[] = [
  {
    id: '30000000-0000-4000-8000-000000000001', name: 'Barbearia do Largo', slug: 'barbearia-do-largo',
    description: 'Barbearia clássica no coração de Braga. Corte de precisão, barba com toalha quente e atendimento de bairro desde 1998.',
    logo_url: null, cover_url: null, website: 'https://exemplo.pt', instagram: 'https://instagram.com', facebook: null,
    google_maps_url: null, phone: '+351 253 000 111', email: 'geral@exemplo.pt', address: 'Largo do Paço 12, Braga',
    city_id: '10000000-0000-4000-8000-000000000003', active: true, verified: true,
    created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z',
  },
  {
    id: '30000000-0000-4000-8000-000000000002', name: 'Navalha de Ouro', slug: 'navalha-de-ouro',
    description: 'Estilo contemporâneo, barbeiros premiados e ambiente de clube de cavalheiros.',
    logo_url: null, cover_url: null, website: null, instagram: null, facebook: null,
    google_maps_url: null, phone: '+351 253 000 222', email: null, address: 'Rua de São Marcos 45, Braga',
    city_id: '10000000-0000-4000-8000-000000000003', active: true, verified: true,
    created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z',
  },
  {
    id: '30000000-0000-4000-8000-000000000003', name: 'Corte & Tradição', slug: 'corte-e-tradicao',
    description: 'Três gerações de barbeiros. O corte à antiga com higiene e rigor modernos.',
    logo_url: null, cover_url: null, website: null, instagram: null, facebook: null,
    google_maps_url: null, phone: '+351 253 000 333', email: null, address: 'Avenida da Liberdade 88, Braga',
    city_id: '10000000-0000-4000-8000-000000000003', active: true, verified: false,
    created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z',
  },
  {
    id: '30000000-0000-4000-8000-000000000004', name: 'Tasca da Ribeira', slug: 'tasca-da-ribeira',
    description: 'Cozinha tradicional portuense: tripas à moda do Porto, rojões e vinho verde da casa.',
    logo_url: null, cover_url: null, website: null, instagram: null, facebook: null,
    google_maps_url: null, phone: '+351 222 000 444', email: null, address: 'Cais da Ribeira 21, Porto',
    city_id: '10000000-0000-4000-8000-000000000002', active: true, verified: true,
    created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z',
  },
  {
    id: '30000000-0000-4000-8000-000000000005', name: 'Forno da Sé', slug: 'forno-da-se',
    description: 'Pastelaria artesanal em Lisboa. Pastéis de nata saídos do forno a cada hora.',
    logo_url: null, cover_url: null, website: null, instagram: null, facebook: null,
    google_maps_url: null, phone: '+351 213 000 555', email: null, address: 'Rua Augusta 120, Lisboa',
    city_id: '10000000-0000-4000-8000-000000000001', active: true, verified: true,
    created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z',
  },
];

export const fallbackSponsors: Sponsor[] = [
  { id: '40000000-0000-4000-8000-000000000001', name: 'Banco Atlântico', slug: 'banco-atlantico', logo_url: null, website: null, tier: 'ouro', active: true, position: 1, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
  { id: '40000000-0000-4000-8000-000000000002', name: 'Pastéis & C.ª', slug: 'pasteis-e-c', logo_url: null, website: null, tier: 'prata', active: true, position: 2, created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z' },
];
