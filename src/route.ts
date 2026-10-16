export type Route = 'analyze' | 'compare' | 'benchmark';

export interface Location {
  route: Route;
  query: URLSearchParams;
}

const ROUTES: Record<string, Route> = {
  '': 'analyze',
  '/': 'analyze',
  '/compare': 'compare',
  '/benchmark': 'benchmark',
};

// An unknown path shows the analyzer rather than an error page: the app has no server to answer a 404.
export function parseHash(hash: string): Location {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  const cut = text.indexOf('?');
  const path = cut < 0 ? text : text.slice(0, cut);
  const query = new URLSearchParams(cut < 0 ? '' : text.slice(cut + 1));
  return { route: ROUTES[path] ?? 'analyze', query };
}
