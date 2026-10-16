use invest_engine::loan::{Loan, LoanRate, LoanYear, loan_years, monthly_schedule, payment};
use proptest::prelude::*;
use serde_json::Value;

mod common;

fn f(v: &Value) -> f64 {
    v.as_f64().expect("number in fixture")
}

fn close(expected: f64, actual: f64) {
    let tolerance = 1e-9 * 1.0_f64.max(expected.abs()).max(actual.abs());
    assert!(
        (expected - actual).abs() <= tolerance,
        "expected {expected}, got {actual}"
    );
}

fn fixed_loan(case: &Value) -> Loan {
    Loan {
        principal: f(&case["loan"]),
        term_years: f(&case["years"]) as usize,
        rate: LoanRate::Fixed(f(&case["annual_rate"])),
    }
}

#[test]
fn fixed_loans_match_the_reference_payment_balances_and_year_one() {
    let cases = common::fixture("amortisation");
    for case in cases.as_array().unwrap().iter().take(4) {
        let loan = fixed_loan(case);
        let rows = monthly_schedule(&loan, &[], 12 * loan.term_years);
        close(f(&case["payment"]), rows[0].payment);
        for (i, expected) in case["first_3"].as_array().unwrap().iter().enumerate() {
            close(f(&expected["interest"]), rows[i].interest);
            close(f(&expected["principal"]), rows[i].principal);
            close(f(&expected["balance"]), rows[i].balance);
        }
        for (month, expected) in case["balance_after"].as_object().unwrap() {
            let month: usize = month.parse().unwrap();
            // The last balance is a residual around 1e-9 whose sign depends on pow().
            assert!((rows[month - 1].balance - f(expected)).abs() < 1e-6);
        }
        let total_interest: f64 = rows.iter().map(|r| r.interest).sum();
        close(f(&case["total_interest"]), total_interest);
        let year_one: f64 = rows[..12].iter().map(|r| r.interest).sum();
        close(f(&case["year_1"]["interest"]), year_one);
        let principal: f64 = rows[..12].iter().map(|r| r.principal).sum();
        close(f(&case["year_1"]["principal"]), principal);
    }
}

#[test]
fn payment_on_100k_at_6pct_over_30y_is_599_55() {
    assert!((payment(100_000.0, 0.06 / 12.0, 360) - 599.55).abs() < 0.005);
}

#[test]
fn zero_rate_loan_pays_a_twelfth_of_the_balance_per_month() {
    assert_eq!(payment(120_000.0, 0.0, 120), 1000.0);
}

#[test]
fn variable_loan_floors_the_rate_at_zero_in_year_4() {
    let cases = common::fixture("amortisation");
    let case = &cases[4];
    let loan = Loan {
        principal: f(&case["loan"]),
        term_years: 5,
        rate: LoanRate::Variable {
            spread: f(&case["spread"]),
        },
    };
    let index: Vec<f64> = case["index_by_year"]
        .as_array()
        .unwrap()
        .iter()
        .map(f)
        .collect();
    let rows = monthly_schedule(&loan, &index, 60);
    let mut years = [LoanYear::default(); 5];
    loan_years(&loan, &index, &mut years);
    for t in 0..5 {
        close(f(&case["rates_by_year"][t]), years[t].rate);
        close(f(&case["payment_by_year"][t]), rows[12 * t].payment);
        close(f(&case["balance_end_of_year"][t]), years[t].balance_end);
    }
    assert_eq!(years[3].rate, 0.0);
}

#[test]
fn mixed_loan_switches_to_the_index_after_the_fixed_years() {
    let cases = common::fixture("amortisation");
    let case = &cases[5];
    let loan = Loan {
        principal: f(&case["loan"]),
        term_years: 10,
        rate: LoanRate::Mixed {
            fixed_rate: f(&case["fixed_rate"]),
            fixed_years: 5,
            spread: f(&case["spread"]),
        },
    };
    let index = [f(&case["index"]); 10];
    let rows = monthly_schedule(&loan, &index, 120);
    let mut years = [LoanYear::default(); 10];
    loan_years(&loan, &index, &mut years);
    for t in 0..10 {
        close(f(&case["payment_by_year"][t]), rows[12 * t].payment);
        close(f(&case["balance_end_of_year"][t]), years[t].balance_end);
    }
    assert_eq!(years[4].rate, 0.025);
    close(0.04, years[5].rate);
}

#[test]
fn years_past_the_term_have_no_interest_or_principal_and_keep_the_balance() {
    let loan = Loan {
        principal: 50_000.0,
        term_years: 2,
        rate: LoanRate::Fixed(0.04),
    };
    let mut years = [LoanYear::default(); 4];
    loan_years(&loan, &[], &mut years);
    assert!(years[1].balance_end.abs() < 1e-6);
    assert_eq!(years[2].interest, 0.0);
    assert_eq!(years[3].principal, 0.0);
    assert_eq!(years[3].rate, 0.0);
    assert_eq!(years[3].balance_end, years[1].balance_end);
    assert_eq!(monthly_schedule(&loan, &[], 100).len(), 24);
}

#[test]
fn a_schedule_of_seven_months_stops_mid_year() {
    let loan = Loan {
        principal: 100_000.0,
        term_years: 30,
        rate: LoanRate::Fixed(0.06),
    };
    let rows = monthly_schedule(&loan, &[], 7);
    assert_eq!(rows.len(), 7);
    assert_eq!(rows[6].month, 7);
}

#[test]
fn only_a_variable_or_a_mixed_loan_longer_than_its_fixed_part_follows_the_index() {
    let fixed = LoanRate::Fixed(0.03);
    let mixed = LoanRate::Mixed {
        fixed_rate: 0.03,
        fixed_years: 5,
        spread: 0.01,
    };
    let variable = LoanRate::Variable { spread: 0.01 };
    let loan = |rate| Loan {
        principal: 1.0,
        term_years: 20,
        rate,
    };
    assert!(!loan(fixed).follows_index(10));
    assert!(loan(variable).follows_index(10));
    assert!(!loan(mixed).follows_index(5));
    assert!(loan(mixed).follows_index(6));
}

fn any_loan() -> impl Strategy<Value = (Loan, Vec<f64>)> {
    (
        1_000.0..2_000_000.0_f64,
        1_usize..=40,
        0.0..0.12_f64,
        -0.01..0.06_f64,
        0_usize..=40,
        0_u8..3,
        prop::collection::vec(-0.02..0.08_f64, 40),
    )
        .prop_map(
            |(principal, term_years, rate, spread, fixed_years, kind, index)| {
                let rate = match kind {
                    0 => LoanRate::Fixed(rate),
                    1 => LoanRate::Variable { spread },
                    _ => LoanRate::Mixed {
                        fixed_rate: rate,
                        fixed_years: fixed_years.min(term_years),
                        spread,
                    },
                };
                (
                    Loan {
                        principal,
                        term_years,
                        rate,
                    },
                    index,
                )
            },
        )
}

proptest! {
    #[test]
    fn principal_repaid_adds_up_to_the_loan((loan, index) in any_loan()) {
        let rows = monthly_schedule(&loan, &index, 12 * loan.term_years);
        let repaid: f64 = rows.iter().map(|r| r.principal).sum();
        prop_assert!((repaid - loan.principal).abs() <= 1e-6 * loan.principal.max(1.0));
    }

    #[test]
    fn balance_never_increases((loan, index) in any_loan()) {
        let rows = monthly_schedule(&loan, &index, 12 * loan.term_years);
        let mut previous = loan.principal;
        for row in &rows {
            prop_assert!(row.balance <= previous + 1e-6);
            previous = row.balance;
        }
    }
}

#[test]
fn a_tiny_rate_still_repays_the_loan() {
    for annual in [1e-14, 1e-13, 1e-12] {
        let rate = annual / 12.0;
        let pay = payment(100_000.0, rate, 300);
        let mut balance = 100_000.0;
        for _ in 0..300 {
            balance = balance * (1.0 + rate) - pay;
        }
        assert!(balance.abs() < 0.05, "left {balance} at {annual}");
    }
}
