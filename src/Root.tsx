import { StrictMode } from 'react';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LocaleProvider } from './i18n';
import { getLang, setLang } from './model/storage';

export function Root() {
  return (
    <StrictMode>
      <LocaleProvider initial={getLang() ?? undefined} onChange={setLang}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </LocaleProvider>
    </StrictMode>
  );
}
