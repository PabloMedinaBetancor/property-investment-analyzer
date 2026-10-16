import { EngineError } from '../engine/client';
import type { ClientErrorCode } from '../engine/client';
import type { MessageKey } from './en';

// What the page keeps of a failed call: the code and the field; the engine's English text goes to the console.
export interface Failure {
  code: Exclude<ClientErrorCode, 'superseded'>;
  field: string;
}

type FieldLabel = Extract<MessageKey, `field.${string}`>;

const LABELS: Record<string, FieldLabel> = {
  profile: 'field.profile',
  region: 'field.region',
  new_build: 'field.newBuild',
  price: 'field.price',
  'purchase.transfer_tax_rate': 'field.transferTaxRate',
  'purchase.closing_cost_rate': 'field.closingCostRate',
  'purchase.closing_cost_fixed': 'field.closingCostFixed',
  'purchase.buyer_agency_rate': 'field.buyerAgencyRate',
  reference_value: 'field.referenceValue',
  manual_transfer_rate: 'field.manualTransferRate',
  notary_extras: 'field.notaryExtras',
  gestoria: 'field.gestoria',
  buyer_agency_rate: 'field.buyerAgencyRate',
  renovation: 'field.renovation',
  ltv: 'field.ltv',
  'loan.kind': 'field.loanKind',
  'loan.fixed_rate': 'field.fixedRate',
  'loan.fixed_years': 'field.fixedYears',
  'loan.spread': 'field.spread',
  'loan.index': 'field.indexRate',
  'loan.index_path': 'field.indexPath',
  'loan.term_years': 'field.termYears',
  loan_fees: 'field.loanFees',
  rent_month: 'field.rentMonth',
  vacancy: 'field.vacancy',
  g_rent: 'field.gRent',
  property_tax_rate: 'field.propertyTaxRate',
  ibi: 'field.ibi',
  community: 'field.community',
  insurance: 'field.insurance',
  other_fixed: 'field.otherFixed',
  maintenance_rate: 'field.maintenanceRate',
  management_rate: 'field.managementRate',
  g_exp: 'field.gExp',
  'tax.on': 'field.taxOn',
  'tax.offset_other_income': 'field.offsetOtherIncome',
  'tax.interest_deductible': 'field.interestDeductible',
  'tax.offset_losses': 'field.offsetLosses',
  'tax.rate': 'field.taxRate',
  'tax.depreciation_years': 'field.depreciationYears',
  'tax.building_share': 'field.buildingShare',
  'tax.capital_gains_rate': 'field.capitalGainsRate',
  'tax.depreciation_recapture_rate': 'field.recaptureRate',
  'tax.marginal': 'field.marginal',
  'tax.reduction': 'field.reduction',
  'tax.construction_share': 'field.constructionShare',
  years: 'field.years',
  g_app: 'field.gApp',
  sell_rate: 'field.sellRate',
  municipal_gain_tax: 'field.municipalGainTax',
  discount_rate: 'field.discountRate',
  n: 'field.n',
  seed: 'field.seed',
  'params.kappa': 'field.kappa',
  'params.sigma_index': 'field.sigmaIndex',
  'params.sigma_rent': 'field.sigmaRent',
  'params.sigma_app': 'field.sigmaApp',
  'params.sigma_exp': 'field.sigmaExp',
};

// The engine names an element of the index path as «loan.index_path[2]»; the form has one field for the path.
const withoutIndex = (field: string) => field.replace(/\[\d+\]$/, '');

export function failureOf(error: unknown): Failure | undefined {
  const { code, field } =
    error instanceof EngineError ? error : { code: 'worker_failed' as const, field: '' };
  if (code === 'superseded') return undefined;
  console.error(error);
  return { code, field };
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

// Names the field as the form does; a path the form does not know is shown as the engine wrote it.
export function failureText(t: Translate, { code, field }: Failure): string {
  const path = withoutIndex(field);
  const labelKey = LABELS[path];
  const name = labelKey === undefined ? path : t(labelKey);
  switch (code) {
    case 'out_of_range':
      return t('engine.outOfRange', { field: name });
    case 'not_finite':
      return field === 'result'
        ? t('engine.notFiniteResult')
        : t('engine.notFinite', { field: name });
    case 'missing_field':
      return t('engine.missingField', { field: name });
    case 'invalid_json':
      return t('engine.invalidJson');
    case 'unknown_region':
      return t('error.unknownRegion');
    case 'bad_correlation':
      return t('error.badCorrelation');
    case 'too_many_scenarios':
      return t('error.tooManyScenarios');
    case 'worker_failed':
      return t('engine.workerFailed');
  }
}
