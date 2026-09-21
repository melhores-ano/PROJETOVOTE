import { Award, ShieldCheck, Users, Landmark } from 'lucide-react';
import { SectionHeading, GoldDivider } from '../../components/ui';

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-6 sm:py-16">
      <SectionHeading
        eyebrow="O prémio nacional"
        title={<>Sobre os Melhores do Ano</>}
        description="O reconhecimento nacional dos negócios locais que fazem Portugal acontecer."
      />

      <div className="prose-like space-y-5 rounded-[16px] border border-white/[0.08] bg-white/[0.025] p-8 text-[15px] leading-relaxed text-slate-400 sm:p-10">
        <p>
          Os <strong className="text-white">Prémios Melhores do Ano Portugal</strong> celebram, todos os anos,
          os melhores negócios locais do país — escolhidos directamente pelas pessoas, cidade a cidade
          e categoria a categoria.
        </p>
        <p>
          Das barbearias de Braga às tascas do Porto, das pastelarias de Lisboa ao artesanato do
          Alentejo: cada edição percorre <strong className="text-white">centenas de cidades</strong>,{' '}
          <strong className="text-white">dezenas de categorias</strong> e{' '}
          <strong className="text-white">milhares de negócios</strong>, dando palco ao comércio
          de bairro que sustenta a vida local.
        </p>
        <p>
          A votação é simples e aberta a todos — <strong className="text-white">sem necessidade de criar conta</strong> —,
          com regras justas (um voto por pessoa, por categoria, por cidade e por edição) e auditoria
          permanente para garantir resultados credíveis.
        </p>
      </div>

      <GoldDivider className="my-12" />

      <div className="grid gap-5 sm:grid-cols-2">
        {[
          { icon: Users, title: 'Escolha popular', text: 'Quem decide são as pessoas de cada cidade — não júris fechados.' },
          { icon: Landmark, title: 'Raiz local', text: 'Cada cidade tem os seus nomeados, os seus vencedores e o seu orgulho.' },
          { icon: ShieldCheck, title: 'Credibilidade', text: 'Regras públicas, votos auditados e resultados verificáveis.' },
          { icon: Award, title: 'Prestígio nacional', text: 'O selo Melhores do Ano distingue os vencedores em todo o país.' },
        ].map((v) => (
          <div key={v.title} className="rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-6">
            <v.icon className="h-5 w-5 text-gold-400/90" />
            <h3 className="mt-3 font-display text-[1.1rem] font-bold text-white">{v.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{v.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
