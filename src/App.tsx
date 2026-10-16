import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from './i18n';
import type { MessageKey } from './i18n';
import { SkipLink } from './components/SkipLink';
import { AnalyzePage } from './pages/AnalyzePage';
import { BenchmarkPage } from './pages/BenchmarkPage';
import { ComparePage } from './pages/ComparePage';
import { parseHash, type Route } from './route';

const LINKS: { route: Route; href: string; label: MessageKey }[] = [
  { route: 'analyze', href: '#/', label: 'nav.analyze' },
  { route: 'compare', href: '#/compare', label: 'nav.compare' },
  { route: 'benchmark', href: '#/benchmark', label: 'nav.benchmark' },
];

export function App() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const [location, setLocation] = useState(() => parseHash(window.location.hash));
  // The Analyze page keeps the scenario in its address; the link back to it must not drop what was edited.
  const lastAnalysis = useRef('#/');

  useEffect(() => {
    const onChange = (event: HashChangeEvent) => {
      // Whatever way the person leaves the Analyze page (the top navigation, the toolbar's Compare link, the
      // back button), its address, which carries the edited scenario, is what the Analyze link returns to.
      const left = new URL(event.oldURL).hash;
      if (parseHash(left).route === 'analyze') lastAnalysis.current = left || '#/';
      setLocation(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  return (
    <>
      {location.route === 'analyze' && <SkipLink target="results" label={t('skip.results')} />}
      <header className="app-header">
        <h1 className="app-title">{t('app.title')}</h1>
        <nav className="app-nav" aria-label={t('nav.label')}>
          {LINKS.map((link) => (
            <a
              key={link.route}
              href={link.href}
              aria-current={link.route === location.route ? 'page' : undefined}
              onClick={(event) => {
                if (location.route !== 'analyze' && link.route === 'analyze') {
                  event.preventDefault();
                  window.location.hash = lastAnalysis.current;
                }
              }}
            >
              {t(link.label)}
            </a>
          ))}
        </nav>
        <div className="app-lang" role="group" aria-label={t('lang.label')}>
          {(['en', 'es'] as const).map((code) => (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={locale === code}
              onClick={() => {
                setLocale(code);
              }}
            >
              {t(`lang.${code}`)}
            </button>
          ))}
        </div>
      </header>
      <main className="page">
        {location.route === 'analyze' && <AnalyzePage />}
        {location.route === 'compare' && <ComparePage />}
        {location.route === 'benchmark' && <BenchmarkPage />}
      </main>
    </>
  );
}
