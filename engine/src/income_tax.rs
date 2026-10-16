use crate::market::Schedule;

#[derive(Debug, Clone)]
pub enum TaxRules {
    None,
    Spain(SpainTax),
    Generic(GenericTax),
}

/// `amortisation_per_year = 0.03 * construction_share * basis`, capped at the construction basis.
#[derive(Debug, Clone)]
pub struct SpainTax {
    pub marginal: f64,
    pub reduction: f64,
    pub offset_other_income: bool,
    pub amortisation_per_year: f64,
    pub amortisation_basis: f64,
    pub capital_gains: &'static Schedule,
}

#[derive(Debug, Clone)]
pub struct GenericTax {
    pub rate: f64,
    pub interest_deductible: bool,
    pub offset_losses: bool,
    pub depreciation_years: f64,
    pub depreciation_per_year: f64,
    pub capital_gains_rate: f64,
    pub recapture_rate: f64,
}

/// `repairs` is the maintenance pool (capped); `other_deductible` is fixed costs plus property tax, then management.
#[derive(Debug, Clone, Copy)]
pub struct YearIncome {
    pub collected: f64,
    pub interest: f64,
    pub repairs: f64,
    pub other_deductible: f64,
    pub opex: f64,
}

/// `carry[k]` holds the unused capped expenses of year `t - 1 - k`; the oldest is used first and a 4-year-old rest expires.
#[derive(Debug, Clone, Copy, Default)]
pub struct TaxState {
    pub carry: [f64; 4],
    pub amortisation_taken: f64,
}

// Smaller leftovers are rounding noise, not expenses to carry.
const CARRY_EPSILON: f64 = 1e-12;

impl TaxRules {
    /// A negative result is a saving.
    pub fn year_tax(&self, t: usize, y: &YearIncome, state: &mut TaxState) -> f64 {
        match self {
            TaxRules::None => 0.0,
            TaxRules::Spain(rules) => rules.year_tax(y, state),
            TaxRules::Generic(rules) => rules.year_tax(t, y, state),
        }
    }

    pub fn exit_tax(&self, gain: f64, state: &TaxState) -> f64 {
        match self {
            TaxRules::None => 0.0,
            TaxRules::Spain(rules) => rules.capital_gains.tax(gain),
            TaxRules::Generic(rules) => {
                let recapture = gain.max(0.0).min(state.amortisation_taken);
                recapture * rules.recapture_rate
                    + (gain - state.amortisation_taken).max(0.0) * rules.capital_gains_rate
            }
        }
    }
}

impl SpainTax {
    fn year_tax(&self, y: &YearIncome, state: &mut TaxState) -> f64 {
        let amortisation = self
            .amortisation_per_year
            .min((self.amortisation_basis - state.amortisation_taken).max(0.0));
        state.amortisation_taken += amortisation;

        // Interest and repairs may not exceed the year's rent; the rest waits up to four years.
        let mut deducted = 0.0;
        let mut left_over = [0.0; 4];
        for k in (0..4).rev() {
            let used = state.carry[k].min(y.collected - deducted);
            deducted += used;
            left_over[k] = state.carry[k] - used;
        }
        let current = y.interest + y.repairs;
        let used = current.min(y.collected - deducted);
        deducted += used;

        let mut carry = [0.0; 4];
        carry[0] = current - used;
        carry[1..].copy_from_slice(&left_over[..3]);
        state.carry = carry.map(|c| if c > CARRY_EPSILON { c } else { 0.0 });

        let net = y.collected - deducted - (y.other_deductible + amortisation);
        if net > 0.0 {
            self.marginal * net * (1.0 - self.reduction)
        } else if self.offset_other_income {
            self.marginal * net
        } else {
            0.0
        }
    }
}

impl GenericTax {
    fn year_tax(&self, t: usize, y: &YearIncome, state: &mut TaxState) -> f64 {
        let depreciation = if self.depreciation_per_year != 0.0 {
            // The last, partial year is the fraction of a year left.
            self.depreciation_per_year
                * (self.depreciation_years - t.saturating_sub(1) as f64).clamp(0.0, 1.0)
        } else {
            0.0
        };
        state.amortisation_taken += depreciation;
        let interest = if self.interest_deductible {
            y.interest
        } else {
            0.0
        };
        let net = y.collected - interest - y.opex - depreciation;
        if net > 0.0 || self.offset_losses {
            self.rate * net
        } else {
            0.0
        }
    }
}
