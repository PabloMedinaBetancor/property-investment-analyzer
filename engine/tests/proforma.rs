mod common;

use invest_engine::inputs::{Inputs, parse};
use invest_engine::proforma::{Analysis, analyze};
use serde_json::{Value, json};

use common::{assert_json_close, fixture};

fn analysis_of(inputs: &Value) -> Analysis {
    let scenario = parse::<Inputs>(inputs.to_string().as_bytes())
        .and_then(|inputs| inputs.resolve())
        .unwrap_or_else(|e| panic!("inputs do not resolve: {e:?}"));
    analyze(&scenario)
}

fn assert_matches_fixture(name: &str) {
    let fixture = fixture(name);
    let analysis = analysis_of(&fixture["inputs"]);
    assert_json_close(
        &fixture["result"],
        &serde_json::to_value(&analysis).unwrap(),
    );
}

#[test]
fn f2_new_build_flat_with_a_mixed_loan_and_no_tax_matches_the_reference() {
    assert_matches_fixture("proforma_F2");
}

#[test]
fn f1_resale_flat_with_a_fixed_loan_and_spanish_tax_matches_the_reference() {
    assert_matches_fixture("proforma_F1");
}

#[test]
fn f3_us_style_rental_with_depreciation_and_recapture_matches_the_reference() {
    assert_matches_fixture("proforma_F3");
}

#[test]
fn f4_variable_loan_repaid_mid_hold_over_36_years_matches_the_reference() {
    assert_matches_fixture("proforma_F4");
}

#[test]
fn f5_cash_purchase_with_losses_not_offset_matches_the_reference() {
    assert_matches_fixture("proforma_F5");
}

#[test]
fn the_schedule_runs_for_the_shorter_of_the_hold_and_the_term() {
    let f4 = analysis_of(&fixture("proforma_F4")["inputs"]);
    assert_eq!(f4.schedule.len(), 12 * 15);
    let f1 = analysis_of(&fixture("proforma_F1")["inputs"]);
    assert_eq!(f1.schedule.len(), 12 * 10);
    assert_eq!(f1.schedule[0].month, 1);
    let f5 = analysis_of(&fixture("proforma_F5")["inputs"]);
    assert!(f5.schedule.is_empty());
}

#[test]
fn a_schedule_row_carries_the_first_instalment_of_f1() {
    let analysis = analysis_of(&fixture("proforma_F1")["inputs"]);
    let first = &analysis.schedule[0];
    // 126 000 at 3.2 % over 25 years: 126 000 * (0.032/12) / (1 - (1 + 0.032/12)^-300)
    assert!((first.payment - 610.695).abs() < 1e-3, "{}", first.payment);
    assert!((first.interest - 126_000.0 * 0.032 / 12.0).abs() < 1e-9);
}

#[test]
fn tax_off_leaves_no_amortisation_and_equal_after_and_pre_tax_flows() {
    let analysis = analysis_of(&fixture("proforma_F2")["inputs"]);
    assert!(analysis.amortisation_taken.is_none());
    assert_eq!(analysis.flows, analysis.flows_pre_tax);
}

#[test]
fn extreme_valid_inputs_stay_finite() {
    let mut inputs = fixture("proforma_F1")["inputs"].clone();
    for (field, value) in [
        ("price", json!(1e9)),
        ("rent_month", json!(1e7)),
        ("g_rent", json!(0.5)),
        ("g_exp", json!(0.5)),
        ("g_app", json!(0.5)),
        ("years", json!(40)),
        ("renovation", json!(1e8)),
        ("discount_rate", json!(1)),
        ("ltv", json!(1)),
    ] {
        inputs[field] = value;
    }
    inputs["loan"] = json!({"kind": "fixed", "fixed_rate": 0.3, "term_years": 40});
    assert!(analysis_of(&inputs).check_finite().is_ok());
}

#[test]
fn a_number_that_is_not_finite_is_reported_at_the_result() {
    let mut analysis = analysis_of(&fixture("proforma_F1")["inputs"]);
    assert!(analysis.check_finite().is_ok());
    analysis.years[3].noi = f64::NAN;
    let error = analysis.check_finite().unwrap_err();
    assert_eq!(error.field, "result");
    assert_eq!(error.code, invest_engine::error::ErrorCode::NotFinite);
}

#[test]
fn the_finiteness_check_covers_the_acquisition_costs_and_the_amortisation_taken() {
    let clean = analysis_of(&fixture("proforma_F1")["inputs"]);
    clean.check_finite().unwrap();
    assert!(clean.amortisation_taken.is_some() && clean.acquisition.notary.is_some());

    let poisoned: [fn(&mut Analysis); 5] = [
        |a| a.amortisation_taken = Some(f64::NAN),
        |a| a.acquisition.transfer_tax = f64::INFINITY,
        |a| a.acquisition.notary = Some(f64::NAN),
        |a| a.acquisition.registry = Some(f64::NAN),
        |a| a.acquisition.loan = f64::NAN,
    ];
    for poison in poisoned {
        let mut analysis = clean.clone();
        poison(&mut analysis);
        assert!(analysis.check_finite().is_err());
    }
}
