import { useState } from 'react';
import { Mail, Send, CheckCircle2 } from 'lucide-react';
import { SectionHeading } from '../../components/ui';

export default function ContactPage() {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', subject: 'Questão geral', message: '' });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Fase 1: sem backend de mensagens — confirmação local.
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-14 sm:px-6 sm:py-16">
      <SectionHeading
        eyebrow="Fale connosco"
        title={<>Contactos oficiais</>}
        description="Questões sobre participação, votação, regulamento ou parcerias."
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-[14px] border border-white/[0.08] bg-white/[0.025] p-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-gold-500/20 bg-gold-500/[0.08]">
            <Mail className="h-[18px] w-[18px] text-gold-400" />
          </span>
          <p className="mt-4 text-sm font-semibold text-white">Gabinete do prémio</p>
          <p className="mt-1 text-sm text-slate-400">geral@melhoresdoano.pt</p>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Respondemos em dias úteis. Para registar o seu negócio como participante,
            indique a cidade e a categoria na mensagem.
          </p>
        </aside>

        <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.025] p-6 sm:p-8">
          {sent ? (
            <div className="flex flex-col items-center py-10 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-400" />
              <h2 className="mt-4 font-display text-2xl font-bold text-white">Mensagem registada</h2>
              <p className="mt-2 max-w-sm text-sm text-slate-400">
                Obrigado pelo seu contacto, {form.name || 'visitante'}. O formulário de contacto
                com envio será ligado na próxima fase — por agora, escreva para geral@melhoresdoano.pt.
              </p>
              <button
                onClick={() => { setSent(false); setForm({ name: '', email: '', subject: 'Questão geral', message: '' }); }}
                className="mt-5 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 hover:border-gold-500/50"
              >
                Escrever outra mensagem
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Nome</span>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="O seu nome"
                    className="w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Email</span>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="nome@email.pt"
                    className="w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Assunto</span>
                <select
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className="w-full rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white focus:border-gold-500/60 focus:outline-none"
                >
                  <option>Questão geral</option>
                  <option>Registar o meu negócio</option>
                  <option>Dúvida sobre a votação</option>
                  <option>Parcerias e patrocínios</option>
                  <option>Privacidade e dados</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">Mensagem</span>
                <textarea
                  required
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Escreva a sua mensagem…"
                  className="w-full resize-y rounded-xl border border-white/15 bg-navy-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-gold-500/60 focus:outline-none"
                />
              </label>
              <button
                type="submit"
                className="btn-gold-refined"
              >
                <Send className="h-4 w-4" />
                Enviar mensagem
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
