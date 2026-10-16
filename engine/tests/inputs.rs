mod common;

use invest_engine::error::{ErrorCode, InputError};
use invest_engine::income_tax::TaxRules;
use invest_engine::inputs::{Inputs, parse};
use invest_engine::loan::LoanRate;
use serde_json::{Value, json};

use common::{assert_json_close, fixture};

fn fixture_inputs(name: &str) -> Value {
    fixture(name)["inputs"].clone()
}

fn resolve(document: &Value) -> Result<invest_engine::proforma::Scenario, InputError> {
    parse::<Inputs>(document.to_string().as_bytes())?.resolve()
}

#[test]
fn every_fixture_resolves_to_its_acquisition_block() {
    for name in ["F1", "F2", "F3", "F4", "F5"] {
        let fixture = fixture(&format!("proforma_{name}"));
        let scenario = resolve(&fixture["inputs"]).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let acquisition = serde_json::to_value(&scenario.acquisition).unwrap();
        assert_json_close(&fixture["result"]["acquisition"], &acquisition);
    }
}

#[test]
fn f1_resolves_a_fixed_loan_and_the_spanish_amortisation_basis() {
    let scenario = resolve(&fixture_inputs("proforma_F1")).unwrap();
    let acq_costs = fixture("proforma_F1")["result"]["acquisition"]["acq_costs"]
        .as_f64()
        .unwrap();
    let basis = 180_000.0 + acq_costs + 15_000.0;
    assert_eq!(scenario.years, 10);
    assert_eq!(scenario.fixed_costs, 450.0 + 720.0 + 250.0);
    assert_eq!(scenario.value0, 180_000.0);
    assert!((scenario.basis - basis).abs() < 1e-9);
    assert_eq!(scenario.index0, 0.0);
    let loan = scenario.loan.unwrap();
    assert_eq!(loan.principal, 0.7 * 180_000.0);
    assert_eq!(loan.term_years, 25);
    assert!(matches!(loan.rate, LoanRate::Fixed(r) if r == 0.032));
    let TaxRules::Spain(tax) = scenario.tax else {
        panic!("F1 has the Spanish tax on");
    };
    assert!((tax.amortisation_per_year - 0.03 * 0.6 * basis).abs() < 1e-9);
    assert!((tax.amortisation_basis - 0.6 * basis).abs() < 1e-9);
}

#[test]
fn f2_keeps_the_mixed_loan_and_its_index_path() {
    let scenario = resolve(&fixture_inputs("proforma_F2")).unwrap();
    let loan = scenario.loan.unwrap();
    assert!(matches!(
        loan.rate,
        LoanRate::Mixed { fixed_rate, fixed_years: 3, spread }
            if fixed_rate == 0.024 && spread == 0.008
    ));
    assert_eq!(scenario.index0, 0.022);
    assert_eq!(scenario.index_path.len(), 12);
    assert_eq!(scenario.index_path[5], 0.034);
    assert!(matches!(scenario.tax, TaxRules::None));
}

#[test]
fn f3_depreciates_the_building_share_over_27_and_a_half_years() {
    let scenario = resolve(&fixture_inputs("proforma_F3")).unwrap();
    // basis = 320 000 + (0.2 % + 2.5 %) of 320 000 + 10 000 = 338 640
    assert!((scenario.basis - 338_640.0).abs() < 1e-9);
    assert_eq!(scenario.property_tax_rate, 0.011);
    let TaxRules::Generic(tax) = scenario.tax else {
        panic!("F3 has the generic tax on");
    };
    assert!((tax.depreciation_per_year - 9851.345454545455).abs() < 1e-9);
    assert_eq!(tax.recapture_rate, 0.25);
}

#[test]
fn f4_takes_value0_and_the_variable_loan_index() {
    let scenario = resolve(&fixture_inputs("proforma_F4")).unwrap();
    assert_eq!(scenario.value0, 190_000.0);
    assert_eq!(scenario.years, 36);
    assert_eq!(scenario.index0, 0.025);
    assert_eq!(scenario.index_path.len(), 10);
    assert!(
        matches!(scenario.loan.unwrap().rate, LoanRate::Variable { spread } if spread == 0.012)
    );
}

#[test]
fn f5_without_a_loan_ignores_the_loan_object() {
    let scenario = resolve(&fixture_inputs("proforma_F5")).unwrap();
    assert!(scenario.loan.is_none());
    assert_eq!(scenario.acquisition.loan, 0.0);
}

#[test]
fn a_loan_with_ltv_zero_is_not_validated() {
    let mut document = fixture_inputs("proforma_F1");
    document["ltv"] = json!(0);
    document["loan"]["term_years"] = json!(99);
    document["loan"]["fixed_rate"] = json!(5);
    assert!(resolve(&document).unwrap().loan.is_none());
}

#[test]
fn fields_of_the_other_profile_are_accepted_and_ignored() {
    let mut spanish = fixture_inputs("proforma_F1");
    spanish["purchase"] = json!({"transfer_tax_rate": 9, "closing_cost_rate": 9, "closing_cost_fixed": 1e12, "buyer_agency_rate": 9});
    spanish["tax"]["rate"] = json!(9);
    assert!(resolve(&spanish).is_ok());

    let mut generic = fixture_inputs("proforma_F3");
    generic["region"] = json!("XX");
    generic["notary_extras"] = json!(-5);
    generic["tax"]["marginal"] = json!(9);
    assert!(resolve(&generic).is_ok());
}

enum Edit {
    Set(&'static str, Value),
    Remove(&'static str),
}
use Edit::{Remove, Set};

struct Case {
    base: &'static str,
    edits: Vec<Edit>,
    code: ErrorCode,
    field: &'static str,
}

fn apply(document: &mut Value, edit: &Edit) {
    let (Set(pointer, _) | Remove(pointer)) = edit;
    let (parent, key) = pointer.rsplit_once('/').unwrap();
    let parent = if parent.is_empty() {
        document
    } else {
        document.pointer_mut(parent).unwrap()
    };
    match (edit, parent) {
        (Set(_, value), Value::Array(items)) => {
            items[key.parse::<usize>().unwrap()] = value.clone()
        }
        (Set(_, value), Value::Object(fields)) => {
            fields.insert(key.to_owned(), value.clone());
        }
        (Remove(_), Value::Object(fields)) => {
            fields.remove(key).unwrap();
        }
        _ => panic!("cannot apply the edit at {pointer}"),
    }
}

/// One invalid document per row of the validation table: the fixture `base` with `edits` applied.
fn invalid_cases() -> Vec<Case> {
    use ErrorCode::{MissingField, NotFinite, OutOfRange, UnknownRegion};
    let case = |base, edits, code, field| Case {
        base,
        edits,
        code,
        field,
    };
    let mut cases = vec![
        case("F1", vec![Set("/price", json!(0))], OutOfRange, "price"),
        case(
            "F1",
            vec![Set("/price", json!(1e9 + 1.0))],
            OutOfRange,
            "price",
        ),
        case("F1", vec![Set("/price", Value::Null)], NotFinite, "price"),
        case("F1", vec![Remove("/price")], MissingField, "price"),
        case(
            "F3",
            vec![Set("/purchase/closing_cost_fixed", json!(1e8 + 1.0))],
            OutOfRange,
            "purchase.closing_cost_fixed",
        ),
        case(
            "F1",
            vec![Set("/reference_value", json!(-1))],
            OutOfRange,
            "reference_value",
        ),
        case("F1", vec![Set("/value0", json!(0))], OutOfRange, "value0"),
        case("F1", vec![Set("/ltv", json!(1.5))], OutOfRange, "ltv"),
        case(
            "F1",
            vec![Set("/loan/term_years", json!(41))],
            OutOfRange,
            "loan.term_years",
        ),
        case(
            "F1",
            vec![Set("/loan/term_years", json!(0))],
            OutOfRange,
            "loan.term_years",
        ),
        case(
            "F1",
            vec![Set("/loan/fixed_rate", json!(0.31))],
            OutOfRange,
            "loan.fixed_rate",
        ),
        case(
            "F2",
            vec![Set("/loan/spread", json!(0.11))],
            OutOfRange,
            "loan.spread",
        ),
        case(
            "F2",
            vec![Set("/loan/index", json!(0.21))],
            OutOfRange,
            "loan.index",
        ),
        case(
            "F2",
            vec![Set("/loan/index_path/1", json!(0.3))],
            OutOfRange,
            "loan.index_path[1]",
        ),
        case(
            "F2",
            vec![Set("/loan/index_path", json!(vec![0.02; 41]))],
            OutOfRange,
            "loan.index_path",
        ),
        case(
            "F2",
            vec![Set("/loan/fixed_years", json!(31))],
            OutOfRange,
            "loan.fixed_years",
        ),
        case(
            "F1",
            vec![Set("/rent_month", json!(0))],
            OutOfRange,
            "rent_month",
        ),
        case(
            "F1",
            vec![Set("/vacancy", json!(0.995))],
            OutOfRange,
            "vacancy",
        ),
        case("F1", vec![Set("/years", json!(0))], OutOfRange, "years"),
        case("F1", vec![Set("/years", json!(41))], OutOfRange, "years"),
        case(
            "F1",
            vec![Set("/manual_transfer_rate", json!(0.6))],
            OutOfRange,
            "manual_transfer_rate",
        ),
        case(
            "F1",
            vec![Set("/buyer_agency_rate", json!(0.6))],
            OutOfRange,
            "buyer_agency_rate",
        ),
        case(
            "F3",
            vec![Set("/purchase/transfer_tax_rate", json!(0.6))],
            OutOfRange,
            "purchase.transfer_tax_rate",
        ),
        case(
            "F3",
            vec![Set("/purchase/closing_cost_rate", json!(0.6))],
            OutOfRange,
            "purchase.closing_cost_rate",
        ),
        case(
            "F3",
            vec![Set("/purchase/buyer_agency_rate", json!(0.6))],
            OutOfRange,
            "purchase.buyer_agency_rate",
        ),
        case("F1", vec![Remove("/region")], MissingField, "region"),
        case("F1", vec![Remove("/new_build")], MissingField, "new_build"),
        case(
            "F1",
            vec![Remove("/notary_extras")],
            MissingField,
            "notary_extras",
        ),
        case("F1", vec![Remove("/gestoria")], MissingField, "gestoria"),
        case(
            "F1",
            vec![Remove("/buyer_agency_rate")],
            MissingField,
            "buyer_agency_rate",
        ),
        case(
            "F1",
            vec![Set("/region", json!("XX"))],
            UnknownRegion,
            "region",
        ),
        case(
            "F1",
            vec![Set("/region", json!("CE")), Set("/new_build", json!(true))],
            MissingField,
            "manual_transfer_rate",
        ),
        case("F3", vec![Remove("/purchase")], MissingField, "purchase"),
        case(
            "F1",
            vec![Remove("/tax/marginal")],
            MissingField,
            "tax.marginal",
        ),
        case(
            "F1",
            vec![Remove("/tax/reduction")],
            MissingField,
            "tax.reduction",
        ),
        case(
            "F1",
            vec![Remove("/tax/construction_share")],
            MissingField,
            "tax.construction_share",
        ),
        case(
            "F1",
            vec![Remove("/tax/offset_other_income")],
            MissingField,
            "tax.offset_other_income",
        ),
        case("F3", vec![Remove("/tax/rate")], MissingField, "tax.rate"),
        case(
            "F3",
            vec![Remove("/tax/building_share")],
            MissingField,
            "tax.building_share",
        ),
        case(
            "F3",
            vec![Remove("/tax/depreciation_recapture_rate")],
            MissingField,
            "tax.depreciation_recapture_rate",
        ),
        case(
            "F1",
            vec![Set("/tax/marginal", json!(0.71))],
            OutOfRange,
            "tax.marginal",
        ),
        case(
            "F1",
            vec![Set("/tax/reduction", json!(1.1))],
            OutOfRange,
            "tax.reduction",
        ),
        case(
            "F1",
            vec![Set("/tax/construction_share", json!(-0.1))],
            OutOfRange,
            "tax.construction_share",
        ),
        case(
            "F3",
            vec![Set("/tax/rate", json!(0.71))],
            OutOfRange,
            "tax.rate",
        ),
        case(
            "F3",
            vec![Set("/tax/capital_gains_rate", json!(0.71))],
            OutOfRange,
            "tax.capital_gains_rate",
        ),
        case(
            "F3",
            vec![Set("/tax/depreciation_recapture_rate", json!(0.71))],
            OutOfRange,
            "tax.depreciation_recapture_rate",
        ),
        case(
            "F3",
            vec![Set("/tax/building_share", json!(1.1))],
            OutOfRange,
            "tax.building_share",
        ),
        case(
            "F3",
            vec![Set("/tax/depreciation_years", json!(0.5))],
            OutOfRange,
            "tax.depreciation_years",
        ),
        case(
            "F3",
            vec![Set("/tax/depreciation_years", json!(101))],
            OutOfRange,
            "tax.depreciation_years",
        ),
    ];
    let outside: [(&str, &str, f64); 17] = [
        ("renovation", "/renovation", -1.0),
        ("loan_fees", "/loan_fees", -1.0),
        ("ibi", "/ibi", -1.0),
        ("community", "/community", -1.0),
        ("insurance", "/insurance", -1.0),
        ("other_fixed", "/other_fixed", -1.0),
        ("municipal_gain_tax", "/municipal_gain_tax", -1.0),
        ("notary_extras", "/notary_extras", 1e8 + 1.0),
        ("gestoria", "/gestoria", 1e8 + 1.0),
        ("maintenance_rate", "/maintenance_rate", 0.95),
        ("management_rate", "/management_rate", 0.95),
        ("property_tax_rate", "/property_tax_rate", 0.06),
        ("g_rent", "/g_rent", 0.6),
        ("g_exp", "/g_exp", -0.6),
        ("g_app", "/g_app", 0.6),
        ("sell_rate", "/sell_rate", 0.6),
        ("discount_rate", "/discount_rate", 1.5),
    ];
    for (field, pointer, value) in outside {
        cases.push(case(
            "F1",
            vec![Set(pointer, json!(value))],
            OutOfRange,
            field,
        ));
    }
    cases
}

#[test]
fn every_row_of_the_validation_table_reports_its_code_and_field() {
    let cases = invalid_cases();
    assert!(cases.len() >= 25);
    let mut wrong = Vec::new();
    for c in &cases {
        let mut document = fixture_inputs(&format!("proforma_{}", c.base));
        c.edits.iter().for_each(|edit| apply(&mut document, edit));
        match resolve(&document) {
            Err(e) if e.code == c.code && e.field == c.field => {}
            other => wrong.push(format!(
                "{} + {:?}: expected {:?} at {}, got {other:?}",
                c.base,
                c.edits
                    .iter()
                    .map(|e| match e {
                        Set(p, _) | Remove(p) => *p,
                    })
                    .collect::<Vec<_>>(),
                c.code,
                c.field
            )),
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

#[test]
fn the_first_failing_row_wins() {
    let mut document = fixture_inputs("proforma_F1");
    document["years"] = json!(0);
    document["price"] = json!(0);
    document["vacancy"] = json!(2);
    let e = resolve(&document).unwrap_err();
    assert_eq!((e.code, e.field.as_str()), (ErrorCode::OutOfRange, "price"));
}

fn parse_error(json: &str) -> InputError {
    parse::<Inputs>(json.as_bytes()).unwrap_err()
}

#[test]
fn broken_json_is_invalid_json_for_the_whole_document() {
    let e = parse_error("{\"price\": 1,");
    assert_eq!((e.code, e.field.as_str()), (ErrorCode::InvalidJson, ""));
    let complete = format!("{} garbage", fixture_inputs("proforma_F1"));
    assert_eq!(parse_error(&complete).code, ErrorCode::InvalidJson);
}

#[test]
fn an_unknown_field_is_invalid_json_at_that_field() {
    let mut document = fixture_inputs("proforma_F1");
    document["pricee"] = json!(1);
    let e = parse_error(&document.to_string());
    assert_eq!(
        (e.code, e.field.as_str()),
        (ErrorCode::InvalidJson, "pricee")
    );

    let mut document = fixture_inputs("proforma_F1");
    document["loan"]["rate"] = json!(0.03);
    let e = parse_error(&document.to_string());
    assert_eq!(
        (e.code, e.field.as_str()),
        (ErrorCode::InvalidJson, "loan.rate")
    );
}

#[test]
fn a_string_where_a_number_belongs_is_invalid_json_at_its_path() {
    let mut document = fixture_inputs("proforma_F1");
    document["rent_month"] = json!("950");
    let e = parse_error(&document.to_string());
    assert_eq!(
        (e.code, e.field.as_str()),
        (ErrorCode::InvalidJson, "rent_month")
    );
}

#[test]
fn a_missing_loan_field_carries_the_nested_path() {
    let mut document = fixture_inputs("proforma_F1");
    document["loan"]
        .as_object_mut()
        .unwrap()
        .remove("term_years");
    let e = parse_error(&document.to_string());
    assert_eq!(
        (e.code, e.field.as_str()),
        (ErrorCode::MissingField, "loan.term_years")
    );
}

#[test]
fn a_null_in_a_number_inside_the_loan_is_not_finite() {
    let mut document = fixture_inputs("proforma_F1");
    document["loan"]["fixed_rate"] = Value::Null;
    let e = parse_error(&document.to_string());
    assert_eq!(
        (e.code, e.field.as_str()),
        (ErrorCode::NotFinite, "loan.fixed_rate")
    );
}

#[test]
fn a_loan_kind_that_does_not_exist_is_invalid_json() {
    let mut document = fixture_inputs("proforma_F1");
    document["loan"]["kind"] = json!("balloon");
    assert_eq!(
        parse_error(&document.to_string()).code,
        ErrorCode::InvalidJson
    );
}
