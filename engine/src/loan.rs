use serde::Serialize;

#[derive(Debug, Clone, Copy)]
pub enum LoanRate {
    Fixed(f64),
    Variable {
        spread: f64,
    },
    Mixed {
        fixed_rate: f64,
        fixed_years: usize,
        spread: f64,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct Loan {
    pub principal: f64,
    pub term_years: usize,
    pub rate: LoanRate,
}

impl Loan {
    /// Floored at zero (Ley 5/2019, art. 21.3). `t` is the 1-based loan year.
    pub fn rate_in_year(&self, t: usize, index: f64) -> f64 {
        match self.rate {
            LoanRate::Fixed(rate) => rate,
            LoanRate::Variable { spread } => (index + spread).max(0.0),
            LoanRate::Mixed {
                fixed_rate,
                fixed_years,
                spread,
            } => {
                if t <= fixed_years {
                    fixed_rate
                } else {
                    (index + spread).max(0.0)
                }
            }
        }
    }

    /// False for a fixed loan and for a mixed one whose fixed part covers the whole hold.
    pub fn follows_index(&self, years: usize) -> bool {
        match self.rate {
            LoanRate::Fixed(_) => false,
            LoanRate::Variable { .. } => true,
            LoanRate::Mixed { fixed_years, .. } => fixed_years < years,
        }
    }

    fn is_fixed(&self) -> bool {
        matches!(self.rate, LoanRate::Fixed(_))
    }
}

/// French amortisation; a zero rate gives `balance / months`, and so does a rate so small that the formula loses its digits.
pub fn payment(balance: f64, monthly_rate: f64, months: usize) -> f64 {
    if months == 0 {
        return 0.0;
    }
    if monthly_rate.abs() < 1e-9 {
        return balance / months as f64;
    }
    balance * monthly_rate / (1.0 - libm::pow(1.0 + monthly_rate, -(months as f64)))
}

#[derive(Debug, Clone, Copy, Default)]
pub struct LoanYear {
    pub rate: f64,
    pub interest: f64,
    pub principal: f64,
    pub balance_end: f64,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct MonthRow {
    pub month: usize,
    pub rate: f64,
    pub payment: f64,
    pub interest: f64,
    pub principal: f64,
    pub balance: f64,
}

struct State {
    balance: f64,
    payment: f64,
}

// A fixed loan keeps its first instalment; the others recompute it at every anniversary, as the reference does.
fn step_year(
    loan: &Loan,
    t: usize,
    index: f64,
    state: &mut State,
    mut on_month: impl FnMut(&MonthRow),
) -> LoanYear {
    if t > loan.term_years {
        return LoanYear {
            balance_end: state.balance,
            ..LoanYear::default()
        };
    }
    let rate = loan.rate_in_year(t, index);
    let monthly_rate = rate / 12.0;
    if t == 1 || !loan.is_fixed() {
        let remaining = 12 * (loan.term_years - (t - 1));
        state.payment = payment(state.balance, monthly_rate, remaining);
    }
    let (mut interest_sum, mut principal_sum) = (0.0, 0.0);
    for m in 0..12 {
        let interest = state.balance * monthly_rate;
        let principal = state.payment - interest;
        state.balance -= principal;
        interest_sum += interest;
        principal_sum += principal;
        on_month(&MonthRow {
            month: 12 * (t - 1) + m + 1,
            rate,
            payment: state.payment,
            interest,
            principal,
            balance: state.balance,
        });
    }
    LoanYear {
        rate,
        interest: interest_sum,
        principal: principal_sum,
        balance_end: state.balance,
    }
}

fn index_in_year(index_by_year: &[f64], t: usize) -> f64 {
    index_by_year.get(t - 1).copied().unwrap_or(0.0)
}

/// Fills `out.len()` years (at most 40). A missing index entry counts as 0.
pub fn loan_years(loan: &Loan, index_by_year: &[f64], out: &mut [LoanYear]) {
    let mut state = State {
        balance: loan.principal,
        payment: 0.0,
    };
    for (i, slot) in out.iter_mut().enumerate() {
        let t = i + 1;
        *slot = step_year(loan, t, index_in_year(index_by_year, t), &mut state, |_| {});
    }
}

/// Months 1..=min(months, 12 * term_years).
pub fn monthly_schedule(loan: &Loan, index_by_year: &[f64], months: usize) -> Vec<MonthRow> {
    let months = months.min(12 * loan.term_years);
    let mut rows = Vec::with_capacity(months);
    let mut state = State {
        balance: loan.principal,
        payment: 0.0,
    };
    for t in 1..=months.div_ceil(12) {
        let index = index_in_year(index_by_year, t);
        step_year(loan, t, index, &mut state, |row| {
            if row.month <= months {
                rows.push(*row);
            }
        });
    }
    rows
}
