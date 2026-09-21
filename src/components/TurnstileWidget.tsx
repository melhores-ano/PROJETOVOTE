import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove?: (id?: string) => void;
    };
    __turnstileLoaded?: boolean;
    __turnstileLoading?: boolean;
  }
}

/**
 * Widget Cloudflare Turnstile (Phase 2).
 * - Só carrega o script quando `enabled && siteKey` (privacidade + performance).
 * - Quando desactivado, não renderiza nada e `onToken('')`.
 * - Nunca valida no cliente: o token é enviado à Edge Function, que valida
 *   server-side junto da Cloudflare.
 */
export function TurnstileWidget({
  siteKey,
  enabled,
  onToken,
}: {
  siteKey: string;
  enabled: boolean;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const tokenRef = useRef(onToken);
  tokenRef.current = onToken;

  useEffect(() => {
    if (!enabled || !siteKey) {
      tokenRef.current('');
      return;
    }

    let cancelled = false;

    function render() {
      if (cancelled || !ref.current || !window.turnstile) return;
      try {
        if (widgetId.current && window.turnstile.remove) {
          window.turnstile.remove(widgetId.current);
        }
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token: string) => tokenRef.current(token ?? ''),
          'expired-callback': () => tokenRef.current(''),
          'error-callback': () => tokenRef.current(''),
        });
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }

    if (window.turnstile) {
      render();
      return () => {
        cancelled = true;
      };
    }

    if (!window.__turnstileLoading && !window.__turnstileLoaded) {
      window.__turnstileLoading = true;
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.__turnstileLoaded = true;
        window.__turnstileLoading = false;
        render();
      };
      script.onerror = () => {
        window.__turnstileLoading = false;
        if (!cancelled) setLoadError(true);
      };
      document.head.appendChild(script);
    } else {
      const timer = window.setInterval(() => {
        if (window.turnstile) {
          window.clearInterval(timer);
          render();
        }
      }, 250);
      const timeout = window.setTimeout(() => window.clearInterval(timer), 10000);
      return () => {
        cancelled = true;
        window.clearInterval(timer);
        window.clearTimeout(timeout);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, siteKey]);

  if (!enabled || !siteKey) return null;

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={ref} aria-label="Verificação de segurança" />
      {loadError && (
        <p className="text-xs text-amber-300">
          Não foi possível carregar a verificação. Pode continuar — a validação
          será feita no servidor.
        </p>
      )}
    </div>
  );
}
