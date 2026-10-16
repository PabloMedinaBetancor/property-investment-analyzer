import { useEffect, useRef } from 'react';
import { useLocale, useT } from '../../i18n';
import type { MessageKey } from '../../i18n';
import type { Inputs, Loan, TaxInput } from '../../engine/types';
import { defaultInputs, defaultTax, LOAN_DEFAULTS } from '../../model/defaults';
import { profiles, regions } from '../../model/profiles';
import { fixedYearsLimit } from '../../model/validate';
import type { ProfileId } from '../../model/profiles';
import { CheckField, IndexPathField, NumberField, SelectField, TextField } from './fields';
import type { Form } from './fields';
import { currencyOf } from '../results/currency';
import { getAt } from './path';

export interface SectionProps {
  inputs: Inputs;
  form: Form;
  replace: (inputs: Inputs) => void;
}

// What carries over when the market changes: the property and the deal, not the market's own costs and taxes.
const SHARED = [
  'name',
  'price',
  'renovation',
  'ltv',
  'loan',
  'rent_month',
  'vacancy',
  'maintenance_rate',
  'management_rate',
  'g_rent',
  'g_exp',
  'g_app',
  'years',
  'discount_rate',
] as const;

function profileOf(inputs: Inputs): ProfileId {
  if (inputs.profile !== 'generic') return 'es';
  return profiles.find((p) => p.id !== 'es' && p.currency === inputs.currency)?.id ?? 'generic';
}

function switchProfile(inputs: Inputs, id: ProfileId): Inputs {
  const next = defaultInputs(id);
  const kept = Object.fromEntries(
    SHARED.flatMap((key) => (key in inputs ? [[key, inputs[key]]] : [])),
  );
  return { ...next, ...kept };
}

function loanOfKind(kind: Loan['kind'], loan: Loan): Loan {
  const term_years = loan.term_years;
  const fixed_rate = loan.kind === 'variable' ? LOAN_DEFAULTS.fixed_rate : loan.fixed_rate;
  const spread = loan.kind === 'fixed' ? LOAN_DEFAULTS.spread : loan.spread;
  const index = loan.kind === 'fixed' ? LOAN_DEFAULTS.index : loan.index;
  const index_path = loan.kind === 'fixed' ? [] : (loan.index_path ?? []);
  const path = index_path.length > 0 ? { index_path } : {};
  if (kind === 'fixed') return { kind, fixed_rate, term_years };
  if (kind === 'variable') return { kind, spread, index, term_years, ...path };
  const fixed_years =
    loan.kind === 'mixed' ? loan.fixed_years : Math.min(LOAN_DEFAULTS.fixed_years, term_years);
  return { kind, fixed_rate, fixed_years, spread, index, term_years, ...path };
}

function useUnits(inputs: Inputs) {
  const t = useT();
  const currency = currencyOf(inputs);
  return {
    currency,
    perYear: t('unit.perYear', { currency }),
    perMonth: t('unit.perMonth', { currency }),
    years: t('unit.years'),
    pct: '%',
    pctPrice: t('unit.pctPrice'),
    pctRent: t('unit.pctRent'),
    pctYear: t('unit.pctYear'),
    pctSale: t('unit.pctSale'),
    pctValueYear: t('unit.pctValueYear'),
  };
}

const isGeneric = (inputs: Inputs) => inputs.profile === 'generic';

export function MarketSection({ inputs, form, replace }: SectionProps) {
  const t = useT();
  const { locale } = useLocale();
  const region = regions().find((r) => r.code === inputs.region);
  return (
    <>
      <SelectField
        name="profile"
        value={profileOf(inputs)}
        options={profiles.map((p) => ({ value: p.id, label: p.label[locale] }))}
        onChange={(id) => {
          replace(switchProfile(inputs, id as ProfileId));
        }}
      />
      {!isGeneric(inputs) && (
        <>
          <SelectField
            name="region"
            value={inputs.region ?? ''}
            error={form.errors['region']}
            options={regions().map((r) => ({ value: r.code, label: r.name[locale] }))}
            onChange={(code) => {
              form.set('region', code);
            }}
          />
          {region && !region.verified ? <p className="note">{t('note.regionApprox')}</p> : null}
          <SelectField
            name="newBuild"
            value={inputs.new_build === true ? 'new' : 'resale'}
            options={[
              { value: 'resale', label: t('option.resale') },
              { value: 'new', label: t('option.newBuild') },
            ]}
            onChange={(kind) => {
              form.set('new_build', kind === 'new');
            }}
          />
        </>
      )}
      <TextField form={form} path="name" name="name" />
    </>
  );
}

export function PurchaseSection({ inputs, form }: SectionProps) {
  const u = useUnits(inputs);
  // A new build in Ceuta or Melilla pays IPSI, which the engine does not model: the rate has to be typed.
  const rateRequired =
    inputs.new_build === true &&
    regions().find((r) => r.code === inputs.region)?.newBuildVat === null;
  return (
    <>
      <NumberField form={form} path="price" name="price" unit={u.currency} />
      {isGeneric(inputs) ? (
        <>
          <NumberField
            form={form}
            path="purchase.transfer_tax_rate"
            name="transferTaxRate"
            percent
            unit={u.pctPrice}
          />
          <NumberField
            form={form}
            path="purchase.closing_cost_rate"
            name="closingCostRate"
            percent
            unit={u.pctPrice}
          />
          <NumberField
            form={form}
            path="purchase.closing_cost_fixed"
            name="closingCostFixed"
            unit={u.currency}
          />
          <NumberField
            form={form}
            path="purchase.buyer_agency_rate"
            name="buyerAgencyRate"
            percent
            unit={u.pctPrice}
          />
        </>
      ) : (
        <>
          <NumberField
            form={form}
            path="reference_value"
            name="referenceValue"
            optional
            unit={u.currency}
          />
          <NumberField
            form={form}
            path="manual_transfer_rate"
            name={rateRequired ? 'manualTransferRateRequired' : 'manualTransferRate'}
            percent
            optional={!rateRequired}
            unit={u.pctPrice}
          />
          <NumberField form={form} path="notary_extras" name="notaryExtras" unit={u.currency} />
          <NumberField form={form} path="gestoria" name="gestoria" unit={u.currency} />
          <NumberField
            form={form}
            path="buyer_agency_rate"
            name="buyerAgencyRate"
            percent
            unit={u.pctPrice}
          />
        </>
      )}
      <NumberField form={form} path="renovation" name="renovation" unit={u.currency} />
    </>
  );
}

export function FinancingSection({ inputs, form, replace }: SectionProps) {
  const t = useT();
  const u = useUnits(inputs);
  const { loan } = inputs;
  // With no loan the engine ignores every loan field, so they are shown but cannot be edited.
  const noLoan = inputs.ltv === 0;
  const kinds: [Loan['kind'], MessageKey][] = [
    ['fixed', 'option.loanFixed'],
    ['variable', 'option.loanVariable'],
    ['mixed', 'option.loanMixed'],
  ];
  return (
    <>
      <NumberField form={form} path="ltv" name="ltv" percent unit={u.pctPrice} />
      <SelectField
        name="loanKind"
        value={loan.kind}
        disabled={noLoan}
        options={kinds.map(([value, key]) => ({ value, label: t(key) }))}
        onChange={(kind) => {
          replace({ ...inputs, loan: loanOfKind(kind as Loan['kind'], loan) });
        }}
      />
      {loan.kind !== 'variable' && (
        <NumberField
          form={form}
          path="loan.fixed_rate"
          name="fixedRate"
          percent
          unit={u.pctYear}
          disabled={noLoan}
        />
      )}
      {loan.kind === 'mixed' && (
        <NumberField
          form={form}
          path="loan.fixed_years"
          name="fixedYears"
          unit={u.years}
          disabled={noLoan}
          limit={fixedYearsLimit(inputs)}
        />
      )}
      {loan.kind !== 'fixed' && (
        <>
          <NumberField
            form={form}
            path="loan.spread"
            name="spread"
            percent
            unit={u.pctYear}
            disabled={noLoan}
          />
          <NumberField
            form={form}
            path="loan.index"
            name="indexRate"
            percent
            unit={u.pctYear}
            disabled={noLoan}
          />
          <IndexPathField form={form} path="loan.index_path" name="indexPath" disabled={noLoan} />
        </>
      )}
      <NumberField
        form={form}
        path="loan.term_years"
        name="termYears"
        unit={u.years}
        disabled={noLoan}
      />
      <NumberField
        form={form}
        path="loan_fees"
        name="loanFees"
        unit={u.currency}
        disabled={noLoan}
      />
    </>
  );
}

export function IncomeSection({ inputs, form }: SectionProps) {
  const u = useUnits(inputs);
  return (
    <>
      <NumberField form={form} path="rent_month" name="rentMonth" unit={u.perMonth} />
      <NumberField form={form} path="vacancy" name="vacancy" percent unit={u.pct} />
      <NumberField form={form} path="g_rent" name="gRent" percent unit={u.pctYear} />
    </>
  );
}

export function ExpensesSection({ inputs, form }: SectionProps) {
  const u = useUnits(inputs);
  return (
    <>
      {isGeneric(inputs) ? (
        <NumberField
          form={form}
          path="property_tax_rate"
          name="propertyTaxRate"
          percent
          unit={u.pctValueYear}
        />
      ) : (
        <NumberField form={form} path="ibi" name="ibi" unit={u.perYear} />
      )}
      <NumberField form={form} path="community" name="community" unit={u.perYear} />
      <NumberField form={form} path="insurance" name="insurance" unit={u.perYear} />
      <NumberField form={form} path="other_fixed" name="otherFixed" unit={u.perYear} />
      <NumberField
        form={form}
        path="maintenance_rate"
        name="maintenanceRate"
        percent
        unit={u.pctRent}
      />
      <NumberField
        form={form}
        path="management_rate"
        name="managementRate"
        percent
        unit={u.pctRent}
      />
      <NumberField form={form} path="g_exp" name="gExp" percent unit={u.pctYear} />
    </>
  );
}

export function TaxSection({ inputs, form, replace }: SectionProps) {
  const u = useUnits(inputs);
  const flag = (path: string) => getAt(inputs, path) === true;
  // The settings the person last had while tax was on, so that ticking the box off and on again keeps them.
  const kept = useRef<{ profile: ProfileId; tax: TaxInput } | null>(null);
  useEffect(() => {
    if (inputs.tax.on) kept.current = { profile: profileOf(inputs), tax: inputs.tax };
  }, [inputs]);
  return (
    <>
      <CheckField
        name="taxOn"
        checked={inputs.tax.on}
        onChange={(on) => {
          const profile = profileOf(inputs);
          const earlier = kept.current?.profile === profile ? kept.current.tax : null;
          replace({ ...inputs, tax: on ? (earlier ?? defaultTax(profile)) : { on: false } });
        }}
      />
      {inputs.tax.on && isGeneric(inputs) && (
        <>
          <NumberField form={form} path="tax.rate" name="taxRate" percent unit={u.pct} />
          <CheckField
            name="interestDeductible"
            checked={flag('tax.interest_deductible')}
            onChange={(on) => {
              form.set('tax.interest_deductible', on);
            }}
          />
          <NumberField
            form={form}
            path="tax.depreciation_years"
            name="depreciationYears"
            unit={u.years}
          />
          <NumberField
            form={form}
            path="tax.building_share"
            name="buildingShare"
            percent
            unit={u.pctPrice}
          />
          <CheckField
            name="offsetLosses"
            checked={flag('tax.offset_losses')}
            onChange={(on) => {
              form.set('tax.offset_losses', on);
            }}
          />
          <NumberField
            form={form}
            path="tax.capital_gains_rate"
            name="capitalGainsRate"
            percent
            unit={u.pct}
          />
          <NumberField
            form={form}
            path="tax.depreciation_recapture_rate"
            name="recaptureRate"
            percent
            unit={u.pct}
          />
        </>
      )}
      {inputs.tax.on && !isGeneric(inputs) && (
        <>
          <NumberField form={form} path="tax.marginal" name="marginal" percent unit={u.pct} />
          <NumberField form={form} path="tax.reduction" name="reduction" percent unit={u.pct} />
          <NumberField
            form={form}
            path="tax.construction_share"
            name="constructionShare"
            percent
            unit={u.pctPrice}
          />
          <CheckField
            name="offsetOtherIncome"
            checked={flag('tax.offset_other_income')}
            onChange={(on) => {
              form.set('tax.offset_other_income', on);
            }}
          />
        </>
      )}
    </>
  );
}

export function ExitSection({ inputs, form }: SectionProps) {
  const u = useUnits(inputs);
  return (
    <>
      <NumberField form={form} path="years" name="years" unit={u.years} />
      <NumberField form={form} path="g_app" name="gApp" percent unit={u.pctYear} />
      <NumberField form={form} path="sell_rate" name="sellRate" percent unit={u.pctSale} />
      {!isGeneric(inputs) && (
        <NumberField
          form={form}
          path="municipal_gain_tax"
          name="municipalGainTax"
          unit={u.currency}
        />
      )}
      <NumberField form={form} path="discount_rate" name="discountRate" percent unit={u.pctYear} />
    </>
  );
}
