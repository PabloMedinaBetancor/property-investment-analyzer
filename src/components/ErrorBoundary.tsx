import { Component } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';

function Fallback({ onRestart }: { onRestart: () => void }) {
  const t = useT();
  return (
    <div className="notice" role="alert">
      <p>{t('error.crashed')}</p>
      <button type="button" onClick={onRestart}>
        {t('error.startAgain')}
      </button>
    </div>
  );
}

// A render error would otherwise unmount the whole app, and a bad link would repeat it at every reload.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Fallback
        onRestart={() => {
          window.location.hash = '#/';
          this.setState({ failed: false });
        }}
      />
    );
  }
}
