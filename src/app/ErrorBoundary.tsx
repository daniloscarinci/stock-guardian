/**
 * Catches a rendering failure and shows something a person can act on.
 *
 * Without this, a thrown error in any component unmounts the whole tree and
 * leaves a blank page - which for an inventory application looks exactly like
 * "my data is gone". The message says plainly that nothing was changed, because
 * that is the user's real question.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../components/ui/primitives';
import { translate } from '../i18n/translate';
import type { Language } from '../domain/settings';
import styles from './StartupScreen.module.css';

interface Props {
  readonly language: Language;
  readonly children: ReactNode;
}

interface State {
  readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console only. Sending this anywhere would be a network request, and this
    // application makes none.
    console.error('[stock-guardian] Render error:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    const t = (key: string) => translate(this.props.language, key);

    return (
      <div className={styles.screen}>
        <div className={styles.panel} role="alert">
          <h1 className={styles.title}>{t('errors.genericTitle')}</h1>
          <p className={styles.body}>{t('errors.genericBody')}</p>

          <div className={styles.actions}>
            <Button
              variant="primary"
              onClick={() => {
                this.setState({ error: null });
              }}
            >
              {t('common.retry')}
            </Button>
            <Button
              onClick={() => {
                window.location.reload();
              }}
            >
              {t('errors.reload')}
            </Button>
          </div>

          <details className={styles.details}>
            <summary>{t('errors.technicalDetails')}</summary>
            <p className={styles.detailsBody}>
              {error.name}: {error.message}
              {error.stack === undefined ? '' : `\n\n${error.stack}`}
            </p>
          </details>
        </div>
      </div>
    );
  }
}
