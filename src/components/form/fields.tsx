import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocale, useT } from '../../i18n';
import type { Locale, MessageKey } from '../../i18n';
import { parseNumber } from '../../i18n/parse';
import { fromPercent, toPercent } from '../../model/units';
import { limits } from '../../model/validate';
import type { ErrorKey, Limit } from '../../model/validate';
import { getAt } from './path';

export type Errors = Record<string, ErrorKey>;
export type Value = number | number[] | boolean | string | null | undefined;

export interface Form {
  values: object;
  errors: Errors;
  set: (path: string, value: Value) => void;
}

// Every `field.<name>` of the catalogue; a test checks that each also has its `help.<name>`.
export type FieldName = MessageKey extends infer K
  ? K extends `field.${infer N}`
    ? N
    : never
  : never;

interface Labels {
  name: FieldName;
  // Fills the {a} and {b} of the label (the correlation fields).
  vars?: Record<string, string>;
  // Shown but not editable (a loan field when there is no loan).
  disabled?: boolean;
}

function plain(x: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 10 }).format(x);
}

// «Enter a value from 0 to 50»: the limits are shown in the unit of the field, so 0.5 reads 50 in a percent field.
function useErrorText() {
  const t = useT();
  const { locale } = useLocale();
  return (
    key: ErrorKey | undefined,
    limit: Limit | undefined,
    percent = false,
  ): string | undefined => {
    if (key === undefined) return undefined;
    if (key !== 'error.outOfRange' || !limit) return t(key);
    const show = (x: number) => plain(percent ? toPercent(x) : x, locale);
    return t(limit.minOpen ? 'error.outOfRangeOpen' : 'error.outOfRange', {
      min: show(limit.min),
      max: show(limit.max),
    });
  };
}

function Frame({
  labels,
  error,
  unit,
  children,
}: {
  labels: Labels;
  error: string | undefined;
  unit?: string | undefined;
  children: (inputId: string, errorId: string | undefined) => ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const label = t(`field.${labels.name}`, labels.vars);
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="help-toggle"
          aria-expanded={open}
          aria-controls={`${id}-help`}
          aria-label={t('form.help', { field: label })}
          onClick={() => {
            setOpen(!open);
          }}
        >
          ?
        </button>
      </div>
      <div className="field-body">
        {children(id, errorId)}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {open ? (
        <p id={`${id}-help`} className="help">
          {t(`help.${labels.name}`)}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface NumberProps extends Labels {
  form: Form;
  path: string;
  unit?: string;
  percent?: boolean;
  // An empty box means «not given» (null) instead of an error.
  optional?: boolean;
  // For fields the engine's table does not list (the seed).
  limit?: Limit;
}

// What a person typed, as the model value: empty is null or NaN, text that is not a number is NaN.
function modelValue(text: string, props: NumberProps, locale: Locale): number | null {
  if (text.trim() === '') return props.optional ? null : Number.NaN;
  const parsed = parseNumber(text, locale);
  if (parsed === null) return Number.NaN;
  return props.percent ? fromPercent(parsed) : parsed;
}

function shownValue(value: unknown, percent: boolean | undefined, locale: Locale): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return plain(percent ? toPercent(value) : value, locale);
}

export function NumberField(props: NumberProps) {
  const t = useT();
  const { locale } = useLocale();
  const { form, path, percent } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const value = getAt(form.values, path);
  // The draft is kept while it still means the model value, so «3,» is not rewritten to «3» under the cursor.
  const draftMeans = draft !== null && Object.is(modelValue(draft, props, locale), value);
  const text = draftMeans ? draft : shownValue(value, percent, locale);
  const key = form.errors[path];
  const message = useErrorText();
  const limit = props.limit ?? limits[path];
  const error =
    key === 'error.notNumber' && text.trim() === ''
      ? t('error.required')
      : message(key, limit, percent);
  return (
    <Frame labels={props} error={error} unit={props.unit}>
      {(id, errorId) => (
        <input
          id={id}
          type="text"
          // The decimal keypad of some phones has no minus key.
          inputMode={limit && limit.min < 0 ? 'text' : 'decimal'}
          value={text}
          aria-invalid={error !== undefined}
          aria-describedby={errorId}
          disabled={props.disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            form.set(path, modelValue(event.target.value, props, locale));
          }}
        />
      )}
    </Frame>
  );
}

interface TextProps extends Labels {
  form: Form;
  path: string;
}

export function TextField({ form, path, ...labels }: TextProps) {
  const value = getAt(form.values, path);
  return (
    <Frame labels={labels} error={undefined}>
      {(id) => (
        <input
          id={id}
          type="text"
          className="words"
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            form.set(path, event.target.value === '' ? undefined : event.target.value);
          }}
        />
      )}
    </Frame>
  );
}

interface SelectProps extends Labels {
  value: string;
  options: { value: string; label: string }[];
  error?: ErrorKey | undefined;
  onChange: (value: string) => void;
}

export function SelectField({ value, options, error, onChange, ...labels }: SelectProps) {
  const t = useT();
  return (
    <Frame labels={labels} error={error ? t(error) : undefined}>
      {(id, errorId) => (
        <select
          id={id}
          value={value}
          aria-invalid={error !== undefined}
          aria-describedby={errorId}
          disabled={labels.disabled}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Frame>
  );
}

interface CheckProps extends Labels {
  checked: boolean;
  error?: ErrorKey | undefined;
  onChange: (checked: boolean) => void;
}

export function CheckField({ checked, error, onChange, ...labels }: CheckProps) {
  const t = useT();
  return (
    <Frame labels={labels} error={error ? t(error) : undefined}>
      {(id, errorId) => (
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={errorId}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
      )}
    </Frame>
  );
}

interface IndexPathProps extends Labels {
  form: Form;
  path: string;
}

function parsePath(text: string, locale: Locale): number[] | undefined {
  if (text.trim() === '') return undefined;
  return text.split(';').map((part) => {
    const parsed = parseNumber(part, locale);
    return parsed === null ? Number.NaN : fromPercent(parsed);
  });
}

function showPath(value: unknown, locale: Locale): string {
  if (!Array.isArray(value)) return '';
  return value.map((x) => plain(toPercent(Number(x)), locale)).join('; ');
}

// One yearly index per entry, typed as «2,5; 2,8; 3» in percent.
export function IndexPathField({ form, path, ...labels }: IndexPathProps) {
  const message = useErrorText();
  const { locale } = useLocale();
  const [draft, setDraft] = useState<string | null>(null);
  const value = getAt(form.values, path);
  const draftMeans =
    draft !== null &&
    JSON.stringify(parsePath(draft, locale)) === JSON.stringify(value ?? undefined);
  const text = draftMeans ? draft : showPath(value, locale);
  const badEntry = Object.keys(form.errors).find((key) => key.startsWith(`${path}[`));
  const key = form.errors[path] ?? (badEntry ? form.errors[badEntry] : undefined);
  return (
    <Frame labels={labels} error={message(key, limits['loan.index'], true)} unit="%">
      {(id, errorId) => (
        <input
          id={id}
          type="text"
          value={text}
          aria-invalid={key !== undefined}
          aria-describedby={errorId}
          disabled={labels.disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            form.set(path, parsePath(event.target.value, locale));
          }}
        />
      )}
    </Frame>
  );
}
