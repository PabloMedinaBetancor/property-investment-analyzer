type Node = Record<string, unknown> | unknown[];

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null;

export function getAt(root: object, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (!isNode(node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

// Copies the objects on the way down and leaves the rest shared; `undefined` removes the key.
export function setAt<T extends object>(root: T, path: string, value: unknown): T {
  const [key, ...rest] = path.split('.');
  if (key === undefined) return root;
  const record = (Array.isArray(root) ? [...root] : { ...root }) as Record<string, unknown>;
  const current = record[key];
  const next =
    rest.length === 0 ? value : setAt(isNode(current) ? current : {}, rest.join('.'), value);
  if (next === undefined) {
    return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key)) as T;
  }
  record[key] = next;
  return record as T;
}
