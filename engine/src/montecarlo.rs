use serde::{Deserialize, Serialize, Serializer};

use crate::correlation::Cholesky;
use crate::error::{ErrorCode, InputError};
use crate::income_tax::TaxState;
use crate::inputs::Inputs;
use crate::loan::{LoanYear, loan_years};
use crate::metrics::{ScenarioIrr, npv, percentile7, scenario_irr};
use crate::proforma::{MAX_YEARS, Path, Scenario, YearRow, flows, run};
use crate::rng::Rng;

pub const MAX_SCENARIOS: u32 = 100_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McParams {
    pub kappa: f64,
    pub sigma_index: f64,
    pub sigma_rent: f64,
    pub sigma_app: f64,
    pub sigma_exp: f64,
    pub corr: [[f64; 4]; 4],
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct McRequest {
    pub inputs: Inputs,
    pub params: McParams,
    pub n: u32,
    pub seed: u32,
}

/// A percentile of the IRRs among scenarios with no root below -99 % (`Below`) or above 1 000 % (`Above`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum IrrPoint {
    Rate(f64),
    Below,
    Above,
}

impl Serialize for IrrPoint {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            IrrPoint::Rate(rate) => serializer.serialize_f64(*rate),
            IrrPoint::Below => serializer.serialize_str("below"),
            IrrPoint::Above => serializer.serialize_str("above"),
        }
    }
}

/// Thirty equal bins between the 1st and 99th percentile of the NPVs; `counts + below + above` is `n`.
#[derive(Debug, Clone, Serialize)]
pub struct Histogram {
    pub edges: Vec<f64>,
    pub counts: Vec<u32>,
    pub below: u32,
    pub above: u32,
}

/// `irr_p` is `None` when every scenario had several IRRs.
#[derive(Debug, Clone, Serialize)]
pub struct McResult {
    pub irr_p: Option<[IrrPoint; 3]>,
    pub npv_p: [f64; 3],
    pub p_npv_negative: f64,
    pub cum_p_by_year: Vec<[f64; 3]>,
    pub irr_multiple_count: u32,
    pub irr_bottom_count: u32,
    pub irr_top_count: u32,
    pub npv_histogram: Histogram,
}

impl McResult {
    /// Returns `not_finite` (field `result`) if any number is not finite; the infinite IRR points are `Below` and `Above`.
    pub fn check_finite(&self) -> Result<(), InputError> {
        let finite = self.npv_p.iter().all(|x| x.is_finite())
            && self.p_npv_negative.is_finite()
            && self.cum_p_by_year.iter().flatten().all(|x| x.is_finite())
            && self.npv_histogram.edges.iter().all(|x| x.is_finite())
            && self
                .irr_p
                .iter()
                .flatten()
                .all(|point| !matches!(point, IrrPoint::Rate(x) if !x.is_finite()));
        if finite {
            Ok(())
        } else {
            Err(InputError::new(
                ErrorCode::NotFinite,
                "result",
                "the simulation produced a number that is not finite",
            ))
        }
    }
}

/// Buffers reused across runs: they only grow, so a run allocates nothing inside the scenario loop.
#[derive(Debug, Default)]
pub struct Simulator {
    cum: Vec<f64>,
    npv: Vec<f64>,
    irr: Vec<f64>,
}

const HISTOGRAM_BINS: usize = 30;
const PERCENTILES: [f64; 3] = [0.1, 0.5, 0.9];

impl McParams {
    fn validate(&self) -> Result<(), InputError> {
        let bounded = [
            ("params.kappa", self.kappa, 1.0),
            ("params.sigma_index", self.sigma_index, 0.5),
            ("params.sigma_rent", self.sigma_rent, 0.5),
            ("params.sigma_app", self.sigma_app, 0.5),
            ("params.sigma_exp", self.sigma_exp, 0.5),
        ];
        for (field, value, hi) in bounded {
            if !value.is_finite() {
                return Err(InputError::new(
                    ErrorCode::NotFinite,
                    field,
                    "must be a finite number",
                ));
            }
            if !(0.0..=hi).contains(&value) {
                let message = format!("must be between 0 and {hi}, got {value}");
                return Err(InputError::new(ErrorCode::OutOfRange, field, message));
            }
        }
        Ok(())
    }
}

fn check_count(n: u32) -> Result<(), InputError> {
    match n {
        0 => Err(InputError::new(
            ErrorCode::OutOfRange,
            "n",
            "must be at least 1, got 0",
        )),
        n if n > MAX_SCENARIOS => {
            let message = format!("must be at most {MAX_SCENARIOS}, got {n}");
            Err(InputError::new(ErrorCode::TooManyScenarios, "n", message))
        }
        _ => Ok(()),
    }
}

impl Simulator {
    /// Draws `n` scenarios from `seed` as section 7 of docs/how-it-works.md and the reference's `monte_carlo` do, in that
    /// draw order, so a seed gives the same numbers on every machine.
    pub fn run(
        &mut self,
        s: &Scenario,
        p: &McParams,
        n: u32,
        seed: u32,
    ) -> Result<McResult, InputError> {
        check_count(n)?;
        p.validate()?;
        let chol = Cholesky::new(&p.corr)?;
        let (years, n) = (s.years, n as usize);
        let columns = years + 1;
        grow(&mut self.cum, columns * n);
        grow(&mut self.npv, n);
        grow(&mut self.irr, n);

        let mut rng = Rng::new(seed);
        let mut path = Path::base(s);
        let mut loan_rows = [LoanYear::default(); MAX_YEARS];
        let per_scenario_loan = s.loan.as_ref().filter(|loan| loan.follows_index(years));
        if let Some(loan) = s.loan.as_ref().filter(|_| per_scenario_loan.is_none()) {
            loan_years(loan, &path.index[1..], &mut loan_rows[..years]);
        }
        let mut rows = [YearRow::default(); MAX_YEARS];
        let mut cash = [0.0; MAX_YEARS + 1];
        let (mut included, mut multiple, mut bottom, mut top) = (0, 0u32, 0u32, 0u32);

        for scenario in 0..n {
            draw_path(&mut path, s, p, &chol, &mut rng);
            if let Some(loan) = per_scenario_loan {
                loan_years(loan, &path.index[1..], &mut loan_rows[..years]);
            }
            let mut tax = TaxState::default();
            let exit = run(s, &path, &loan_rows[..years], &mut rows, &mut tax);
            flows(s, &rows[..years], &exit, true, &mut cash);
            let cash = &cash[..columns];

            let mut total = 0.0;
            for (t, flow) in cash.iter().enumerate() {
                total += flow;
                self.cum[t * n + scenario] = total;
            }
            self.npv[scenario] = npv(s.discount_rate, cash);
            let rate = match scenario_irr(cash) {
                ScenarioIrr::Rate(rate) => Some(rate),
                ScenarioIrr::Multiple => {
                    multiple += 1;
                    None
                }
                ScenarioIrr::NoRoot if total < 0.0 => {
                    bottom += 1;
                    Some(f64::NEG_INFINITY)
                }
                ScenarioIrr::NoRoot => {
                    top += 1;
                    Some(f64::INFINITY)
                }
            };
            if let Some(rate) = rate {
                self.irr[included] = rate;
                included += 1;
            }
        }
        Ok(self.summarise(years, n, included, [multiple, bottom, top]))
    }

    fn summarise(
        &mut self,
        years: usize,
        n: usize,
        included: usize,
        [multiple, bottom, top]: [u32; 3],
    ) -> McResult {
        let irrs = &mut self.irr[..included];
        irrs.sort_unstable_by(f64::total_cmp);
        let npvs = &mut self.npv[..n];
        npvs.sort_unstable_by(f64::total_cmp);
        let cum_p_by_year = self.cum[..(years + 1) * n]
            .chunks_exact_mut(n)
            .map(|column| {
                column.sort_unstable_by(f64::total_cmp);
                percentiles(column)
            })
            .collect();
        let irr_p = (included > 0).then(|| percentiles(irrs).map(irr_point));
        McResult {
            irr_p,
            npv_p: percentiles(npvs),
            p_npv_negative: npvs.iter().filter(|x| **x < 0.0).count() as f64 / n as f64,
            cum_p_by_year,
            irr_multiple_count: multiple,
            irr_bottom_count: bottom,
            irr_top_count: top,
            npv_histogram: histogram(npvs),
        }
    }
}

fn grow(buffer: &mut Vec<f64>, len: usize) {
    if buffer.len() < len {
        buffer.resize(len, 0.0);
    }
}

fn percentiles(sorted: &[f64]) -> [f64; 3] {
    PERCENTILES.map(|p| percentile7(sorted, p))
}

fn irr_point(x: f64) -> IrrPoint {
    if x == f64::NEG_INFINITY {
        IrrPoint::Below
    } else if x == f64::INFINITY {
        IrrPoint::Above
    } else {
        IrrPoint::Rate(x)
    }
}

/// A yearly growth rate with its random shock. Never below -99 %: a fall of 100 % or more would turn the rent, the
/// costs or the value negative and flip their sign again the next year.
pub fn growth_draw(mean: f64, sigma: f64, z: f64) -> f64 {
    (mean + sigma * z).max(-0.99)
}

/// Per year: two normal pairs correlated into the four shocks, then twelve uniforms for the vacant months. The
/// year-1 rent, expense and index shocks are drawn and unused, as in the reference.
fn draw_path(path: &mut Path, s: &Scenario, p: &McParams, chol: &Cholesky, rng: &mut Rng) {
    let mut index = s.index0;
    for t in 1..=s.years {
        let (a, b) = rng.normal_pair();
        let (c, d) = rng.normal_pair();
        let z = chol.correlate(&[a, b, c, d]);
        if t >= 2 {
            index = index + p.kappa * (s.index0 - index) + p.sigma_index * z[0];
        }
        path.index[t] = index;
        path.g_rent[t] = growth_draw(s.g_rent, p.sigma_rent, z[1]);
        path.g_app[t] = growth_draw(s.g_app, p.sigma_app, z[2]);
        path.g_exp[t] = growth_draw(s.g_exp, p.sigma_exp, z[3]);
        let vacant_months = (0..12).filter(|_| rng.uniform() < s.vacancy).count();
        path.vacancy[t] = vacant_months as f64 / 12.0;
    }
}

/// Bins between the 1st and 99th percentile; everything outside is counted apart.
fn histogram(sorted: &[f64]) -> Histogram {
    let lo = percentile7(sorted, 0.01);
    let hi = percentile7(sorted, 0.99);
    let bins = HISTOGRAM_BINS as f64;
    let mut counts = vec![0u32; HISTOGRAM_BINS];
    let (mut below, mut above) = (0, 0);
    for &x in sorted {
        if x < lo {
            below += 1;
        } else if x > hi {
            above += 1;
        } else if hi == lo {
            counts[0] += 1;
        } else {
            let bin = ((x - lo) / (hi - lo) * bins) as usize;
            counts[bin.min(HISTOGRAM_BINS - 1)] += 1;
        }
    }
    let edges = (0..=HISTOGRAM_BINS)
        .map(|k| lo + (hi - lo) * k as f64 / bins)
        .collect();
    Histogram {
        edges,
        counts,
        below,
        above,
    }
}
