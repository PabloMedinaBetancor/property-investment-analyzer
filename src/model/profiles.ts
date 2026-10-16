import generic from '../../data/generic-profiles.json';
import spain from '../../data/es-2026.json';

export type ProfileId = 'es' | 'generic' | 'us-example';

export interface Localised {
  en: string;
  es: string;
}

export interface Region {
  code: string;
  name: Localised;
  verified: boolean;
  newBuildVat: number | null;
}

export interface GenericProfile {
  code: ProfileId;
  label: Localised;
  currency: string;
  purchase: {
    transfer_tax_rate: number;
    closing_cost_rate: number;
    closing_cost_fixed: number;
    buyer_agency_rate: number;
  };
  holding: {
    property_tax_rate: number;
    insurance_per_year: number;
    hoa_per_month: number;
    other_fixed_per_year: number;
  };
  income_tax: {
    on: boolean;
    rate: number;
    interest_deductible: boolean;
    depreciation_years: number;
    building_share: number;
    offset_losses: boolean;
  };
  exit: {
    selling_cost_rate: number;
    capital_gains_rate: number;
    depreciation_recapture_rate: number;
  };
}

export const ratesAsOf: string = spain.rates_as_of;

export const spainData = spain;

export const profiles: { id: ProfileId; label: Localised; currency: string }[] = [
  { id: 'es', label: spain.label, currency: 'EUR' },
  ...generic.profiles.map((p) => ({
    id: p.code as ProfileId,
    label: p.label,
    currency: p.currency,
  })),
];

// A region without its own `new_build_vat` key uses the national rate; `null` means IPSI (Ceuta, Melilla),
// where no VAT rate is known and the buyer must give the transfer rate.
export function regions(): Region[] {
  return spain.regions.map((r) => ({
    code: r.code,
    name: r.name,
    verified: r.verified,
    newBuildVat: r.new_build_vat === undefined ? spain.new_build_vat_default.rate : r.new_build_vat,
  }));
}

export function genericProfile(id: 'generic' | 'us-example'): GenericProfile {
  const found = (generic.profiles as GenericProfile[]).find((p) => p.code === id);
  if (!found) throw new Error(`profile ${id} is not in data/generic-profiles.json`);
  return found;
}
