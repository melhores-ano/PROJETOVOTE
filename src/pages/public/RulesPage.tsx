import { ScrollText } from 'lucide-react';
import { useActiveCampaign } from '../../hooks/useDirectory';
import { SectionHeading } from '../../components/ui';

const SECTIONS = [
  { title: '1. Objecto', body: 'Os Prémios Melhores do Ano Portugal distinguem anualmente os melhores negócios locais por cidade e categoria, através de votação popular aberta a todas as pessoas em Portugal.' },
  { title: '2. Edições', body: 'Cada edição anual (ex.: 2026, 2027, 2028) constitui uma campanha autónoma, com período de votação, participantes e resultados próprios. As edições não transitam votos entre si.' },
  { title: '3. Participantes', body: 'Os negócios participantes são registados por cidade e categoria pela organização. Apenas negócios activos e verificados podem ser nomeados. A organização pode remover participantes em caso de encerramento, fraude ou violação das regras.' },
  { title: '4. Regras de votação (Fase 2)', body: 'Cada pessoa dispõe de um voto por categoria, por cidade e por edição — pode votar em categorias diferentes, mas nunca duas vezes na mesma categoria. Não é necessário criar conta. A votação passa por validação no servidor (incluindo verificação anti-robôs quando activa) e os duplicados são bloqueados pela base de dados. São aplicados limites por dispositivo e rede, sem armazenamento de endereços IP em texto claro.' },
  { title: '5. Auditoria e resultados', body: 'Os resultados são apurados electronicamente e sujeitos a verificação antes da publicação. A página de resultados só se torna pública quando a edição for encerrada e auditada.' },
  { title: '6. Conduta', body: 'É proibida qualquer tentativa de manipulação da votação, incluindo voto automatizado, compra de votos ou falsificação de identidade. Tentativas detectadas serão registadas e os votos inválidos anulados.' },
  { title: '7. Dados pessoais', body: 'O tratamento de dados rege-se pela Política de Privacidade. A votação não exige identificação pessoal; os registos técnicos utilizam apenas resumos criptográficos (hashes).' },
  { title: '8. Contactos', body: 'Questões sobre o regulamento devem ser dirigidas através da página de Contactos.' },
];

export default function RulesPage() {
  const campaignQuery = useActiveCampaign();
  const editionYear = campaignQuery.data?.year ?? 2026;
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-6 sm:py-16">
      <SectionHeading
        eyebrow="Regras oficiais"
        title={<>Regulamento {editionYear}</>}
        description="As regras que garantem uma votação justa em todas as cidades e categorias."
      />
      <div className="overflow-hidden rounded-[16px] border border-white/[0.08] bg-white/[0.025]">
        <div className="flex items-center gap-3 border-b border-white/[0.07] bg-navy-900/50 px-6 py-4">
          <ScrollText className="h-[18px] w-[18px] text-gold-400/90" />
          <p className="text-sm font-medium text-white">Prémios Melhores do Ano Portugal · Edição {editionYear}</p>
        </div>
        <ol className="divide-y divide-white/5">
          {SECTIONS.map((s) => (
            <li key={s.title} className="px-6 py-5 sm:px-8">
              <h2 className="font-display text-[1.05rem] font-bold text-white">{s.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
