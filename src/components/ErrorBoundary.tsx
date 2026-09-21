import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string | null;
}

/**
 * Barreira de erros de nível produção: qualquer crash de renderização
 * mostra uma página de recuperação elegante em vez de uma tela branca,
 * com acção de recarregamento. (Regra de resiliência da Fase 1.)
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Erro inesperado.',
    };
  }

  componentDidCatch(error: unknown): void {
    console.error('[ErrorBoundary]', error);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleHome = (): void => {
    window.location.hash = '#/';
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-4 text-center font-sans">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
          <AlertTriangle className="h-8 w-8 text-red-400" />
        </span>
        <h1 className="mt-6 font-display text-3xl font-bold text-white">Algo correu mal</h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-400">
          A aplicação encontrou um erro inesperado e foi protegida contra uma tela branca.
          {this.state.message && (
            <span className="mt-2 block font-mono text-xs text-slate-600">{this.state.message}</span>
          )}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={this.handleReload}
            className="rounded-xl bg-gold-gradient px-6 py-3 text-sm font-semibold text-navy-950 shadow-award transition hover:brightness-110"
          >
            Recarregar a página
          </button>
          <button
            onClick={this.handleHome}
            className="rounded-xl border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:border-gold-500/60"
          >
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }
}
