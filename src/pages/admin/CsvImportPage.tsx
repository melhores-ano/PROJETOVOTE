/**
 * THE BEST EUROPA — FASE 5C.3.7 — Admin > Importar CSV (isolado).
 *
 * Toda importação conhece explicitamente:
 * - programa selecionado (AdminProgramProvider — única fonte);
 * - país correspondente (cidades → country_code do programa);
 * - edição selecionada quando o CSV cria participações
 *   (campaign_entries → selectedCampaignId OBRIGATÓRIO).
 *
 * FAIL-CLOSED:
 * - sem programa válido → importação bloqueada, sem dados;
 * - cidade fora do programa → linha ignorada (nada criado);
 * - categoria de outro programa → linha ignorada;
 * - inscrição em edição sem campaign válida → bloqueada.
 *
 * Nenhuma importação real é executada automaticamente — o utilizador
 * confirma explicitamente após a pré-visualização.
 */
import { useMemo, useRef, useState } from 'react';
import { Upload, FileCheck2, AlertTriangle, Download, CheckCircle2, XCircle } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';
import { audit } from '../../lib/audit';
import { normalize, slugify } from '../../lib/utils';
import { parseCsv, validateRows, CSV_TEMPLATE, type CsvRowValidated } from '../../lib/csv';
import { AdminHeader, AdminCard, AdminTable, SupabaseNotice } from '../../components/admin';
import { AdminScopeBanner } from '../../components/AdminScopeBanner';
import { Field, Select } from '../../components/AdminForm';
import { PageLoading, ErrorState } from '../../components/ui';
import { useScopedCategories, useScopedCities } from '../../hooks/useAdminData';
import { useAdminProgram } from '../../hooks/useAdminProgram';

type Phase = 'ficheiro' | 'revisao' | 'concluido';

interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  entriesLinked: number;
}

export default function CsvImportPage() {
  const { selectedProgram, selectedProgramId, campaigns, selectedCampaign, selectedCampaignId } = useAdminProgram();
  const countryCode = selectedProgram?.country_code ?? null;
  // 5C.3.7: lookups ESTRITAMENTE do programa (nunca globais).
  const citiesQuery = useScopedCities(countryCode);
  const categoriesQuery = useScopedCategories(selectedProgramId);
  const [phase, setPhase] = useState<Phase>('ficheiro');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRowValidated[]>([]);
  const [linkEntries, setLinkEntries] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasProgram = Boolean(selectedProgram && selectedProgramId && countryCode);
  const validRows = useMemo(() => rows.filter((r) => r.errors.length === 0), [rows]);
  const errorRows = useMemo(() => rows.filter((r) => r.errors.length > 0), [rows]);

  async function handleFile(file: File) {
    setFileName(file.name);
    setSummary(null);
    setImportErrors([]);
    const text = await file.text();
    const parsed = parseCsv(text);
    setHeaders(parsed.headers);
    // Slugs existentes para detecção de duplicados na BD.
    let existingSlugs = new Set<string>();
    if (supabase) {
      const { data } = await supabase.from('businesses').select('slug').limit(5000);
      existingSlugs = new Set(((data ?? []) as { slug: string }[]).map((b) => b.slug));
    }
    // 5C.3.7: correspondências SOMENTE dentro do programa selecionado.
    const cityNames = new Map((citiesQuery.data ?? []).map((c) => [normalize(c.name), c.id]));
    for (const c of citiesQuery.data ?? []) cityNames.set(normalize(c.slug), c.id);
    const catNames = new Map((categoriesQuery.data ?? []).map((c) => [normalize(c.name), c.id]));
    for (const c of categoriesQuery.data ?? []) catNames.set(normalize(c.slug), c.id);
    const validated = validateRows(parsed.rows, { existingSlugs, cityNames, categoryNames: catNames });
    setRows(validated);
    setPhase('revisao');
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-importacao-empresas.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    if (!supabase) return;
    // FAIL-CLOSED programático antes de qualquer escrita.
    if (!hasProgram || !selectedProgramId || !countryCode) {
      setImportErrors(['Sem programa válido — importação recusada (fail-closed).']);
      return;
    }
    if (linkEntries && !selectedCampaignId) {
      setImportErrors(['Inscrição em edição ativa mas sem edição válida — selecione uma edição do programa ou desative a inscrição automática.']);
      return;
    }
    // Defesa em profundidade: a edição TEM de pertencer ao programa.
    if (linkEntries && selectedCampaign && selectedCampaign.award_program_id !== selectedProgramId) {
      setImportErrors(['A edição selecionada não pertence ao programa — importação recusada.']);
      return;
    }
    setImporting(true);
    setImportErrors([]);
    const errs: string[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let entriesLinked = 0;

    const cityByNorm = new Map((citiesQuery.data ?? []).map((c) => [normalize(c.name), c]));
    for (const c of citiesQuery.data ?? []) cityByNorm.set(normalize(c.slug), c);
    const validCityIds = new Set((citiesQuery.data ?? []).map((c) => c.id));
    const validCategoryIds = new Set((categoriesQuery.data ?? []).map((c) => c.id));
    const catByNorm = new Map((categoriesQuery.data ?? []).map((c) => [normalize(c.name), c]));
    for (const c of categoriesQuery.data ?? []) catByNorm.set(normalize(c.slug), c);

    for (const row of validRows) {
      try {
        setProgress(`A importar linha ${row.line} — ${row.values.business_name}…`);
        const v = row.values;
        const name = v.business_name.trim();
        const slug = slugify(name);
        const city = cityByNorm.get(normalize(v.city.trim()));
        const cat = catByNorm.get(normalize(v.category.trim()));
        // 5C.3.7: cidade/categoria FORA do programa → linha ignorada, nada criado.
        if (!city || !validCityIds.has(city.id)) {
          skipped += 1;
          errs.push(`Linha ${row.line}: cidade «${v.city}» fora do programa ${selectedProgram?.name} (${countryCode}) — registo ignorado (nada foi criado).`);
          continue;
        }
        if (!cat || !validCategoryIds.has(cat.id)) {
          skipped += 1;
          errs.push(`Linha ${row.line}: categoria «${v.category}» fora do programa ${selectedProgram?.name} — registo ignorado (nada foi criado).`);
          continue;
        }
        const payload = {
          name,
          slug,
          description: v.description?.trim() || null,
          website: v.website?.trim() || null,
          instagram: v.instagram?.trim() || null,
          facebook: v.facebook?.trim() || null,
          google_maps_url: v.google_maps_url?.trim() || null,
          phone: v.phone?.trim() || null,
          email: v.email?.trim() || null,
          address: v.address?.trim() || null,
          city_id: city.id,
          active: true,
          verified: false,
        };
        // Upsert por slug: nunca cria duplicados silenciosos.
        const { data: existing } = await supabase.from('businesses').select('id').eq('slug', slug).maybeSingle();
        let businessId: string;
        if (existing) {
          const { error } = await supabase.from('businesses').update(payload).eq('id', (existing as { id: string }).id);
          if (error) throw error;
          businessId = (existing as { id: string }).id;
          updated += 1;
          await audit('business.import_update', 'businesses', businessId, { name, line: row.line, file: fileName });
        } else {
          const { data, error } = await supabase.from('businesses').insert(payload).select('id').single();
          if (error) throw error;
          businessId = (data as { id: string }).id;
          created += 1;
          await audit('business.import_create', 'businesses', businessId, { name, line: row.line, file: fileName });
        }
        // Liga categoria ao negócio (idempotente).
        await supabase.from('business_categories').upsert(
          { business_id: businessId, category_id: cat.id },
          { onConflict: 'business_id,category_id' },
        );
        // Liga à edição SELECIONADA do programa (idempotente).
        if (linkEntries && selectedCampaignId) {
          const { error: entryError } = await supabase.from('campaign_entries').upsert(
            { campaign_id: selectedCampaignId, city_id: city.id, category_id: cat.id, business_id: businessId, active: true, featured: false, position: 0 },
            { onConflict: 'campaign_id,city_id,category_id,business_id' },
          );
          if (entryError && !String(entryError.message).toLowerCase().includes('duplicate') && !String(entryError.message).toLowerCase().includes('unique')) throw entryError;
          else entriesLinked += 1;
        }
      } catch (e) {
        skipped += 1;
        errs.push(`Linha ${row.line}: ${e instanceof Error ? e.message : 'falha desconhecida'} — registo ignorado.`);
      }
    }

    await audit('business.import_batch', 'businesses', null, { file: fileName, created, updated, skipped, entriesLinked, award_program_id: selectedProgramId, campaign_id: linkEntries ? selectedCampaignId : null });
    setSummary({ created, updated, skipped, entriesLinked });
    setImportErrors(errs);
    setProgress('');
    setImporting(false);
    setPhase('concluido');
  }

  return (
    <div>
      <AdminHeader
        title="Importação CSV"
        description={`Onboarding em massa para ${selectedProgram ? `${selectedProgram.name} (${countryCode})` : '(sem programa válido)'} — cidades e categorias validadas contra o programa; participações na edição selecionada.`}
        actions={
          <button onClick={downloadTemplate} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-gold-500/50 hover:text-gold-300">
            <Download className="h-4 w-4" /> Descarregar modelo
          </button>
        }
      />
      <SupabaseNotice />
      <AdminScopeBanner requireCampaign={linkEntries} />

      {!hasProgram ? (
        <ErrorState message="Sem programa válido selecionado — selecione um programa no seletor global. A importação está bloqueada (fail-closed)." onRetry={() => { setPhase('ficheiro'); setRows([]); }} />
      ) : (
        <>
          {phase === 'ficheiro' && (
            <AdminCard title="1 · Seleccionar ficheiro">
              {(citiesQuery.loading || categoriesQuery.loading) ? (
                <PageLoading label="A carregar cidades e categorias do programa…" />
              ) : (
                <>
                  <p className="mb-3 rounded-xl border border-white/10 bg-navy-950/60 px-3.5 py-2.5 text-xs text-slate-400">
                    Programa: <strong className="text-white">{selectedProgram?.name}</strong> ({(citiesQuery.data ?? []).length} cidades · {(categoriesQuery.data ?? []).length} categorias) ·
                    edição: <strong className="text-white">{selectedCampaign ? `${selectedCampaign.year} — ${selectedCampaign.name}` : '—'}</strong>.
                    Linhas com cidade/categoria fora do programa são ignoradas.
                  </p>
                  <button
                    onClick={() => inputRef.current?.click()}
                    disabled={!isSupabaseConfigured}
                    className="flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-white/20 bg-navy-950/50 px-6 py-12 text-center transition hover:border-gold-500/50 disabled:opacity-50"
                  >
                    <Upload className="h-8 w-8 text-gold-400" />
                    <span className="font-semibold text-white">Escolher ficheiro CSV</span>
                    <span className="max-w-md text-[13px] text-slate-400">
                      Colunas: business_name, city, category, description, website, instagram, facebook, google_maps_url, phone, email, address.
                      Nenhum registo é criado antes da confirmação.
                    </span>
                  </button>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
              />
            </AdminCard>
          )}

          {phase !== 'ficheiro' && (
            <>
              <AdminCard title={`2 · Pré-visualização — ${fileName} (${rows.length} linhas)`}>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length} válidas
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 font-semibold text-red-300">
                    <XCircle className="h-3.5 w-3.5" /> {errorRows.length} com erros
                  </span>
                  <span className="text-slate-500">Cabeçalhos: {headers.join(', ') || '—'}</span>
                </div>
                <AdminTable<CsvRowValidated>
                  searchable
                  searchKeys={[]}
                  rows={rows.slice(0, 200)}
                  emptyMessage="Ficheiro vazio."
                  columns={[
                    { key: 'line', label: 'Linha', render: (r) => <span className="text-slate-500">{r.line}</span> },
                    { key: 'business_name', label: 'Negócio', render: (r) => <span className="font-medium text-white">{r.values.business_name || '—'}</span> },
                    { key: 'city', label: 'Cidade', render: (r) => r.values.city || '—' },
                    { key: 'category', label: 'Categoria', render: (r) => r.values.category || '—' },
                    {
                      key: 'estado', label: 'Validação',
                      render: (r) => r.errors.length > 0
                        ? <span className="block max-w-xs text-xs text-red-300">{r.errors.join(' ')}</span>
                        : r.warnings.length > 0
                          ? <span className="block max-w-xs text-xs text-amber-300">{r.warnings.join(' ')}</span>
                          : <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><FileCheck2 className="h-3.5 w-3.5" /> Válida</span>,
                    },
                  ]}
                />
                {rows.length > 200 && <p className="mt-2 text-xs text-slate-500">A mostrar as primeiras 200 linhas de {rows.length}.</p>}
              </AdminCard>

              {phase === 'revisao' && (
                <AdminCard title="3 · Confirmação da importação" className="mt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Edição para inscrição dos participantes (do programa)">
                      <Select value={selectedCampaignId ?? ''} onChange={() => { /* edição via seletor global — intencionalmente só leitura aqui */ }}>
                        <option value="" className="bg-navy-900">— Sem edição válida —</option>
                        {campaigns.map((c) => (
                          <option key={c.id} value={c.id} className="bg-navy-900">{c.year} · {c.status}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Inscrever automaticamente na edição">
                      <Select value={linkEntries ? 'sim' : 'nao'} onChange={(e) => setLinkEntries(e.target.value === 'sim')}>
                        <option value="sim" className="bg-navy-900">Sim — criar participações</option>
                        <option value="nao" className="bg-navy-900">Não — só negócios</option>
                      </Select>
                    </Field>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    A edição controla-se no seletor global (Programa · Edição). Para mudar de edição, use o seletor na barra lateral.
                  </p>
                  {linkEntries && !selectedCampaignId && (
                    <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      Inscrição ativa sem edição válida — a importação de participações está bloqueada. Desative a inscrição ou selecione uma edição do programa.
                    </p>
                  )}
                  {errorRows.length > 0 && (
                    <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {errorRows.length} linhas com erros serão ignoradas — apenas as {validRows.length} linhas válidas serão importadas.
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={runImport}
                      disabled={importing || validRows.length === 0 || (linkEntries && !selectedCampaignId)}
                      className="inline-flex items-center gap-2 rounded-xl bg-gold-gradient px-5 py-2.5 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110 disabled:opacity-50"
                    >
                      {importing ? <PageLoading label="" /> : <Upload className="h-4 w-4" />}
                      {importing ? 'A importar…' : `Confirmar importação (${validRows.length})`}
                    </button>
                    <button onClick={() => { setPhase('ficheiro'); setRows([]); }} disabled={importing} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm text-slate-300 hover:border-white/40 disabled:opacity-40">
                      Escolher outro ficheiro
                    </button>
                  </div>
                  {progress && <p className="mt-3 text-xs text-gold-300" role="status">{progress}</p>}
                </AdminCard>
              )}

              {phase === 'concluido' && summary && (
                <AdminCard title="4 · Resumo da importação" className="mt-4">
                  <dl className="grid gap-3 text-sm sm:grid-cols-4">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"><dt className="text-xs text-emerald-300">Criados</dt><dd className="font-display text-2xl font-bold text-white">{summary.created}</dd></div>
                    <div className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-3"><dt className="text-xs text-slate-400">Actualizados</dt><dd className="font-display text-2xl font-bold text-white">{summary.updated}</dd></div>
                    <div className="rounded-xl border border-white/10 bg-navy-950/50 px-4 py-3"><dt className="text-xs text-slate-400">Inscrições</dt><dd className="font-display text-2xl font-bold text-white">{summary.entriesLinked}</dd></div>
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"><dt className="text-xs text-amber-300">Ignorados</dt><dd className="font-display text-2xl font-bold text-white">{summary.skipped}</dd></div>
                  </dl>
                  {importErrors.length > 0 && (
                    <ul className="mt-4 space-y-1.5 rounded-xl border border-white/10 bg-navy-950/50 p-4 text-xs text-slate-400">
                      {importErrors.slice(0, 50).map((e, i) => <li key={i}>· {e}</li>)}
                      {importErrors.length > 50 && <li>… e mais {importErrors.length - 50}.</li>}
                    </ul>
                  )}
                  <button onClick={() => { setPhase('ficheiro'); setRows([]); setSummary(null); }} className="mt-4 rounded-xl border border-white/15 px-5 py-2.5 text-sm text-slate-300 hover:border-gold-500/50 hover:text-gold-300">
                    Nova importação
                  </button>
                </AdminCard>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
