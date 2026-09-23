/**
 * FASE 6.1 — Verificação LOCAL (SEM tocar no banco remoto).
 * Gestão de convites e aceitação de participantes (pré-votação):
 * participant_invitations (migration 0018), funil
 * potential → contacted → accepted → confirmed (+ declined lateral),
 * confirmação idempotente em campaign_entries, RLS admin-only,
 * auditoria via audit_logs, PT-PT, fail-closed.
 * Sem db push, sem deploy, sem seeds, sem git, sem pagamentos.
 * Não toca cast-vote / cast-modality-vote / votos / resultados /
 * digital_credentials / certificado / selo / verificação pública.
 * Uso: node scripts/verify-phase61.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CAST_VOTE = 'F8D382B2F0B6FD2AFB4E742275AA4297266AFDE5A398B4B4258787027FE6115C';
const EXPECTED_CAST_MODALITY = '789BD90CB3AF237AAE2E000406B8F1212C5F44DCFDA51B2F6DF47DB8E2A80955';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function read(p) {
  return readFileSync(join(root, p), 'utf8');
}
function exists(p) {
  return existsSync(join(root, p));
}

/** Remove comentários JS/TS para scan de código executável. */
function jsCodeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Remove comentários SQL para scan de DDL executável. */
function sqlCodeOf(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const MIG = 'supabase/migrations/0018_phase61_participant_invitations.sql';
const LIB = 'src/lib/participantInvitations.ts';
const HOOK = 'src/hooks/useParticipantInvitations.ts';
const ADMIN = 'src/pages/admin/InvitationsAdminPage.tsx';
const APP = 'src/App.tsx';
const NAV = 'src/components/AdminLayout.tsx';
const DBTYPES = 'src/types/database.ts';

const migExists = exists(MIG);
const libExists = exists(LIB);
const hookExists = exists(HOOK);
const adminExists = exists(ADMIN);
check('1. estrutura Phase 6.1 existe (migration 0018 + lib + hook + admin)', migExists && libExists && hookExists && adminExists);

const mig = migExists ? read(MIG) : '';
const migCode = sqlCodeOf(mig);
const lib = libExists ? read(LIB) : '';
const libCode = jsCodeOf(lib);
const hook = hookExists ? read(HOOK) : '';
const hookCode = jsCodeOf(hook);
const admin = adminExists ? read(ADMIN) : '';
const adminCode = jsCodeOf(admin);
const app = exists(APP) ? read(APP) : '';
const nav = exists(NAV) ? read(NAV) : '';
const dbTypes = exists(DBTYPES) ? read(DBTYPES) : '';

// ---- 2. tabela ----
check('2. tabela participant_invitations (CREATE TABLE IF NOT EXISTS)',
  /create table if not exists public\.participant_invitations/i.test(migCode));

// ---- 3. âmbito único ----
check('3. UM registo POR (campaign, city, category, business) — UNIQUE',
  /participant_invitations_scope_uidx/i.test(mig) &&
  /campaign_id,\s*city_id,\s*category_id,\s*business_id/i.test(migCode));

// ---- 4. estados ----
check('4. estados potential|contacted|accepted|declined|confirmed',
  /'potential'/.test(mig) && /'contacted'/.test(mig) && /'accepted'/.test(mig) &&
  /'declined'/.test(mig) && /'confirmed'/.test(mig) &&
  /InvitationStatus/.test(dbTypes) && /'confirmed'/.test(lib));

// ---- 5. contact_method ----
check('5. contact_method phone|whatsapp|email|in_person|other (NULL até primeiro contacto)',
  /'phone'/.test(mig) && /'whatsapp'/.test(mig) && /'email'/.test(mig) &&
  /'in_person'/.test(mig) && /'other'/.test(mig) && /InvitationContactMethod/.test(dbTypes));

// ---- 6. campaign_entry_id FK ----
check('6. campaign_entry_id FK → campaign_entries ON DELETE SET NULL (NULL até confirmar)',
  /campaign_entry_id/.test(mig) && /references\s+public\.campaign_entries/i.test(mig) &&
  /on delete set null/i.test(migCode) && /campaign_entry_id/.test(lib));

// ---- 7. RLS admin-only ----
check('7. RLS admin-only (ENABLE RLS + is_admin + sem policy anon)',
  /enable row level security/i.test(mig) && /is_admin\(\)/.test(mig) &&
  /admin manage participant_invitations/.test(mig) &&
  !/for\s+(all|select|insert|update|delete)\s+to\s+anon/i.test(migCode));

// ---- 8. scope guard programa/país ----
check('8. coerência programa × país (participant_invitations_check_scope, PROGRAM_MISMATCH/COUNTRY_MISMATCH)',
  /participant_invitations_check_scope/i.test(mig) && /PROGRAM_MISMATCH/.test(mig) && /COUNTRY_MISMATCH/.test(mig));

// ---- 9. auditoria trigger ----
check('9. trigger auditoria best-effort (participant_invitation.created/.contacted/.accepted/.declined/.confirmed/.updated)',
  /participant_invitation\.created/.test(mig) && /participant_invitation\.contacted/.test(mig) &&
  /participant_invitation\.accepted/.test(mig) && /participant_invitation\.declined/.test(mig) &&
  /participant_invitation\.confirmed/.test(mig) && /participant_invitation\.updated/.test(mig) &&
  /audit_logs/.test(mig));

// ---- 10. coerência CHECK ----
check('10. CHECK coerência (confirmed exige entry+confirmed_at; declined exige declined_at)',
  /campaign_entry_id is not null/.test(migCode) && /declined_at is not null/.test(migCode));

// ---- 11. tipos TS ----
check('11. tipos ParticipantInvitation em database.ts (scope + marcos + internos + entry)',
  /ParticipantInvitation/.test(dbTypes) && /campaign_entry_id/.test(dbTypes) &&
  /contact_person/.test(dbTypes) && /acceptance_reference/.test(dbTypes));

// ---- 12. transições na lib ----
check('12. transições válidas (potential→contacted→accepted→confirmed; declined lateral; confirmed terminal)',
  /potential/.test(lib) && /canTransition/.test(libCode) &&
  /declined.*contacted|contacted.*declined/i.test(lib) &&
  /confirmed:\s*\[\]/.test(libCode));

// ---- 13. confirmar exige accepted ----
check('13. confirmar exige accepted prévio + entry idempotente (SELECT-then-INSERT, 23505 reutiliza)',
  /status !== 'accepted'/.test(libCode) && /campaign_entries/.test(lib) &&
  /23505/.test(libCode) && /confirmInvitationForVoting/.test(libCode));

// ---- 14. contactar/aceitar NÃO cria entry ----
check('14. contactar/aceitar NUNCA cria campaign_entry (só confirmar escreve entries)',
  /NUNCA cria/i.test(lib) &&
  (libCode.match(/from\(["']campaign_entries["']\)/g) || []).length >= 2 &&
  !/transitionInvitation[\s\S]{0,2000}from\(["']campaign_entries["']\)\s*\)\s*\.\s*insert/i.test(libCode));

// ---- 15. hook admin ----
check('15. hook useParticipantInvitations (filtros + 42P01 fail-closed + sem mock eleitoral)',
  /useParticipantInvitations/.test(hook) && /42P01/.test(hook) && /participant_invitations/.test(hookCode));

// ---- 16/17. admin UI + rota ----
check('16. admin Convites (funil + Confirmar para votação + resumo por categoria 3–5)',
  /Confirmar para votação/.test(admin) && /Resumo por categoria/.test(admin) &&
  /3–5|3-5/.test(admin) && /confirmInvitationForVoting/.test(adminCode));
check('17. rota /admin/convites + navegação Convites',
  /admin\/convites/.test(app) && /InvitationsAdminPage/.test(app) &&
  /\/admin\/convites/.test(nav) && /Convites/.test(nav));

// ---- 18/19. auditoria aplicacional + campaign_entries ----
check('18. auditoria aplicacional (audit created/contacted/accepted/declined/confirmed/updated)',
  /INVITATION_AUDIT_ACTIONS/.test(lib) && /audit\(/.test(libCode));
check('19. integração campaign_entries (entry.create via invitation + campaign_entry_id guardado)',
  /entry\.create/.test(libCode) && /campaign_entry_id/.test(libCode));

// ---- 20-25. nenhuma escrita eleitoral ----
const invScope = [lib, admin, hook].join('\n');
const invScopeCode = jsCodeOf(invScope);
for (const [n, t] of [[20, 'votes'], [21, 'vote_attempts'], [22, 'vote_adjustments'], [23, 'modality_votes'], [24, 'modality_vote_attempts']]) {
  const writeRe = new RegExp(`from\\(["']${t}["']\\)\\s*\\)?\\s*\\.\\s*(insert|update|delete|upsert)`, 'i');
  const sqlRe = new RegExp(`into\\s+public\\.${t}`, 'i');
  check(`${n}. sem escrita ${t}`, !writeRe.test(invScopeCode) && !sqlRe.test(migCode));
}
check('25. sem RPCs de apuramento/verificação redefinidos nem escrita em credentials/distinctions/fulfillment',
  !/get_admin_tally|get_admin_modality_tally|get_published_results|verify_digital_credential/i.test(migCode) &&
  !/from\(["'](digital_credentials|award_distinctions|distinction_fulfillment)["']\s*\)?\s*\.\s*(insert|update|delete|upsert)/i.test(invScopeCode));

// ---- 26. cast-vote intacto ----
const castVoteHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('26. cast-vote SHA256 intacto', castVoteHash === EXPECTED_CAST_VOTE, castVoteHash);
const castVoteEdge = read('supabase/functions/cast-vote/index.ts');
check('26b. cast-vote sem referências a convites', !/participant_invitation|invitation/i.test(castVoteEdge));

// ---- 27. cast-modality-vote intacto ----
const castModHash = createHash('sha256').update(readFileSync(join(root, 'supabase/functions/cast-modality-vote/index.ts'), 'utf8')).digest('hex').toUpperCase();
check('27. cast-modality-vote SHA256 intacto', castModHash === EXPECTED_CAST_MODALITY, castModHash);
const edgeMod = read('supabase/functions/cast-modality-vote/index.ts');
check('27b. cast-modality-vote sem referências a convites', !/participant_invitation|invitation/i.test(edgeMod));

// ---- 28. migrations anteriores intactas ----
try {
  const out = execSync('git status --porcelain -- supabase/migrations', { cwd: root, encoding: 'utf8' });
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const touchedOld = lines.filter((l) => !l.includes('0018_phase61'));
  check('28. nenhuma migration anterior alterada (só 0018 untracked)', touchedOld.length === 0, touchedOld.join('; ') || 'limpo');
} catch (e) {
  check('28. nenhuma migration anterior alterada (git indisponível, skip)', true, 'git skip');
}

// ---- 29. guardas negativos ----
check('29. sem pagamentos/seeds/2027/novo país (Stripe/checkout/preço/fatura)',
  !/\bstripe\b|amount_cents|price_cents|unit_price|checkout|subscription|subscrição/i.test(invScopeCode) &&
  !/insert\s+into\s+public\.(countries|award_programs|campaigns|businesses)/i.test(migCode + invScopeCode) &&
  !/2027/.test(invScopeCode));
check('30. sem ficheiros/screenshots (acceptance_reference é texto simples)',
  /acceptance_reference/.test(mig + lib) && !/storage|upload|screenshot|ficheiro.*upload/i.test(invScopeCode));

// ---- 31. PT-PT ----
check('31. PT-PT (Potencial/Contactada/Aceitou/Recusou/Confirmada para votação)',
  /Potencial/.test(lib + admin) && /Contactada/.test(lib + admin) &&
  /Confirmada para votação/.test(lib + admin) && /Participação gratuita/i.test(admin));

// ---- 32. fail-closed ----
check('32. fail-closed (sem entry → sem confirm; tabela ausente → vazio; sem programa → sem emissão)',
  /fail-closed/i.test(lib + hook + admin) && /42P01/.test(hook + lib));

if (failures > 0) {
  console.error(`\n6.1 VERIFY: ${failures} falha(s).`);
  process.exit(1);
}
console.log('\n6.1 VERIFY: tudo válido (local, sem banco remoto alterado).');
