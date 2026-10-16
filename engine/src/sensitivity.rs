use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::error::InputError;
use crate::inputs::{Inputs, LoanInput};
use crate::metrics::Irr;
use crate::proforma;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Variable {
    Price,
    Rent,
    Vacancy,
    Interest,
    Appreciation,
    RentGrowth,
    Opex,
}

#[derive(Debug, Clone, Serialize)]
pub struct Bar {
    pub variable: Variable,
    pub low_value: f64,
    pub high_value: f64,
    pub npv_low: f64,
    pub npv_high: f64,
    pub irr_low: Irr,
    pub irr_high: Irr,
}

/// The JSON shape is `{"base": {"npv", "irr"}, "bars": [...]}`.
#[derive(Debug, Clone)]
pub struct Sensitivity {
    pub base_npv: f64,
    pub base_irr: Irr,
    pub bars: Vec<Bar>,
}

impl Serialize for Sensitivity {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Base<'a> {
            npv: f64,
            irr: &'a Irr,
        }
        let mut out = serializer.serialize_struct("Sensitivity", 2)?;
        out.serialize_field(
            "base",
            &Base {
                npv: self.base_npv,
                irr: &self.base_irr,
            },
        )?;
        out.serialize_field("bars", &self.bars)?;
        out.end()
    }
}

const VARIABLES: [Variable; 7] = [
    Variable::Price,
    Variable::Rent,
    Variable::Vacancy,
    Variable::Interest,
    Variable::Appreciation,
    Variable::RentGrowth,
    Variable::Opex,
];

pub fn sensitivity(inputs: &Inputs) -> Result<Sensitivity, InputError> {
    let (base_npv, base_irr) = evaluate(inputs)?;
    let mut bars = Vec::with_capacity(VARIABLES.len());
    for variable in VARIABLES {
        let (low, low_value) = shifted(inputs, variable, false);
        let (high, high_value) = shifted(inputs, variable, true);
        let (npv_low, irr_low) = evaluate(&low)?;
        let (npv_high, irr_high) = evaluate(&high)?;
        bars.push(Bar {
            variable,
            low_value,
            high_value,
            npv_low,
            npv_high,
            irr_low,
            irr_high,
        });
    }
    // The sort is stable, so equal widths keep the order of VARIABLES.
    bars.sort_by(|a, b| {
        let width = |bar: &Bar| (bar.npv_high - bar.npv_low).abs();
        width(b).total_cmp(&width(a))
    });
    Ok(Sensitivity {
        base_npv,
        base_irr,
        bars,
    })
}

fn evaluate(inputs: &Inputs) -> Result<(f64, Irr), InputError> {
    let analysis = proforma::analyze(&inputs.resolve()?);
    analysis.check_finite()?;
    Ok((analysis.metrics.npv, analysis.metrics.irr))
}

/// A copy of `inputs` with one variable moved to its low or high step, and the value shown for that step.
/// A step that would leave the input's allowed range stops at the limit, so a bar can be shorter on one side.
fn shifted(inputs: &Inputs, variable: Variable, high: bool) -> (Inputs, f64) {
    let sign = if high { 1.0 } else { -1.0 };
    let mut moved = inputs.clone();
    let value = match variable {
        Variable::Price => {
            moved.price = (inputs.price * (1.0 + 0.1 * sign)).min(1e9);
            moved.price
        }
        Variable::Rent => {
            moved.rent_month = (inputs.rent_month * (1.0 + 0.1 * sign)).min(1e7);
            moved.rent_month
        }
        Variable::Vacancy => {
            moved.vacancy = (inputs.vacancy + 0.05 * sign).clamp(0.0, 0.99);
            moved.vacancy
        }
        Variable::Interest => shift_interest(&mut moved.loan, 0.01 * sign),
        Variable::Appreciation => {
            moved.g_app = (inputs.g_app + 0.02 * sign).clamp(-0.5, 0.5);
            moved.g_app
        }
        Variable::RentGrowth => {
            moved.g_rent = (inputs.g_rent + 0.01 * sign).clamp(-0.5, 0.5);
            moved.g_rent
        }
        Variable::Opex => {
            let factor = if high { 1.2 } else { 0.8 };
            for (cost, limit) in [
                (&mut moved.ibi, 1e8),
                (&mut moved.community, 1e8),
                (&mut moved.insurance, 1e8),
                (&mut moved.other_fixed, 1e8),
                (&mut moved.property_tax_rate, 0.05),
                (&mut moved.maintenance_rate, 0.9),
                (&mut moved.management_rate, 0.9),
            ] {
                *cost = (*cost * factor).min(limit);
            }
            factor
        }
    };
    (moved, value)
}

/// Moves the fixed rate, the index and every index_path entry, never the spread. Returns the rate shown on the bar:
/// the index for a variable loan, the fixed rate otherwise.
fn shift_interest(loan: &mut LoanInput, delta: f64) -> f64 {
    let fixed = |rate: f64| (rate + delta).clamp(0.0, 0.3);
    let index = |rate: f64| (rate + delta).clamp(-0.05, 0.2);
    match loan {
        LoanInput::Fixed { fixed_rate, .. } => {
            *fixed_rate = fixed(*fixed_rate);
            *fixed_rate
        }
        LoanInput::Variable {
            index: base,
            index_path,
            ..
        } => {
            *base = index(*base);
            index_path
                .iter_mut()
                .for_each(|entry| *entry = index(*entry));
            *base
        }
        LoanInput::Mixed {
            fixed_rate,
            index: base,
            index_path,
            ..
        } => {
            *fixed_rate = fixed(*fixed_rate);
            *base = index(*base);
            index_path
                .iter_mut()
                .for_each(|entry| *entry = index(*entry));
            *fixed_rate
        }
    }
}
