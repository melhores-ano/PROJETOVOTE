import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const auth = readFileSync(resolve(root, 'src/hooks/AuthContext.tsx'), 'utf8');
const layout = readFileSync(resolve(root, 'src/components/AdminLayout.tsx'), 'utf8');

const checks = [
  ['stale auth profile responses ignored', /generation !== authGeneration\.current/.test(auth)],
  ['initial session guarded against stale completion', /initialGeneration === authGeneration\.current/.test(auth)],
  ['auth event callback does not await profile fetch', /setTimeout\(\(\) => \{[\s\S]*?void loadProfile\(uid\)/.test(auth)],
  ['explicit logout invalidates pending requests', /const signOut = useCallback\(async \(\) => \{\s*\+\+authGeneration\.current/.test(auth)],
  ['logout clears role before server response', /setProfile\(null\);[\s\S]*?setLoading\(false\);\s*if \(supabase\) \{\s*const \{ error \} = await supabase\.auth\.signOut\(\)/.test(auth)],
  ['login denies profiles without admin role', /p\.role !== 'admin' && p\.role !== 'super_admin'/.test(auth)],
  ['admin route enforces isAdmin', /if \(!isAdmin\) return <Navigate to="\/admin\/login" replace/.test(layout)],
  ['superadmin route enforces role', /if \(role !== 'super_admin'\) return <Navigate/.test(layout)],
];
for (const [name, passed] of checks) {
  assert.ok(passed, name);
  console.log('PASS', name);
}
console.log(`Auth guard checks: ${checks.length} passed.`);
