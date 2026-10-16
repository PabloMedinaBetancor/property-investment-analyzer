export type Profile = 'es' | 'generic';

export type Loan =
  | { kind: 'fixed'; fixed_rate: number; term_years: number }
  | { kind: 'variable'; spread: number; index: number; index_path?: number[]; term_years: number }
  | {
      kind: 'mixed';
      fixed_rate: number;
      fixed_years: number;
      spread: number;
      index: number;
      index_path?: number[];
      term_years: number;
    };

export interface TaxInput {
  on: boolean;
  // Spain
  marginal?: number;
  reduction?: number;
  construction_share?: number;
  offset_other_income?: boolean;
  // generic
  rate?: number;
  interest_deductible?: boolean;
  depreciation_years?: number;
  building_share?: number;
  offset_losses?: boolean;
  capital_gains_rate?: number;
  depreciation_recapture_rate?: number;
}

export interface GenericPurchase {
  transfer_tax_rate: number;
  closing_cost_rate: number;
  closing_cost_fixed: number;
  buyer_agency_rate: number;
}

// The wire format of the engine. The fields of the other profile may be present and are ignored.
export interface Inputs {
  name?: string;
  profile?: Profile;
  currency?: string;
  // Spain
  region?: string;
  new_build?: boolean;
  reference_value?: number | null;
  manual_transfer_rate?: number | null;
  notary_extras?: number;
  gestoria?: number;
  buyer_agency_rate?: number;
  // generic
  purchase?: GenericPurchase;
  property_tax_rate?: number;
  price: number;
  renovation: number;
  loan_fees: number;
  ltv: number;
  loan: Loan;
  rent_month: number;
  vacancy: number;
  ibi: number;
  community: number;
  insurance: number;
  other_fixed: number;
  maintenance_rate: number;
  management_rate: number;
  g_rent: number;
  g_exp: number;
  g_app: number;
  years: number;
  value0?: number | null;
  sell_rate: number;
  municipal_gain_tax: number;
  discount_rate: number;
  tax: TaxInput;
}

export interface Acquisition {
  transfer_tax: number;
  notary?: number;
  registry?: number;
  acq_costs: number;
  loan: number;
  total_investment: number;
  equity0: number;
}

export interface YearRow {
  t: number;
  rent_gross: number;
  vacancy: number;
  rent_collected: number;
  opex: number;
  noi: number;
  interest: number;
  principal: number;
  debt_service: number;
  loan_rate: number;
  balance_end: number;
  cf_pre_tax: number;
  tax: number;
  cf_after_tax: number;
  value_end: number;
}

export interface ExitRow {
  value: number;
  sale_costs: number;
  loan_payoff: number;
  gain: number;
  cgt: number;
  equity_back_pre_tax: number;
  equity_back_after_tax: number;
}

export type Irr =
  | { kind: 'Unique'; rate: number }
  | { kind: 'Multiple'; rates: number[] }
  | { kind: 'None'; reason: 'NoSignChange' | 'OutOfRange' };

export interface Metrics {
  gross_yield: number;
  net_yield: number;
  cap_rate: number;
  cash_on_cash_1: number | null;
  npv: number;
  irr: Irr;
  irr_pre_tax: Irr;
  mirr: number | null;
  payback_years: number | null;
  dscr: number | null;
  grm: number;
  one_percent_ratio: number;
  break_even_occupancy: number;
}

export interface MonthRow {
  month: number;
  rate: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface Analysis {
  acquisition: Acquisition;
  years: YearRow[];
  exit: ExitRow;
  flows: number[];
  flows_pre_tax: number[];
  cumulative: number[];
  metrics: Metrics;
  amortisation_taken?: number;
  schedule: MonthRow[];
}

export interface McParams {
  kappa: number;
  sigma_index: number;
  sigma_rent: number;
  sigma_app: number;
  sigma_exp: number;
  corr: number[][];
}

export interface McRequest {
  inputs: Inputs;
  params: McParams;
  n: number;
  seed: number;
}

// A percentile among the scenarios with an IRR; "below" is under -99 % and "above" over 1 000 %.
export type IrrPoint = number | 'below' | 'above';

export interface Histogram {
  edges: number[];
  counts: number[];
  below: number;
  above: number;
}

export interface McResult {
  irr_p: [IrrPoint, IrrPoint, IrrPoint] | null;
  npv_p: [number, number, number];
  p_npv_negative: number;
  cum_p_by_year: [number, number, number][];
  irr_multiple_count: number;
  irr_bottom_count: number;
  irr_top_count: number;
  npv_histogram: Histogram;
}

export type SensitivityVariable =
  'price' | 'rent' | 'vacancy' | 'interest' | 'appreciation' | 'rent_growth' | 'opex';

export interface SensitivityBar {
  variable: SensitivityVariable;
  low_value: number;
  high_value: number;
  npv_low: number;
  npv_high: number;
  irr_low: Irr;
  irr_high: Irr;
}

export interface Sensitivity {
  base: { npv: number; irr: Irr };
  bars: SensitivityBar[];
}

export type ErrorCode =
  | 'invalid_json'
  | 'missing_field'
  | 'not_finite'
  | 'out_of_range'
  | 'unknown_region'
  | 'bad_correlation'
  | 'too_many_scenarios';

export interface EngineErrorInfo {
  code: ErrorCode;
  field: string;
  message: string;
}

export type Envelope<T> = { ok: true; value: T } | { ok: false; error: EngineErrorInfo };
