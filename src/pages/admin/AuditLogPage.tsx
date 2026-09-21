import { useMemo, useState } from 'react';
import { History, Lock } from 'lucide-react';
import { useAuditDisplayMaps, useAuditLogs } from '../../hooks/useAdminData';
import type { AuditAdminLabel } from '../../hooks/useAdminData';
import type { AuditLog } from '../../types/database';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { Field, Select, TextInput } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';

const ACTION_GROUPS: { value: string; label: string }[] = [
  { value: '', label: 'Todas as acções' },
  { value: 'campaign.', label: 'Campanhas (criação, activação, encerramento, arquivo)' },
  { value: 'results.', label: 'Publicação de resultados' },
  { value: 'business.', label: 'Negócios (criação, remoção da campanha)' },
  { value: 'category', label: 'Categorias' },
  { value: 'entry.', label: 'Participações' },
  { value: 'vote_adjustment.', label: 'Ajustes de votos (+/-)' },
  { value: 'config', label: 'Configurações' },
];

function formatAdjustment(value: unknown): { label: string; positive: boolean } | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n === 0) return null;
  const rounded = Math.trunc(n);
  return { label: `${rounded > 0 ? '+' : ''}${rounded}`, positive: rounded > 0 };
}

function getBusinessId(meta: Record<string, unknown>): string | null {
  const v = meta['business_id'];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** FASE 4G.3 — Etiqueta legível do administrador com fallback para actor_id. */
function AdminIdentity({ actorId, label }: { actorId: string | null; label?: AuditAdminLabel }) {
  if (!actorId) return <span className="text-xs text-slate-600">—</span>;
  const name = label?.display_name?.trim() ? label.display_name.trim() : null;
  const email = label?.email?.trim() ? label.email.trim() : null;
  // Fallback: UUID em bruto (comportamento anterior à 4G.3).
  if (!name && !email) {
    return (
      <code className="text-xs text-slate-500" title={actorId}>
        {actorId.slice(0, 13)}
      </code>
    );
  }
  return (
    <span className="block max-w-[220px]" title={actorId}>
      {name && <span className="block truncate text-xs font-medium text-slate-200">{name}</span>}
      {email && (
        <span className={`block truncate text-xs ${name ? 'text-slate-400' : 'text-slate-200'}`}>{email}</span>
      )}
      <span className="block truncate font-mono text-[10px] text-slate-600">{actorId.slice(0, 13)}…</span>
    </span>
  );
}

function VoteAdjustmentDetail({ meta, businessName }: { meta: Record<string, unknown>; businessName?: string }) {
  const adjustment = formatAdjustment(meta['adjustment']);
  const reason = typeof meta['reason'] === 'string' && meta['reason'].trim() !== '' ? String(meta['reason']) : '—';
  const businessId = getBusinessId(meta) ?? '—';
  // FASE 4G.3: nome legível do negócio com fallback para o business_id em bruto.
  const resolved = businessName && businessName.trim() !== '' ? businessName : null;
  return (
    <span className="block max-w-xs space-y-1 text-xs">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold tabular-nums ${
          adjustment === null
            ? 'border-slate-700 text-slate-400'
            : adjustment.positive
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
        }`}
        title={adjustment ? `Quantidade do ajuste: ${adjustment.label} votos` : 'Quantidade do ajuste indisponível'}
      >
        {adjustment ? `${adjustment.label} votos` : 'Quantidade: —'}
      </span>
      <span className="block text-slate-300" title={reason}>
        Motivo: {reason}
      </span>
      <span className="block text-slate-500">
        Negócio:{' '}
        {resolved ? (
          <span className="font-medium text-slate-200" title={businessId}>
            {resolved}
          </span>
        ) : (
          <code className="text-slate-400" title={businessId}>
            {businessId.length > 13 ? businessId.slice(0, 13) : businessId}
          </code>
        )}
      </span>
    </span>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type AuditDisplayRow = AuditLog & { _admin_search: string; _business_search: string };

export default function AuditLogPage() {
  const query = useAuditLogs(500);
  // FASE 4G.3: mapas id -> etiqueta legível (2 consultas em lote, anti N+1).
  const { adminById, businessNameById } = useAuditDisplayMaps(query.data);
  const [group, setGroup] = useState('');
  const [actor, setActor] = useState('');

  const rows: AuditDisplayRow[] = useMemo(() => {
    const t = actor.trim().toLowerCase();
    return query.data
      .filter(
        (l) =>
          (!group || l.action.startsWith(group) || (group === 'category' && l.entity === 'categories')),
      )
      .map((l) => {
        const label = l.actor_id ? adminById[l.actor_id] : undefined;
        const adminSearch = [
          l.actor_id ?? '',
          label?.display_name ?? '',
          label?.email ?? '',
        ]
          .join(' ')
          .toLowerCase();
        const meta = l.metadata as Record<string, unknown> | null;
        const bId = meta && l.action === 'vote_adjustment.created' ? getBusinessId(meta) : null;
        const businessSearch = bId ? `${bId} ${(bId && businessNameById[bId]) ?? ''}`.toLowerCase() : '';
        return { ...l, _admin_search: adminSearch, _business_search: businessSearch };
      })
      .filter((l) => {
        if (!t) return true;
        return l._admin_search.includes(t) || l._business_search.includes(t);
      });
  }, [query.data, group, actor, adminById, businessNameById]);

  return (
    <div>
      <AdminHeader
        title="Auditoria"
        description="Registo imutável de operações administrativas: quem, o quê, que recurso, quando e com que metadados — incluindo ajustes de votos (+/-). Apenas leitura — o histórico não pode ser alterado."
      />
      <SupabaseNotice />

      <AdminCard title="Filtros">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grupo de acções">
            <Select value={group} onChange={(e) => setGroup(e.target.value)}>
              {ACTION_GROUPS.map((a) => (
                <option key={a.label} value={a.value} className="bg-navy-900">{a.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Administrador (nome, email ou ID)">
            <TextInput value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Filtrar por nome, email ou ID…" />
          </Field>
        </div>
        <p className="mt-3 flex items-start gap-2 text-[12px] text-slate-500">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Protegido pelo trigger audit_no_update: UPDATE e DELETE são rejeitados ao nível da base de dados, inclusive para service_role.
        </p>
      </AdminCard>

      <AdminCard title={`Eventos (${rows.length})`} className="mt-4">
        {query.loading ? (
          <PageLoading label="A carregar auditoria…" />
        ) : query.error ? (
          <ErrorState message={query.error} onRetry={query.refetch} />
        ) : (
          <AdminTable
            searchable
            searchKeys={['action', 'entity', 'entity_id', '_admin_search', '_business_search']}
            searchPlaceholder="Pesquisar acção, entidade, ID, administrador ou negócio…"
            rows={rows}
            emptyMessage="Sem eventos para estes filtros."
            columns={[
              { key: 'created_at', label: 'Data/hora', render: (r) => <span className="whitespace-nowrap text-xs text-slate-400">{formatDateTime(String((r as AuditDisplayRow).created_at))}</span> },
              { key: 'action', label: 'Acção', render: (r) => <code className="text-xs text-gold-300">{String((r as AuditDisplayRow).action)}</code> },
              { key: 'entity', label: 'Tipo de recurso', render: (r) => String((r as AuditDisplayRow).entity ?? '—') },
              { key: 'entity_id', label: 'ID do recurso', render: (r) => <code className="text-xs text-slate-400" title={String((r as AuditDisplayRow).entity_id ?? '')}>{String((r as AuditDisplayRow).entity_id ?? '—').slice(0, 13)}</code> },
              {
                key: 'actor_id',
                label: 'Administrador',
                render: (r) => {
                  const row = r as AuditDisplayRow;
                  return <AdminIdentity actorId={row.actor_id} label={row.actor_id ? adminById[row.actor_id] : undefined} />;
                },
              },
              {
                key: 'metadata', label: 'Metadados',
                render: (r) => {
                  const row = r as AuditDisplayRow;
                  const meta = row.metadata as Record<string, unknown> | null;
                  if (!meta) return <span className="text-xs text-slate-600">—</span>;
                  if (String(row.action) === 'vote_adjustment.created') {
                    const bId = getBusinessId(meta);
                    return <VoteAdjustmentDetail meta={meta} businessName={bId ? businessNameById[bId] : undefined} />;
                  }
                  const shown = (['name', 'year', 'status', 'business', 'file'] as const)
                    .map((k) => (meta[k] !== undefined && meta[k] !== null ? `${k}: ${String(meta[k])}` : null))
                    .filter(Boolean)
                    .join(' · ');
                  return <span className="block max-w-xs truncate text-xs text-slate-400" title={JSON.stringify(meta)}>{shown || JSON.stringify(meta).slice(0, 80)}</span>;
                },
              },
            ]}
          />
        )}
        <p className="mt-3 flex items-start gap-2 text-[12px] text-slate-500">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Operações registadas: criação/activação/encerramento de campanhas, criação de negócios, remoção da campanha, alterações de categorias, publicação de resultados, ajustes de votos (+/-) com quantidade, motivo e negócio, e alterações de configuração.
        </p>
      </AdminCard>
    </div>
  );
}
