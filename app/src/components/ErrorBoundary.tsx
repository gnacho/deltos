import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { withTranslation } from 'react-i18next';
import type { WithTranslation } from 'react-i18next';

interface State {
  hasError: boolean;
}

/** Red de seguridad de render (anti pantalla negra): tarjeta con recarga. */
class ErrorBoundaryInner extends Component<{ children: ReactNode } & WithTranslation, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error('[deltos] render error:', err, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const { t } = this.props;
    return (
      <div className="grid place-items-center min-h-[50vh] px-4">
        <div className="rounded-2xl bg-surface border border-app shadow-soft p-8 text-center max-w-md">
          <h2 className="font-display font-semibold text-[17px]">{t('errorBoundary.title')}</h2>
          <p className="text-sm text-muted mt-2">{t('errorBoundary.desc')}</p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-5 px-5 h-11 rounded-xl bg-brand text-brandfg text-[14px] font-semibold hover:brightness-110"
          >
            {t('errorBoundary.reload')}
          </button>
        </div>
      </div>
    );
  }
}

const ErrorBoundary = withTranslation()(ErrorBoundaryInner);
export default ErrorBoundary;
