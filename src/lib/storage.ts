import { supabase } from './supabase';

export type ImageBucket = 'city-images' | 'business-logos' | 'business-covers' | 'sponsor-logos';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

/**
 * Carrega uma imagem para o Supabase Storage (policies admin-only já aplicadas)
 * e devolve o URL público. Usado pelos formulários administrativos.
 */
export async function uploadImage(
  bucket: ImageBucket,
  file: File,
  slugHint: string,
): Promise<{ ok: true; publicUrl: string } | { ok: false; message: string }> {
  if (!supabase) {
    return { ok: false, message: 'Supabase por configurar — o upload está desactivado.' };
  }
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, message: 'Formato inválido. Utilize JPG, PNG, WebP ou SVG.' };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: 'A imagem excede 2 MB. Comprima e tente novamente.' };
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const safe = slugHint.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'imagem';
  const path = `${safe}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    return { ok: false, message: `Falha no upload: ${error.message}` };
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { ok: true, publicUrl: data.publicUrl };
}
