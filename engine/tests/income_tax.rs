mod common;

use common::fixture;
use invest_engine::income_tax::{GenericTax, SpainTax, TaxRules, TaxState, YearIncome};
use invest_engine::market::spain;

fn close(expected: f64, actual: f64) -> bool {
    (expected - actual).abs() <= 1e-9 * 1.0_f64.max(expected.abs()).max(actual.abs())
}

fn numbers(value: &serde_json::Value) -> Vec<f64> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .collect()
}

#[test]
fn spanish_cases_match_tax_amortisation_and_carry_year_by_year() {
    let doc = fixture("income_tax");
    for case in doc["spain"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let rules = TaxRules::Spain(SpainTax {
            marginal: case["marginal"].as_f64().unwrap(),
            reduction: case["reduction"].as_f64().unwrap(),
            offset_other_income: case["offset_other_income"].as_bool().unwrap(),
            amortisation_per_year: case["amortisation_per_year"].as_f64().unwrap(),
            amortisation_basis: case["amortisation_basis"].as_f64().unwrap(),
            capital_gains: &spain().capital_gains,
        });
        let (income, interest) = (numbers(&case["income"]), numbers(&case["interest"]));
        let (repairs, other) = (
            numbers(&case["repairs"]),
            numbers(&case["other_deductible"]),
        );
        let (tax, taken) = (numbers(&case["tax"]), numbers(&case["amortisation"]));
        let mut state = TaxState::default();
        let mut taken_so_far = 0.0;
        for k in 0..income.len() {
            let y = YearIncome {
                collected: income[k],
                interest: interest[k],
                repairs: repairs[k],
                other_deductible: other[k],
                opex: 0.0,
            };
            let actual = rules.year_tax(k + 1, &y, &mut state);
            assert!(
                close(tax[k], actual),
                "{name}, year {}: tax {actual}",
                k + 1
            );
            assert!(
                close(taken[k], state.amortisation_taken - taken_so_far),
                "{name}, year {}: amortisation",
                k + 1
            );
            taken_so_far = state.amortisation_taken;

            // The reference lists the leftover of year t-4 too, which can no longer be used.
            let expected_carry: Vec<_> = case["carry_after"][k]
                .as_array()
                .unwrap()
                .iter()
                .filter(|pair| pair[0].as_u64().unwrap() + 3 >= (k + 1) as u64)
                .collect();
            let mut actual_carry = Vec::new();
            for (age, amount) in state.carry.iter().enumerate() {
                if *amount > 0.0 {
                    actual_carry.push(((k + 1 - age) as u64, *amount));
                }
            }
            actual_carry.sort_by_key(|(origin, _)| *origin);
            assert_eq!(
                actual_carry.len(),
                expected_carry.len(),
                "{name}, year {}: carry",
                k + 1
            );
            for (pair, (origin, amount)) in expected_carry.iter().zip(&actual_carry) {
                assert_eq!(pair[0].as_u64().unwrap(), *origin, "{name}: carry origin");
                assert!(
                    close(pair[1].as_f64().unwrap(), *amount),
                    "{name}: carry amount"
                );
            }
        }
        assert!(
            close(
                case["amortisation_taken"].as_f64().unwrap(),
                state.amortisation_taken
            ),
            "{name}: total amortisation"
        );
    }
}

#[test]
fn generic_cases_match_tax_and_depreciation_year_by_year() {
    let doc = fixture("income_tax");
    for case in doc["generic"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let rules = TaxRules::Generic(GenericTax {
            rate: case["rate"].as_f64().unwrap(),
            interest_deductible: case["interest_deductible"].as_bool().unwrap(),
            offset_losses: case["offset_losses"].as_bool().unwrap(),
            depreciation_years: case["depreciation_years"].as_f64().unwrap(),
            depreciation_per_year: case["depreciation_per_year"].as_f64().unwrap(),
            capital_gains_rate: 0.0,
            recapture_rate: 0.0,
        });
        let (collected, interest) = (numbers(&case["collected"]), numbers(&case["interest"]));
        let (opex, tax) = (numbers(&case["opex"]), numbers(&case["tax"]));
        let depreciation = numbers(&case["depreciation"]);
        let mut state = TaxState::default();
        let mut taken_so_far = 0.0;
        for k in 0..collected.len() {
            let y = YearIncome {
                collected: collected[k],
                interest: interest[k],
                repairs: 0.0,
                other_deductible: 0.0,
                opex: opex[k],
            };
            let actual = rules.year_tax(k + 1, &y, &mut state);
            assert!(
                close(tax[k], actual),
                "{name}, year {}: tax {actual}",
                k + 1
            );
            assert!(
                close(depreciation[k], state.amortisation_taken - taken_so_far),
                "{name}, year {}: depreciation",
                k + 1
            );
            taken_so_far = state.amortisation_taken;
        }
        assert!(
            close(
                case["depreciation_taken"].as_f64().unwrap(),
                state.amortisation_taken
            ),
            "{name}: total depreciation"
        );
    }
}

#[test]
fn generic_exit_tax_matches_recapture_plus_capital_gains() {
    let doc = fixture("income_tax");
    for case in doc["generic_exit"].as_array().unwrap() {
        let rules = TaxRules::Generic(GenericTax {
            rate: 0.0,
            interest_deductible: true,
            offset_losses: true,
            depreciation_years: 0.0,
            depreciation_per_year: 0.0,
            capital_gains_rate: case["capital_gains_rate"].as_f64().unwrap(),
            recapture_rate: case["recapture_rate"].as_f64().unwrap(),
        });
        let state = TaxState {
            carry: [0.0; 4],
            amortisation_taken: case["depreciation_taken"].as_f64().unwrap(),
        };
        let actual = rules.exit_tax(case["gain"].as_f64().unwrap(), &state);
        assert!(
            close(case["exit_tax"].as_f64().unwrap(), actual),
            "gain {}",
            case["gain"]
        );
    }
}

#[test]
fn spanish_exit_tax_on_a_60000_gain_is_12_680_from_the_savings_scale() {
    let rules = TaxRules::Spain(SpainTax {
        marginal: 0.37,
        reduction: 0.5,
        offset_other_income: true,
        amortisation_per_year: 0.0,
        amortisation_basis: 0.0,
        capital_gains: &spain().capital_gains,
    });
    assert!(close(
        12_680.0,
        rules.exit_tax(60_000.0, &TaxState::default())
    ));
    assert_eq!(rules.exit_tax(-1_000.0, &TaxState::default()), 0.0);
}

#[test]
fn without_income_tax_nothing_is_charged_in_a_year_or_on_exit() {
    let y = YearIncome {
        collected: 10_000.0,
        interest: 0.0,
        repairs: 0.0,
        other_deductible: 0.0,
        opex: 0.0,
    };
    let mut state = TaxState::default();
    assert_eq!(TaxRules::None.year_tax(1, &y, &mut state), 0.0);
    assert_eq!(TaxRules::None.exit_tax(50_000.0, &state), 0.0);
}
