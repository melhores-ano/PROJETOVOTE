// Prémios Melhores do Ano Portugal — Phase 2
// Edge Function: cast-vote (motor de votação seguro em produção)
//
// Contrato:
//   POST { campaign_entry_id: string (uuid), device_id?: string, captcha_token?: string }
//   -> 200 { status: "success" | "already_voted" | "campaign_closed" | "invalid_entry"
//                    | "rate_limited" | "captcha_failed" | "server_error",
//           message: string (PT, sem detalhes internos) }
//
// Segurança:
//  - Nunca confia em campaign/city/category/business/vote-count/IP do cliente.
//  - Resolve tudo a partir de campaign_entry_id na BD (service_role).
//  - IP determinado server-side (cf-connecting-ip / x-real-ip / x-forwarded-for)
//    e imediatamente transformado em HMAC-SHA256 com VOTE_HASH_SECRET.
//  - Nunca persiste IP em claro; nunca expõe o segredo ao frontend.
//  - Duplicate protection final = UNIQUE (campaign, city, category, ip_hash).
//  - Rate-limit em janela deslizante + registo em vote_attempts (hashes).
//  - Turnstile validado server-side quando turnstile_enabled=true.
//
// Segredos (Edge Secrets — configurar no dashboard Supabase):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOTE_HASH_SECRET,
//   TURNSTILE_SECRET_KEY (só se Turnstile activo)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

type VoteStatus =
  | "success"
  | "already_voted"
  | "campaign_closed"
  | "invalid_entry"
  | "rate_limited"
  | "captcha_failed"
  | "server_error";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESSAGES: Record<VoteStatus, string> = {
  success: "Voto registado! Obrigado por participar nos Prémios Melhores do Ano.",
  already_voted: "Já registámos um voto desta ligação nesta categoria.",
  campaign_closed: "A votação para esta edição está encerrada.",
  invalid_entry: "Participante inválido. Escolha outro negócio participante.",
  rate_limited: "Demasiadas tentativas. Aguarde alguns minutos e tente de novo.",
  captcha_failed: "Verificação de segurança falhou. Tente novamente.",
  server_error: "Ocorreu um erro. Tente novamente mais tarde.",
};

function json(status: VoteStatus, http = 200, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ status, message: MESSAGES[status], ...extra }), {
    status: http,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/** Identidade de rede a partir de cabeçalhos de infra-estrutura fidedigna. */
function extractClientIp(req: Request): string {
  const h = (n: string) => req.headers.get(n)?.trim() || "";
  const cf = h("cf-connecting-ip");
  if (cf) return cf.split(",")[0].trim();
  const real = h("x-real-ip");
  if (real) return real.split(",")[0].trim();
  const fwd = h("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return "unknown";
}

/** HMAC-SHA256 hex com separação de domínio (evita colisão ip/device/ua). */
async function hmacHex(secret: string, domain: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${domain}:${value}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(
  token: string,
  secret: string,
  ip: string,
): Promise<boolean> {
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v1/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }).toString(),
    });
    if (!res.ok) return false;
    const data = await res.json() as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json("server_error", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const VOTE_SECRET = Deno.env.get("VOTE_HASH_SECRET") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !VOTE_SECRET) {
    console.error("cast-vote: segredos em falta (SUPABASE_URL/SERVICE_ROLE/VOTE_HASH_SECRET)");
    return json("server_error", 500);
  }

  let body: { campaign_entry_id?: unknown; device_id?: unknown; captcha_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json("invalid_entry", 400);
  }

  const entryId = body.campaign_entry_id;
  const rawDevice = typeof body.device_id === "string" ? body.device_id.slice(0, 128) : "";
  const captchaToken = typeof body.captcha_token === "string"
    ? body.captcha_token.slice(0, 2048)
    : "";

  if (!isUuid(entryId)) {
    return json("invalid_entry", 400);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // ---- Configuração segura (sem segredos para o cliente) ----
  // FASE 5C.3.2: rate limits são GLOBAIS (award_program_id IS NULL) e podem
  // ler-se antes de conhecer a campanha. voting_enabled / turnstile_enabled
  // são POR PROGRAMA e SÓ se leem DEPOIS de resolver campaign.award_program_id
  // (ver bloco pós-entry abaixo). Nenhuma query de programa antes do entry.
  let votingEnabled = true;
  let turnstileEnabled = false;
  let windowSeconds = 600;
  let maxAttempts = 20;
  let maxVotes24h = 30;
  try {
    const { data: settings } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", [
        "vote_rate_window_seconds",
        "vote_rate_max_attempts",
        "vote_rate_max_votes_24h",
      ])
      .is("award_program_id", null);
    const get = (k: string): unknown => (settings ?? []).find((s: { key: string }) => s.key === k)?.value;
    const asInt = (v: unknown, fb: number) => {
      const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) && n > 0 ? n : fb;
    };
    windowSeconds = Math.min(asInt(get("vote_rate_window_seconds"), 600), 3600);
    maxAttempts = Math.min(asInt(get("vote_rate_max_attempts"), 20), 200);
    maxVotes24h = Math.min(asInt(get("vote_rate_max_votes_24h"), 30), 500);
  } catch {
    // Falha a ler settings: prosseguir com defaults seguros.
  }

  // ---- Identidade privada (hashes) ----
  const clientIp = extractClientIp(req);
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 512);
  const ipHash = await hmacHex(VOTE_SECRET, "ip", clientIp || "unknown");
  const deviceHash = rawDevice ? await hmacHex(VOTE_SECRET, "device", rawDevice) : null;
  const uaHash = userAgent ? await hmacHex(VOTE_SECRET, "ua", userAgent) : null;

  async function logAttempt(
    outcome: "aceite" | "duplicado" | "bloqueado" | "invalido" | "rate_limit",
    reason: string,
    ids: { campaign_id?: string | null; city_id?: string | null; category_id?: string | null; business_id?: string | null },
  ) {
    try {
      await supabase.from("vote_attempts").insert({
        campaign_id: ids.campaign_id ?? null,
        city_id: ids.city_id ?? null,
        category_id: ids.category_id ?? null,
        business_id: ids.business_id ?? null,
        outcome,
        reason: reason.slice(0, 300),
        ip_hash: ipHash,
        device_hash: deviceHash,
      });
    } catch (e) {
      console.error("cast-vote: falha a registar vote_attempt", e);
    }
  }

  // ---- Resolver campanha/negócio/cidade/categoria A PARTIR DA ENTRY ----
  // FASE 5C.3.2: resolução ANTECIPADA (antes de rate-limit/captcha) para
  // obter campaign.award_program_id. Algoritmo, mensagens e HTTP intactos.
  const { data: entry, error: entryError } = await supabase
    .from("campaign_entries")
    .select(`
      id, active, campaign_id, city_id, category_id, business_id,
      campaign:campaigns(id, status, start_at, end_at, award_program_id),
      business:businesses(id, active),
      city:cities(id, active),
      category:categories(id, active)
    `)
    .eq("id", entryId)
    .maybeSingle();

  type EntryRow = {
    id: string;
    active: boolean;
    campaign_id: string;
    city_id: string;
    category_id: string;
    business_id: string;
    campaign: { id: string; status: string; start_at: string | null; end_at: string | null; award_program_id: string | null } | null;
    business: { id: string; active: boolean } | null;
    city: { id: string; active: boolean } | null;
    category: { id: string; active: boolean } | null;
  };
  const e = (entry ?? null) as unknown as EntryRow | null;

  if (entryError || !e) {
    await logAttempt("invalido", "entry_not_found", {});
    return json("invalid_entry", 404);
  }

  // ---- FASE 5C.3.2: settings DO PROGRAMA (após conhecer award_program_id) --
  // voting_enabled / turnstile_enabled: override do programa da campanha →
  // fallback global → default seguro. Linhas de outro programa ignoradas.
  // Algoritmo antifraude, hashes, rate limiting, mensagens e HTTP intactos.
  try {
    const programId: string | null = e.campaign?.award_program_id ?? null;
    let query = supabase
      .from("site_settings")
      .select("key, value, award_program_id")
      .in("key", ["voting_enabled", "turnstile_enabled"]);
    // Sem programa (dado legado): apenas globais.
    query = programId === null ? query.is("award_program_id", null) : query.or(`award_program_id.eq.${programId},award_program_id.is.null`);
    const { data: pSettings } = await query;
    const rows = ((pSettings ?? []) as { key: string; value: unknown; award_program_id: string | null }[])
      .filter((s) => s.award_program_id === null || s.award_program_id === programId);
    const pick = (k: string): unknown =>
      rows.find((s) => s.key === k && s.award_program_id === programId)?.value ??
      rows.find((s) => s.key === k && s.award_program_id === null)?.value;
    const asBool = (v: unknown, fb: boolean) =>
      typeof v === "boolean" ? v : typeof v === "string" ? v === "true" : fb;
    votingEnabled = asBool(pick("voting_enabled"), true);
    turnstileEnabled = asBool(pick("turnstile_enabled"), false);
  } catch {
    // Falha a ler settings do programa: prosseguir com defaults seguros.
  }

  if (!votingEnabled) return json("campaign_closed", 403);

  const ids = {
    campaign_id: e.campaign_id,
    city_id: e.city_id,
    category_id: e.category_id,
    business_id: e.business_id,
  };

  // ---- Rate limiting (janela deslizante, hashes apenas) ----
  // FASE 5C.3.2: posição pós-entry/programa; limites GLOBAIS, algoritmo,
  // mensagens e HTTP intactos.
  try {
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const { count: attemptCount } = await supabase
      .from("vote_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", windowStart);
    if ((attemptCount ?? 0) >= maxAttempts) {
      await logAttempt("rate_limit", `rate_window:${windowSeconds}s`, {});
      return json("rate_limited", 429);
    }
    const dayStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: votes24h } = await supabase
      .from("votes")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", dayStart);
    if ((votes24h ?? 0) >= maxVotes24h) {
      await logAttempt("rate_limit", "votes_24h_exceeded", {});
      return json("rate_limited", 429);
    }
  } catch (e) {
    console.error("cast-vote: rate-limit check falhou (fail-open controlado)", e);
  }

  // ---- CAPTCHA server-side (quando activo) ----
  // FASE 5C.3.2: turnstileEnabled já resolvido por programa acima.
  if (turnstileEnabled) {
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
    if (!secret) {
      console.error("cast-vote: turnstile_enabled mas TURNSTILE_SECRET_KEY em falta");
      return json("server_error", 500);
    }
    if (!captchaToken) {
      await logAttempt("bloqueado", "captcha_missing", {});
      return json("captcha_failed", 400);
    }
    const ok = await verifyTurnstile(captchaToken, secret, clientIp);
    if (!ok) {
      await logAttempt("bloqueado", "captcha_failed", {});
      return json("captcha_failed", 400);
    }
  }

  // ---- Validação de campanha/participante (tempo do SERVIDOR) ----
  const now = Date.now();
  const campaign = e.campaign;
  const statusOk = campaign != null && (campaign.status === "activa" || campaign.status === "votacao");
  const startOk = !campaign?.start_at || Date.parse(campaign.start_at) <= now;
  const endOk = !campaign?.end_at || Date.parse(campaign.end_at) >= now;
  const allActive = e.active === true &&
    e.business?.active === true &&
    e.city?.active === true &&
    e.category?.active === true;

  if (!statusOk || !startOk || !endOk) {
    await logAttempt("bloqueado", "campaign_closed", ids);
    return json("campaign_closed", 403);
  }
  if (!allActive || !campaign) {
    await logAttempt("invalido", "entry_inactive", ids);
    return json("invalid_entry", 422);
  }

  // ---- Inserção (constraint UNIQUE = protecção final anti-race) ----
  const { error: insertError } = await supabase.from("votes").insert({
    campaign_id: e.campaign_id,
    city_id: e.city_id,
    category_id: e.category_id,
    business_id: e.business_id,
    campaign_entry_id: e.id,
    ip_hash: ipHash,
    device_hash: deviceHash,
    user_agent_hash: uaHash,
  });

  if (insertError) {
    // Violação de unicidade => voto duplicado (inclui race simultânea).
    const code = (insertError as { code?: string }).code;
    const msg = String((insertError as { message?: string }).message ?? "");
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      await logAttempt("duplicado", "unique_violation", ids);
      return json("already_voted", 409);
    }
    console.error("cast-vote: insert falhou", insertError);
    await logAttempt("invalido", "insert_failed", ids);
    return json("server_error", 500);
  }

  await logAttempt("aceite", "vote_accepted", ids);
  return json("success", 200);
});
