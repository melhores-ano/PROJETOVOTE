import { ShieldCheck } from 'lucide-react';
import { SectionHeading } from '../../components/ui';

const SECTIONS = [
  { title: '1. Princípio da minimização', body: 'O sítio público não exige criação de conta para votar. Recolhemos apenas os dados estritamente necessários ao funcionamento da votação e à prevenção de fraude.' },
  { title: '2. Endereços IP', body: 'Nunca armazenamos endereços IP em texto claro. Para efeitos antifraude, guardamos apenas resumos criptográficos irreversíveis (hashes), que não permitem identificar directamente uma pessoa.' },
  { title: '3. Dados dos negócios', body: 'As informações públicas dos negócios (nome, contactos, morada) são apresentadas com consentimento dos participantes para efeitos do prémio.' },
  { title: '4. Cookies e identificador anónimo', body: 'Utilizamos apenas cookies técnicos essenciais (ex.: sessão de administração) e um identificador anónimo de dispositivo guardado no seu navegador (localStorage), sem recolha de sinais do equipamento. Não utilizamos cookies de rastreio publicitário.' },
  { title: '5. Administração', body: 'O acesso administrativo é restrito a utilizadores autenticados com papel de administrador, protegido por Row Level Security na base de dados. Todas as acções sensíveis são registadas em auditoria.' },
  { title: '6. Direitos dos titulares', body: 'Nos termos do RGPD, qualquer pessoa pode solicitar acesso, rectificação ou apagamento dos seus dados pessoais através da página de Contactos.' },
  { title: '7. Conservação', body: 'Os registos técnicos de votação são conservados apenas pelo período necessário à auditoria de cada edição, sendo depois agregados ou eliminados.' },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-6 sm:py-16">
      <SectionHeading
        eyebrow="RGPD · Privacidade desde a fundação"
        title={<>Política de Privacidade</>}
        description="Como protegemos os dados de quem vota, participa e administra."
      />
      <div className="overflow-hidden rounded-[16px] border border-white/[0.08] bg-white/[0.025]">
        <div className="flex items-center gap-3 border-b border-white/[0.07] bg-navy-900/50 px-6 py-4">
          <ShieldCheck className="h-[18px] w-[18px] text-gold-400/90" />
          <p className="text-sm font-medium text-white">Última actualização: Janeiro de 2026</p>
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
