import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const main = read('src/hooks/useVoting.ts');
const modality = read('src/hooks/useModalityVoting.ts');
const settings = read('src/hooks/useVotingSettings.ts');
const category = read('src/pages/public/CategoryPage.tsx');
const modal = read('src/components/VoteModal.tsx');

const checks = [
  ['main vote synchronous in-flight guard', /submittingRef\.current\) return;/.test(main)],
  ['modality vote synchronous in-flight guard', /submittingRef\.current\) return;/.test(modality)],
  ['main vote handles unexpected exceptions', /catch\s*\{\s*setStatus\('server_error'\)/.test(main)],
  ['modality vote handles unexpected exceptions', /catch\s*\{\s*setStatus\('server_error'\)/.test(modality)],
  ['main vote always releases in-flight guard', /finally\s*\{\s*submittingRef\.current = false;\s*setPhase\('done'\)/.test(main)],
  ['modality vote always releases in-flight guard', /finally\s*\{\s*submittingRef\.current = false;\s*setPhase\('done'\)/.test(modality)],
  ['production settings default to disabled', /supabase \? \{ \.\.\.FALLBACK_SETTINGS, votingEnabled: false \}/.test(settings)],
  ['missing voting flag defaults to disabled', /asBool\(map\.get\('voting_enabled'\), false\)/.test(settings)],
  ['captcha key required when enabled', /!captchaEnabled \|\| siteKey\.length > 0/.test(settings)],
  ['confirmation requires CAPTCHA key and token', /turnstileEnabled && \(!turnstileSiteKey \|\| !captchaToken\)/.test(modal)],
  ['category waits for validated settings', /!votingSettings\.loading && !votingSettings\.error && votingSettings\.data\?\.votingEnabled === true/.test(category)],
];

for (const [name, passed] of checks) {
  assert.ok(passed, name);
  console.log('PASS', name);
}
console.log('Voting UI guard checks: ' + checks.length + ' passed.');
