import { mcErrors } from '../components/form/Simulation';
import type { McSettings } from '../components/form/Simulation';
import type { Inputs, Profile } from '../engine/types';
import { defaultInputs, defaultMc, defaultTax } from './defaults';

// `mc` is present only when the link carried simulation settings that differ from the defaults.
export type DecodeResult = { inputs: Inputs; mc?: McSettings } | { error: 'version' | 'payload' };

const VERSION = '1';
const LOAN_KINDS = ['fixed', 'variable', 'mixed'];
// Keys that have no default: a label and an optional starting value.
const OPTIONAL_KEYS = ['name', 'value0'];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function baseFor(profile: unknown): Inputs | null {
  return profile === 'es' || profile === 'generic' ? defaultInputs(profile) : null;
}

// Same JSON type as the default's; null is allowed where the default is null (an optional number) or the other way round.
function sameKind(value: unknown, base: unknown): boolean {
  if (value === null || base === null)
    return typeof value === 'number' || typeof base === 'number' || value === base;
  return typeof value === typeof base && Array.isArray(value) === Array.isArray(base);
}

// What the nested objects may carry, by the type of each field (the engine refuses anything else). `index_path` is
// checked on its own, and the tax holds the fields of both profiles because the other profile's are ignored.
type FieldType = 'number' | 'boolean' | 'string';
const LOAN_FIELDS: Record<string, FieldType> = {
  kind: 'string',
  fixed_rate: 'number',
  fixed_years: 'number',
  spread: 'number',
  index: 'number',
  term_years: 'number',
};
const TAX_FIELDS: Record<string, FieldType> = {
  on: 'boolean',
  marginal: 'number',
  reduction: 'number',
  construction_share: 'number',
  offset_other_income: 'boolean',
  rate: 'number',
  interest_deductible: 'boolean',
  depreciation_years: 'number',
  building_share: 'number',
  offset_losses: 'boolean',
  capital_gains_rate: 'number',
  depreciation_recapture_rate: 'number',
};
const PURCHASE_FIELDS: Record<string, FieldType> = {
  transfer_tax_rate: 'number',
  closing_cost_rate: 'number',
  closing_cost_fixed: 'number',
  buyer_agency_rate: 'number',
};

function hasOnlyKnownFields(value: Json, fields: Record<string, FieldType>): boolean {
  return Object.entries(value).every(
    ([key, item]) =>
      key === 'index_path' || (Object.hasOwn(fields, key) && typeof item === fields[key]),
  );
}

// A lone surrogate (JSON `\ud800`) is legal in a JSON.parse string but not in the engine's.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function wellFormedStrings(value: unknown): boolean {
  if (typeof value === 'string') return !LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.every(wellFormedStrings);
  return !isObject(value) || Object.values(value).every(wellFormedStrings);
}

// A structural check only: ranges are validate.ts's job, but nothing the form or the worker would trip over.
export function isInputs(value: unknown): value is Inputs {
  if (!isObject(value)) return false;
  const base = baseFor(value['profile'] ?? 'es');
  if (!base) return false;
  const known = new Set([...Object.keys(base), ...OPTIONAL_KEYS]);
  if (Object.keys(value).some((key) => !known.has(key))) return false;
  for (const [key, expected] of Object.entries(base)) {
    if (!sameKind(value[key], expected)) return false;
  }
  // Intl.NumberFormat throws on anything but a three-letter code, which would blank the page at the first amount.
  const { currency, loan, tax } = value;
  if (currency !== undefined && !(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)))
    return false;
  // The label is rendered and trimmed, the starting value is a number or an empty one.
  const { name, value0 } = value;
  if (name !== undefined && typeof name !== 'string') return false;
  if (value0 !== undefined && value0 !== null && typeof value0 !== 'number') return false;
  if (!isObject(loan) || !LOAN_KINDS.includes(loan['kind'] as string)) return false;
  const path = loan['index_path'];
  if (path !== undefined && !(Array.isArray(path) && path.every((x) => typeof x === 'number')))
    return false;
  if (!isObject(tax) || typeof tax['on'] !== 'boolean') return false;
  const purchase = value['purchase'];
  return (
    (purchase === undefined || isObject(purchase)) &&
    hasOnlyKnownFields(loan, LOAN_FIELDS) &&
    hasOnlyKnownFields(tax, TAX_FIELDS) &&
    (purchase === undefined || hasOnlyKnownFields(purchase, PURCHASE_FIELDS)) &&
    wellFormedStrings(value)
  );
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(payload: string): string {
  const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

function changed(value: object, base: object): Json {
  const diff: Json = {};
  for (const [key, item] of Object.entries(value)) {
    if (!sameJson(item, (base as Json)[key])) diff[key] = item;
  }
  return diff;
}

// The simulation settings that differ from the defaults; the correlation matrix travels whole when any cell differs.
function mcChanges(mc: McSettings): Json {
  const changes = changed({ n: mc.n, seed: mc.seed }, defaultMc);
  const params = changed(mc.params, defaultMc.params);
  return Object.keys(params).length > 0 ? { ...changes, params } : changes;
}

const MC_KEYS = ['n', 'seed', 'params'];
const PARAM_KEYS = Object.keys(defaultMc.params);

const hasOtherKeys = (value: Json, allowed: string[]) =>
  Object.keys(value).some((key) => !allowed.includes(key));

const isNumbers = (value: unknown, length: number) =>
  Array.isArray(value) && value.length === length && value.every((x) => typeof x === 'number');

function isMcSettings(value: unknown): value is McSettings {
  if (!isObject(value) || typeof value['n'] !== 'number' || typeof value['seed'] !== 'number') {
    return false;
  }
  const { params } = value;
  if (!isObject(params)) return false;
  const { corr, ...scalars } = params;
  return (
    Object.values(scalars).every((x) => typeof x === 'number') &&
    Array.isArray(corr) &&
    corr.length === 4 &&
    corr.every((row) => isNumbers(row, 4))
  );
}

// The defaults with the link's differences on top, or null when the link's `mc` is not valid simulation settings.
function restoreMc(changes: unknown): McSettings | null {
  if (!isObject(changes) || hasOtherKeys(changes, MC_KEYS)) return null;
  const params = changes['params'] ?? {};
  if (!isObject(params) || hasOtherKeys(params, PARAM_KEYS)) return null;
  const mc = { ...defaultMc, ...changes, params: { ...defaultMc.params, ...params } };
  return isMcSettings(mc) && Object.keys(mcErrors(mc)).length === 0 ? mc : null;
}

// «1.<payload>»: the fields that differ from the profile's defaults, plus the profile itself.
// Profile «es» is the absence of the `profile` key, as in the engine's input. Nested objects travel as their
// differences, except a loan of another kind, which travels whole; a tax that is off is the default and is left out.
// Simulation settings travel under `mc`, only the ones that differ, so a link without them still reads.
export function encode(inputs: Inputs, mc?: McSettings): string {
  const profile = inputs.profile ?? 'es';
  const base = defaultInputs(profile) as unknown as Json;
  const changes: Json = { profile };
  for (const [key, value] of Object.entries(inputs) as [string, unknown][]) {
    const baseValue = base[key];
    if (key === 'profile') continue;
    if (key === 'tax') {
      if (inputs.tax.on) changes[key] = { on: true, ...changed(inputs.tax, defaultTax(profile)) };
    } else if (isObject(value) && isObject(baseValue) && value['kind'] === baseValue['kind']) {
      const diff = changed(value, baseValue);
      if (Object.keys(diff).length > 0) changes[key] = diff;
    } else if (!sameJson(value, baseValue)) {
      changes[key] = value;
    }
  }
  const mcDiff = mc ? mcChanges(mc) : {};
  if (Object.keys(mcDiff).length > 0) changes['mc'] = mcDiff;
  return `${VERSION}.${toBase64Url(JSON.stringify(changes))}`;
}

function restore(profile: Profile, changes: Json): Json {
  const base = defaultInputs(profile) as unknown as Json;
  const merged: Json = { ...base, ...changes };
  for (const [key, value] of Object.entries(changes)) {
    const baseValue = base[key];
    if (key === 'tax' && isObject(value) && value['on'] === true) {
      merged[key] = { ...defaultTax(profile), ...value };
    } else if (isObject(value) && isObject(baseValue) && !('kind' in value)) {
      merged[key] = { ...baseValue, ...value };
    }
  }
  return merged;
}

export function decode(text: string): DecodeResult {
  const dot = text.indexOf('.');
  if (dot < 0 || text.slice(0, dot) !== VERSION) return { error: 'version' };
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(text.slice(dot + 1)));
    if (!isObject(parsed)) return { error: 'payload' };
    const { profile, mc: mcChanges, ...changes } = parsed;
    if (profile !== 'es' && profile !== 'generic') return { error: 'payload' };
    const merged = restore(profile, changes);
    if (!isInputs(merged)) return { error: 'payload' };
    if (mcChanges === undefined) return { inputs: merged };
    const mc = restoreMc(mcChanges);
    return mc ? { inputs: merged, mc } : { error: 'payload' };
  } catch {
    return { error: 'payload' };
  }
}
