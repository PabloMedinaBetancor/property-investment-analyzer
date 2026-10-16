import type { Inputs, McParams, TaxInput } from '../engine/types';
import { genericProfile, spainData, type ProfileId } from './profiles';

// What a loan field falls back to when the person switches the kind of loan, or empties it with no loan.
export const LOAN_DEFAULTS = {
  fixed_rate: 0.035,
  spread: 0.01,
  index: 0.025,
  fixed_years: 5,
  term_years: 25,
};

export const defaultRegion = 'MD';

// Typical split of a city flat between building and land; the cadastral receipt gives the real one.
const CONSTRUCTION_SHARE = 0.6;

export function defaultTax(profile: ProfileId): TaxInput {
  if (profile === 'es') {
    return {
      on: true,
      marginal: spainData.income_tax.marginal_rate_default.rate,
      reduction: spainData.income_tax.rent_reduction_options[0]?.rate ?? 0.5,
      construction_share: CONSTRUCTION_SHARE,
      offset_other_income: true,
    };
  }
  const { income_tax: tax, exit } = genericProfile(profile);
  return {
    on: true,
    rate: tax.rate,
    interest_deductible: tax.interest_deductible,
    depreciation_years: tax.depreciation_years,
    building_share: tax.building_share,
    offset_losses: tax.offset_losses,
    capital_gains_rate: exit.capital_gains_rate,
    depreciation_recapture_rate: exit.depreciation_recapture_rate,
  };
}

// The shape every profile shares. Each profile then fills in its own purchase costs and holding costs.
const common = {
  price: 200000,
  renovation: 0,
  ltv: 0.7,
  loan: { kind: 'fixed', fixed_rate: 0.035, term_years: 25 },
  rent_month: 900,
  vacancy: 0.05,
  maintenance_rate: 0.05,
  management_rate: 0,
  g_rent: 0.02,
  g_exp: 0.02,
  g_app: 0.02,
  years: 10,
  discount_rate: 0.06,
  tax: { on: false },
} as const;

export function defaultInputs(profile: ProfileId = 'es', region: string = defaultRegion): Inputs {
  if (profile === 'es') {
    return {
      ...common,
      loan: { ...common.loan },
      tax: { ...common.tax },
      region,
      new_build: false,
      reference_value: null,
      manual_transfer_rate: null,
      notary_extras: spainData.fees.notary_purchase.extras_default,
      gestoria: spainData.fees.gestoria_default.amount,
      buyer_agency_rate: spainData.fees.buyer_agency_default.rate,
      loan_fees: 400,
      ibi: 400,
      community: spainData.holding.community_default.amount_per_year,
      insurance: spainData.holding.insurance_default.amount_per_year,
      other_fixed: 0,
      sell_rate: 0.05,
      municipal_gain_tax: 0,
    };
  }
  const p = genericProfile(profile);
  return {
    ...common,
    loan: { ...common.loan },
    tax: { ...common.tax },
    profile: 'generic',
    currency: p.currency,
    purchase: { ...p.purchase },
    property_tax_rate: p.holding.property_tax_rate,
    loan_fees: 0,
    ibi: 0,
    community: p.holding.hoa_per_month * 12,
    insurance: p.holding.insurance_per_year,
    other_fixed: p.holding.other_fixed_per_year,
    sell_rate: p.exit.selling_cost_rate,
    municipal_gain_tax: 0,
  };
}

export const defaultMc: { n: number; seed: number; params: McParams } = {
  n: 10000,
  seed: 42,
  params: {
    kappa: 0.15,
    sigma_index: 0.008,
    sigma_rent: 0.02,
    sigma_app: 0.05,
    sigma_exp: 0.01,
    corr: [
      [1, 0, 0, 0.3],
      [0, 1, 0.5, 0.4],
      [0, 0.5, 1, 0.2],
      [0.3, 0.4, 0.2, 1],
    ],
  },
};
