// Prémios Melhores do Ano Portugal — FASE 5C.3.9
// Edge Function: cast-modality-vote (votação independente por modalidade)
//
// SEPARADA de cast-vote (que permanece INTOCÁVEL). Responsabilidade exclusiva:
// receber voto de modalidade, validar programa/campanha/cidade/categoria/
// modalidade/empresa, validar campanha aberta, validar modalidade activa,
// validar participação da empresa, executar antifraude, impedir duplicidade,
// registar tentativa em modality_vote_attempts e voto em modality_votes.
//
// Contrato:
//   POST { campaign_entry_id: string (uuid), modality_id: string (uuid),
//          device_id?: string, captcha_token?: string }
//   -> 200 { status: "success" | "already_voted" | "campaign_closed"
//                    | "invalid_entry" | "invalid_modality"
//                    | "modality_closed" | "rate_limited"
//                    | "captcha_failed" | "server_error",
//           message: string (PT, sem detalhes internos) }
//
// Segurança (mesmo padrão de cast-vote, tabelas SEPARADAS):
//  - Nunca confia em campaign/city/category/business/programa do cliente.
//  - Resolve tudo a partir de campaign_entry_id + modality_id na BD.
//  - IP server-side → HMAC-SHA256 com VOTE_HASH_SECRET. Nunca IP em claro.
//  - Duplicate final = UNIQUE (campaign, city, category, modality, ip_hash).
//  - Rate-limit em janela deslizante sobre modality_vote_attempts +
//    contagem 24h sobre modality_votes (NUNCA toca vote_attempts/votes).
//  - Turnstile server-side quando turnstile_enabled=true (por programa).
//  - NUNCA escreve em votes / vote_attempts / vote_adjustments.
//  - NUNCA preenche award_distinctions (fase posterior).
//
// Segredos (Edge Secrets): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   VOTE_HASH_SECRET, TURNSTILE_SECRET_KEY (só se Turnstile activo)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.116.0";

type ModalityVoteStatus =
  | "success"
  | "already_voted"
  | "campaign_closed"
  | "invalid_entry"
  | "invalid_modality"
  | "modality_closed"
  | "rate_limited"
  | "captcha_failed"
  | "server_error";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MESSAGES: Record<ModalityVoteStatus, string> = {
  success: "Voto de destaque registado! Obrigado por participar.",
  already_voted: "Já registámos um voto desta ligação nesta distinção.",
  campaign_closed: "A votação para esta edição está encerrada.",
  invalid_entry: "Participante inválido. Escolha outro negócio participante.",
  invalid_modality: "Distinção inválida para esta categoria.",
  modality_closed: "Esta distinção já não está disponível para voto.",
  rate_limited: "Demasiadas tentativas. Aguarde alguns minutos e tente de novo.",
  captcha_failed: "Verificação de segurança falhou. Tente novamente.",
  server_error: "Ocorreu um erro. Tente novamente mais tarde.",
};

function json(status: ModalityVoteStatus, http = 200, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ status, message: MESSAGES[status], ...extra }), {
    status: http,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

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

async function verifyTurnstile(token: string, secret: string, ip: string): Promise<boolean> {
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
    console.error("cast-modality-vote: segredos em falta");
    return json("server_error", 500);
  }

  let body: { campaign_entry_id?: unknown; modality_id?: unknown; device_id?: unknown; captcha_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json("invalid_entry", 400);
  }

  const entryId = body.campaign_entry_id;
  const modalityId = body.modality_id;
  const rawDevice = typeof body.device_id === "string" ? body.device_id.slice(0, 128) : "";
  const captchaToken = typeof body.captcha_token === "string" ? body.captcha_token.slice(0, 2048) : "";

  if (!isUuid(entryId)) return json("invalid_entry", 400);
  if (!isUuid(modalityId)) return json("invalid_modality", 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ---- Settings globais de rate-limit (mesmos nomes, contagem SEPARADA) ----
  let votingEnabled = true;
  let turnstileEnabled = false;
  let windowSeconds = 600;
  let maxAttempts = 20;
  let maxVotes24h = 30;
  try {
    const { data: settings } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["vote_rate_window_seconds", "vote_rate_max_attempts", "vote_rate_max_votes_24h"])
      .is("award_program_id", null);
    const get = (k: string): unknown => (settings ?? []).find((s: { key: string }) => s.key === k)?.value;
    const asInt = (v: unknown, fb: number) => {
      const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
      return Number.isFinite(n) && n > 0 ? n : fb;
    };
    windowSeconds = Math.min(asInt(get("vote_rate_window_seconds"), 600), 3600);
    maxAttempts = Math.min(asInt(get("vote_rate_max_attempts"), 20), 200);
    maxVotes24h = Math.min(asInt(get("vote_rate_max_votes_24h"), 30), 500);
  } catch { /* defaults seguros */ }

  const clientIp = extractClientIp(req);
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 512);
  const ipHash = await hmacHex(VOTE_SECRET, "ip", clientIp || "unknown");
  const deviceHash = rawDevice ? await hmacHex(VOTE_SECRET, "device", rawDevice) : null;
  const uaHash = userAgent ? await hmacHex(VOTE_SECRET, "ua", userAgent) : null;

  async function logAttempt(
    outcome: "aceite" | "duplicado" | "bloqueado" | "invalido" | "rate_limit",
    reason: string,
    ids: { campaign_id?: string | null; city_id?: string | null; category_id?: string | null; modality_id?: string | null; business_id?: string | null },
  ) {
    try {
      await supabase.from("modality_vote_attempts").insert({
        campaign_id: ids.campaign_id ?? null,
        city_id: ids.city_id ?? null,
        category_id: ids.category_id ?? null,
        modality_id: ids.modality_id ?? null,
        business_id: ids.business_id ?? null,
        outcome,
        reason: reason.slice(0, 300),
        ip_hash: ipHash,
        device_hash: deviceHash,
      });
    } catch (e) {
      console.error("cast-modality-vote: falha a registar modality_vote_attempt", e);
    }
  }

  // ---- Resolver entry + modalidade (server-side, fail-closed) ----
  const { data: entry, error: entryError } = await supabase
    .from("campaign_entries")
    .select(`
      id, active, campaign_id, city_id, category_id, business_id,
      campaign:campaigns(id, status, start_at, end_at, award_program_id),
      business:businesses(id, active),
      city:cities(id, active),
      category:categories(id, active, award_program_id)
    `)
    .eq("id", entryId)
    .maybeSingle();

  type EntryRow = {
    id: string; active: boolean; campaign_id: string; city_id: string;
    category_id: string; business_id: string;
    campaign: { id: string; status: string; start_at: string | null; end_at: string | null; award_program_id: string | null } | null;
    business: { id: string; active: boolean } | null;
    city: { id: string; active: boolean } | null;
    category: { id: string; active: boolean; award_program_id: string | null } | null;
  };
  const e = (entry ?? null) as unknown as EntryRow | null;
  if (entryError || !e) {
    await logAttempt("invalido", "entry_not_found", { modality_id: modalityId });
    return json("invalid_entry", 404);
  }

  const { data: modality, error: modalityError } = await supabase
    .from("award_modalities")
    .select("id, active, award_program_id, category_id")
    .eq("id", modalityId)
    .maybeSingle();

  type ModalityRow = { id: string; active: boolean; award_program_id: string; category_id: string };
  const m = (modality ?? null) as unknown as ModalityRow | null;
  if (modalityError || !m) {
    await logAttempt("invalido", "modality_not_found", {
      campaign_id: e.campaign_id, city_id: e.city_id, category_id: e.category_id, business_id: e.business_id,
    });
    return json("invalid_modality", 404);
  }

  const ids = {
    campaign_id: e.campaign_id, city_id: e.city_id, category_id: e.category_id,
    modality_id: m.id, business_id: e.business_id,
  };

  // ---- Coerência cross-program (fail-closed) ----
  // Modalidade tem de pertencer à MESMA categoria do voto.
  if (m.category_id !== e.category_id) {
    await logAttempt("invalido", "modality_category_mismatch", ids);
    return json("invalid_modality", 422);
  }
  // Modalidade / categoria / campanha no MESMO programa.
  const campaignProgram = e.campaign?.award_program_id ?? null;
  const categoryProgram = e.category?.award_program_id ?? null;
  if (campaignProgram !== m.award_program_id || categoryProgram !== m.award_program_id) {
    await logAttempt("invalido", "program_mismatch", ids);
    return json("invalid_modality", 422);
  }
  // Modalidade inativa → fechada (sem votar).
  if (m.active !== true) {
    await logAttempt("bloqueado", "modality_inactive", ids);
    return json("modality_closed", 403);
  }

  // ---- Settings DO PROGRAMA (voting/turnstile por programa) ----
  try {
    const programId: string | null = campaignProgram;
    let query = supabase.from("site_settings").select("key, value, award_program_id")
      .in("key", ["voting_enabled", "turnstile_enabled"]);
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
  } catch { /* defaults seguros */ }

  if (!votingEnabled) return json("campaign_closed", 403);

  // ---- Rate limiting SEPARADO (modality_* — nunca vote_attempts/votes) ----
  try {
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const { count: attemptCount } = await supabase
      .from("modality_vote_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", windowStart);
    if ((attemptCount ?? 0) >= maxAttempts) {
      await logAttempt("rate_limit", `rate_window:${windowSeconds}s`, {});
      return json("rate_limited", 429);
    }
    const dayStart = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count: votes24h } = await supabase
      .from("modality_votes")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", dayStart);
    if ((votes24h ?? 0) >= maxVotes24h) {
      await logAttempt("rate_limit", "votes_24h_exceeded", {});
      return json("rate_limited", 429);
    }
  } catch (err) {
    console.error("cast-modality-vote: rate-limit check falhou (fail-open controlado)", err);
  }

  // ---- CAPTCHA server-side (quando activo no programa) ----
  if (turnstileEnabled) {
    const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
    if (!secret) {
      console.error("cast-modality-vote: turnstile_enabled mas TURNSTILE_SECRET_KEY em falta");
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

  // ---- Campanha aberta + participação activa (tempo do SERVIDOR) ----
  const now = Date.now();
  const campaign = e.campaign;
  const statusOk = campaign != null && (campaign.status === "activa" || campaign.status === "votacao");
  const startOk = !campaign?.start_at || Date.parse(campaign.start_at) <= now;
  const endOk = !campaign?.end_at || Date.parse(campaign.end_at) >= now;
  const allActive = e.active === true && e.business?.active === true &&
    e.city?.active === true && e.category?.active === true;

  if (!statusOk || !startOk || !endOk) {
    await logAttempt("bloqueado", "campaign_closed", ids);
    return json("campaign_closed", 403);
  }
  if (!allActive || !campaign) {
    await logAttempt("invalido", "entry_inactive", ids);
    return json("invalid_entry", 422);
  }

  // ---- Inserção (UNIQUE por modalidade = protecção final anti-race) ----
  // 1 pessoa = 1 voto POR MODALIDADE (outra modalidade: permitido;
  // outra empresa na MESMA modalidade: 23505 → already_voted).
  const { error: insertError } = await supabase.from("modality_votes").insert({
    campaign_id: e.campaign_id,
    city_id: e.city_id,
    category_id: e.category_id,
    modality_id: m.id,
    business_id: e.business_id,
    campaign_entry_id: e.id,
    ip_hash: ipHash,
    device_hash: deviceHash,
    user_agent_hash: uaHash,
  });

  if (insertError) {
    const code = (insertError as { code?: string }).code;
    const msg = String((insertError as { message?: string }).message ?? "");
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      await logAttempt("duplicado", "unique_violation", ids);
      return json("already_voted", 409);
    }
    // Guardas fail-closed da BD (programa/categoria/cidade/participação/inativa).
    if (code === "23514" || code === "23503" || /FASE5C39_/i.test(msg)) {
      await logAttempt("invalido", "integrity_guard", ids);
      if (/MODALITY_INACTIVE/i.test(msg)) return json("modality_closed", 403);
      if (/CATEGORY_MISMATCH|PROGRAM_MISMATCH/i.test(msg)) return json("invalid_modality", 422);
      return json("invalid_entry", 422);
    }
    console.error("cast-modality-vote: insert falhou", insertError);
    await logAttempt("invalido", "insert_failed", ids);
    return json("server_error", 500);
  }

  await logAttempt("aceite", "modality_vote_accepted", ids);
  return json("success", 200);
});
