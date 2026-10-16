use serde::Serialize;

use crate::error::{ErrorCode, InputError};
use crate::income_tax::{TaxRules, TaxState, YearIncome};
use crate::loan::{Loan, LoanYear, MonthRow, loan_years, monthly_schedule};
use crate::market::Acquisition;
use crate::metrics::{Irr, irr, mirr, npv, payback};

pub const MAX_YEARS: usize = 40;

/// A validated, resolved input. `fixed_costs = ibi + community + insurance + other_fixed`; `value0` is the input or
/// the price; `basis = price + acq_costs + renovation`; `index0` is the loan's current index (0 for a fixed loan).
#[derive(Debug, Clone)]
pub struct Scenario {
    pub years: usize,
    pub price: f64,
    pub renovation: f64,
    pub acquisition: Acquisition,
    pub loan: Option<Loan>,
    pub index0: f64,
    pub index_path: Vec<f64>,
    pub rent_month: f64,
    pub vacancy: f64,
    pub fixed_costs: f64,
    pub property_tax_rate: f64,
    pub maintenance_rate: f64,
    pub management_rate: f64,
    pub g_rent: f64,
    pub g_exp: f64,
    pub g_app: f64,
    pub value0: f64,
    pub sell_rate: f64,
    pub municipal_gain_tax: f64,
    pub discount_rate: f64,
    pub basis: f64,
    pub tax: TaxRules,
}

/// One realisation of the uncertain inputs, indexed by year `t = 1..=years` (slot 0 is unused).
#[derive(Debug, Clone, Copy)]
pub struct Path {
    pub index: [f64; MAX_YEARS + 1],
    pub g_rent: [f64; MAX_YEARS + 1],
    pub g_exp: [f64; MAX_YEARS + 1],
    pub g_app: [f64; MAX_YEARS + 1],
    pub vacancy: [f64; MAX_YEARS + 1],
}

impl Path {
    /// `index_path` padded with `index0`; growth and vacancy constant.
    pub fn base(s: &Scenario) -> Path {
        let mut index = [s.index0; MAX_YEARS + 1];
        for (slot, value) in index[1..].iter_mut().zip(&s.index_path) {
            *slot = *value;
        }
        Path {
            index,
            g_rent: [s.g_rent; MAX_YEARS + 1],
            g_exp: [s.g_exp; MAX_YEARS + 1],
            g_app: [s.g_app; MAX_YEARS + 1],
            vacancy: [s.vacancy; MAX_YEARS + 1],
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct YearRow {
    pub t: usize,
    pub rent_gross: f64,
    pub vacancy: f64,
    pub rent_collected: f64,
    pub opex: f64,
    pub noi: f64,
    pub interest: f64,
    pub principal: f64,
    pub debt_service: f64,
    pub loan_rate: f64,
    pub balance_end: f64,
    pub cf_pre_tax: f64,
    pub tax: f64,
    pub cf_after_tax: f64,
    pub value_end: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct ExitRow {
    pub value: f64,
    pub sale_costs: f64,
    pub loan_payoff: f64,
    pub gain: f64,
    pub cgt: f64,
    pub equity_back_pre_tax: f64,
    pub equity_back_after_tax: f64,
}

/// The single year loop shared by the analysis (on `Path::base`) and the Monte Carlo. Property tax is charged on
/// the value at the start of the year; `loan` holds one entry per year.
pub fn run(
    s: &Scenario,
    path: &Path,
    loan: &[LoanYear],
    rows: &mut [YearRow; MAX_YEARS],
    tax: &mut TaxState,
) -> ExitRow {
    let mut rent = 12.0 * s.rent_month;
    let mut fixed = s.fixed_costs;
    let mut value = s.value0;
    let mut balance = 0.0;
    for t in 1..=s.years {
        if t > 1 {
            rent *= 1.0 + path.g_rent[t];
            fixed *= 1.0 + path.g_exp[t];
        }
        let property_tax = s.property_tax_rate * value;
        value *= 1.0 + path.g_app[t];
        let vacancy = path.vacancy[t];
        let collected = rent * (1.0 - vacancy);
        let maintenance = s.maintenance_rate * rent;
        let management = s.management_rate * collected;
        let opex = fixed + property_tax + maintenance + management;
        let noi = collected - opex;
        let year_loan = loan.get(t - 1).copied().unwrap_or_default();
        balance = year_loan.balance_end;
        let debt_service = year_loan.interest + year_loan.principal;
        let cf_pre_tax = noi - debt_service;
        let income = YearIncome {
            collected,
            interest: year_loan.interest,
            repairs: maintenance,
            other_deductible: fixed + property_tax + management,
            opex,
        };
        let year_tax = s.tax.year_tax(t, &income, tax);
        rows[t - 1] = YearRow {
            t,
            rent_gross: rent,
            vacancy,
            rent_collected: collected,
            opex,
            noi,
            interest: year_loan.interest,
            principal: year_loan.principal,
            debt_service,
            loan_rate: year_loan.rate,
            balance_end: balance,
            cf_pre_tax,
            tax: year_tax,
            cf_after_tax: cf_pre_tax - year_tax,
            value_end: value,
        };
    }
    let sale_costs = value * s.sell_rate + s.municipal_gain_tax;
    let gain = value - sale_costs - (s.basis - tax.amortisation_taken);
    let cgt = s.tax.exit_tax(gain, tax);
    let equity_back_pre_tax = value - sale_costs - balance;
    ExitRow {
        value,
        sale_costs,
        loan_payoff: balance,
        gain,
        cgt,
        equity_back_pre_tax,
        equity_back_after_tax: equity_back_pre_tax - cgt,
    }
}

/// Equity out at `t = 0`, one cash flow per year, the sale proceeds added to the last one. Fills `rows.len() + 1`
/// entries of `out`.
pub fn flows(
    s: &Scenario,
    rows: &[YearRow],
    exit: &ExitRow,
    after_tax: bool,
    out: &mut [f64; MAX_YEARS + 1],
) {
    out[0] = -s.acquisition.equity0;
    for (slot, row) in out[1..].iter_mut().zip(rows) {
        *slot = if after_tax {
            row.cf_after_tax
        } else {
            row.cf_pre_tax
        };
    }
    let sale = if after_tax {
        exit.equity_back_after_tax
    } else {
        exit.equity_back_pre_tax
    };
    out[rows.len()] += sale;
}

pub fn analyze(s: &Scenario) -> Analysis {
    let path = Path::base(s);
    let n = s.years;
    let mut loan_rows = [LoanYear::default(); MAX_YEARS];
    if let Some(loan) = &s.loan {
        loan_years(loan, &path.index[1..], &mut loan_rows[..n]);
    }
    let mut rows = [YearRow::default(); MAX_YEARS];
    let mut tax = TaxState::default();
    let exit = run(s, &path, &loan_rows[..n], &mut rows, &mut tax);
    let years = &rows[..n];

    let taxed = !matches!(s.tax, TaxRules::None);
    let mut buffer = [0.0; MAX_YEARS + 1];
    flows(s, years, &exit, taxed, &mut buffer);
    let flows_taxed = buffer[..=n].to_vec();
    flows(s, years, &exit, false, &mut buffer);
    let flows_pre_tax = buffer[..=n].to_vec();
    let cumulative = flows_taxed
        .iter()
        .scan(0.0, |total, flow| {
            *total += flow;
            Some(*total)
        })
        .collect();
    let schedule = match &s.loan {
        Some(loan) => monthly_schedule(loan, &path.index[1..], 12 * n),
        None => Vec::new(),
    };
    Analysis {
        acquisition: s.acquisition.clone(),
        metrics: metrics(s, years, &flows_taxed, &flows_pre_tax, taxed),
        years: years.to_vec(),
        exit,
        flows: flows_taxed,
        flows_pre_tax,
        cumulative,
        amortisation_taken: taxed.then_some(tax.amortisation_taken),
        schedule,
    }
}

fn metrics(
    s: &Scenario,
    years: &[YearRow],
    flows: &[f64],
    flows_pre_tax: &[f64],
    taxed: bool,
) -> Metrics {
    let first = &years[0];
    let cash_flow = |row: &YearRow| {
        if taxed {
            row.cf_after_tax
        } else {
            row.cf_pre_tax
        }
    };
    let operating: Vec<f64> = years.iter().map(cash_flow).collect();
    let equity0 = s.acquisition.equity0;
    let fixed_and_maintenance =
        s.fixed_costs + s.property_tax_rate * s.value0 + s.maintenance_rate * first.rent_gross;
    Metrics {
        gross_yield: 12.0 * s.rent_month / s.price,
        net_yield: first.noi / s.acquisition.total_investment,
        cap_rate: first.noi / s.price,
        cash_on_cash_1: (equity0 > 0.0).then(|| cash_flow(first) / equity0),
        npv: npv(s.discount_rate, flows),
        irr: irr(flows),
        irr_pre_tax: irr(flows_pre_tax),
        mirr: mirr(flows, s.discount_rate, s.discount_rate),
        payback_years: payback(flows[0], &operating),
        dscr: (first.debt_service != 0.0).then(|| first.noi / first.debt_service),
        grm: s.price / first.rent_gross,
        one_percent_ratio: s.rent_month / (s.price + s.renovation),
        break_even_occupancy: (fixed_and_maintenance + first.debt_service)
            / (first.rent_gross * (1.0 - s.management_rate)),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Analysis {
    pub acquisition: Acquisition,
    pub years: Vec<YearRow>,
    pub exit: ExitRow,
    pub flows: Vec<f64>,
    pub flows_pre_tax: Vec<f64>,
    pub cumulative: Vec<f64>,
    pub metrics: Metrics,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amortisation_taken: Option<f64>,
    pub schedule: Vec<MonthRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Metrics {
    pub gross_yield: f64,
    pub net_yield: f64,
    pub cap_rate: f64,
    pub cash_on_cash_1: Option<f64>,
    pub npv: f64,
    pub irr: Irr,
    pub irr_pre_tax: Irr,
    pub mirr: Option<f64>,
    pub payback_years: Option<f64>,
    pub dscr: Option<f64>,
    pub grm: f64,
    pub one_percent_ratio: f64,
    pub break_even_occupancy: f64,
}

impl Analysis {
    /// Returns `not_finite` (field `result`) if any number is not finite.
    pub fn check_finite(&self) -> Result<(), InputError> {
        let m = &self.metrics;
        let scalars = [
            m.gross_yield,
            m.net_yield,
            m.cap_rate,
            m.cash_on_cash_1.unwrap_or(0.0),
            m.npv,
            m.mirr.unwrap_or(0.0),
            m.payback_years.unwrap_or(0.0),
            m.dscr.unwrap_or(0.0),
            m.grm,
            m.one_percent_ratio,
            m.break_even_occupancy,
            self.acquisition.total_investment,
            self.acquisition.equity0,
            self.acquisition.acq_costs,
            self.acquisition.transfer_tax,
            self.acquisition.notary.unwrap_or(0.0),
            self.acquisition.registry.unwrap_or(0.0),
            self.acquisition.loan,
            self.amortisation_taken.unwrap_or(0.0),
        ];
        let exit = &self.exit;
        let exit_values = [
            exit.value,
            exit.sale_costs,
            exit.loan_payoff,
            exit.gain,
            exit.cgt,
            exit.equity_back_pre_tax,
            exit.equity_back_after_tax,
        ];
        let finite = scalars.iter().chain(&exit_values).all(|x| x.is_finite())
            && self.years.iter().all(YearRow::is_finite)
            && self
                .flows
                .iter()
                .chain(&self.flows_pre_tax)
                .chain(&self.cumulative)
                .all(|x| x.is_finite())
            && irr_is_finite(&m.irr)
            && irr_is_finite(&m.irr_pre_tax)
            && self.schedule.iter().all(|r| {
                [r.rate, r.payment, r.interest, r.principal, r.balance]
                    .iter()
                    .all(|x| x.is_finite())
            });
        if finite {
            Ok(())
        } else {
            Err(InputError::new(
                ErrorCode::NotFinite,
                "result",
                "the analysis produced a number that is not finite",
            ))
        }
    }
}

impl YearRow {
    fn is_finite(&self) -> bool {
        [
            self.rent_gross,
            self.vacancy,
            self.rent_collected,
            self.opex,
            self.noi,
            self.interest,
            self.principal,
            self.debt_service,
            self.loan_rate,
            self.balance_end,
            self.cf_pre_tax,
            self.tax,
            self.cf_after_tax,
            self.value_end,
        ]
        .iter()
        .all(|x| x.is_finite())
    }
}

fn irr_is_finite(irr: &Irr) -> bool {
    match irr {
        Irr::Unique { rate } => rate.is_finite(),
        Irr::Multiple { rates } => rates.iter().all(|r| r.is_finite()),
        Irr::None { .. } => true,
    }
}
