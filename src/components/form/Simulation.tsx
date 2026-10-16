import { useT } from '../../i18n';
import type { McParams } from '../../engine/types';
import { mcFieldErrors } from '../../model/validate';
import { NumberField } from './fields';
import type { Errors, Form, Value } from './fields';
import { setAt } from './path';

export interface McSettings {
  n: number;
  seed: number;
  params: McParams;
}

const MAX_SEED = 2 ** 32 - 1;
const SEED_LIMIT = { min: 0, max: MAX_SEED, integer: true };

// Index, rent, value and expenses: the order of the rows of the correlation matrix.
const DRIVERS = ['index', 'rent', 'app', 'exp'] as const;
const PAIRS = DRIVERS.flatMap((a, i) =>
  DRIVERS.slice(i + 1).map((b, k) => [a, b, i, i + 1 + k] as const),
);

export function mcErrors(mc: McSettings): Errors {
  const errors = mcFieldErrors(mc.n, mc.params);
  if (!Number.isFinite(mc.seed)) errors['seed'] = 'error.notNumber';
  else if (!Number.isInteger(mc.seed)) errors['seed'] = 'error.notInteger';
  else if (mc.seed < 0 || mc.seed > MAX_SEED) errors['seed'] = 'error.outOfRange';
  return errors;
}

interface Props {
  mc: McSettings;
  onChange: (mc: McSettings) => void;
}

export function Simulation({ mc, onChange }: Props) {
  const t = useT();
  const errors = mcErrors(mc);
  // The matrix is symmetric: editing one cell writes its mirror.
  const set = (path: string, value: Value) => {
    const cell = /^params\.corr\.(\d)\.(\d)$/.exec(path);
    const mirrored = cell ? setAt(mc, `params.corr.${cell[2] ?? ''}.${cell[1] ?? ''}`, value) : mc;
    onChange(setAt(mirrored, path, value));
  };
  const form: Form = { values: mc, errors, set };
  return (
    <>
      <NumberField form={form} path="n" name="n" unit={t('unit.count')} />
      <NumberField form={form} path="seed" name="seed" limit={SEED_LIMIT} />
      <NumberField form={form} path="params.kappa" name="kappa" />
      <NumberField form={form} path="params.sigma_index" name="sigmaIndex" percent unit="%" />
      <NumberField form={form} path="params.sigma_rent" name="sigmaRent" percent unit="%" />
      <NumberField form={form} path="params.sigma_app" name="sigmaApp" percent unit="%" />
      <NumberField form={form} path="params.sigma_exp" name="sigmaExp" percent unit="%" />
      <details className="advanced">
        <summary>{t('section.advanced')}</summary>
        {PAIRS.map(([a, b, i, j]) => (
          <NumberField
            key={`${a}-${b}`}
            form={form}
            path={`params.corr.${i.toString()}.${j.toString()}`}
            name="corr"
            vars={{ a: t(`driver.${a}`), b: t(`driver.${b}`) }}
          />
        ))}
        {errors['params.corr'] ? (
          <p className="error" role="alert">
            {t(errors['params.corr'])}
          </p>
        ) : null}
      </details>
    </>
  );
}
