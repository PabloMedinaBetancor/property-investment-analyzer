use invest_engine::inputs::Inputs;
use invest_engine::sensitivity::sensitivity;
use serde_json::Value;

mod common;

#[test]
fn f1_tornado_matches_the_reference_bars_values_and_order() {
    let expected = common::fixture("sensitivity_F1");
    let inputs: Inputs = serde_json::from_value(expected["inputs"].clone()).unwrap();
    let result = sensitivity(&inputs).unwrap();
    let base = serde_json::json!({ "npv": result.base_npv, "irr": result.base_irr });
    common::assert_json_close(&expected["base"], &base);
    let actual: Value = serde_json::to_value(&result.bars).unwrap();
    common::assert_json_close(&expected["bars"], &actual);
    let order: Vec<&str> = actual
        .as_array()
        .unwrap()
        .iter()
        .map(|bar| bar["variable"].as_str().unwrap())
        .collect();
    assert_eq!(
        order,
        [
            "appreciation",
            "rent",
            "interest",
            "price",
            "vacancy",
            "rent_growth",
            "opex"
        ]
    );
}

#[test]
fn a_loanless_property_has_an_interest_bar_of_zero_width() {
    let mut inputs: Inputs =
        serde_json::from_value(common::fixture("sensitivity_F1")["inputs"].clone()).unwrap();
    inputs.ltv = 0.0;
    let result = sensitivity(&inputs).unwrap();
    assert_eq!(result.bars.len(), 7);
    let interest = result
        .bars
        .iter()
        .find(|bar| serde_json::to_value(bar.variable).unwrap() == "interest")
        .unwrap();
    assert_eq!(interest.npv_low, interest.npv_high);
}

fn f1_with(change: impl FnOnce(&mut Value)) -> Inputs {
    let mut inputs = common::fixture("sensitivity_F1")["inputs"].clone();
    change(&mut inputs);
    serde_json::from_value(inputs).unwrap()
}

fn bar(result: &invest_engine::sensitivity::Sensitivity, name: &str) -> Value {
    let bars = serde_json::to_value(&result.bars).unwrap();
    bars.as_array()
        .unwrap()
        .iter()
        .find(|bar| bar["variable"] == name)
        .unwrap()
        .clone()
}

#[test]
fn a_zero_percent_fixed_loan_has_no_lower_interest_bar() {
    let inputs = f1_with(|x| {
        x["loan"] = serde_json::json!({ "kind": "fixed", "fixed_rate": 0.0, "term_years": 25 });
    });
    let result = sensitivity(&inputs).unwrap();
    let interest = bar(&result, "interest");
    assert_eq!(interest["low_value"], 0.0);
    assert_eq!(interest["high_value"], 0.01);
    assert_eq!(interest["npv_low"].as_f64().unwrap(), result.base_npv);
}

#[test]
fn vacancy_of_80_percent_steps_to_75_and_85() {
    let result = sensitivity(&f1_with(|x| x["vacancy"] = 0.8.into())).unwrap();
    let vacancy = bar(&result, "vacancy");
    assert!((vacancy["low_value"].as_f64().unwrap() - 0.75).abs() < 1e-12);
    assert!((vacancy["high_value"].as_f64().unwrap() - 0.85).abs() < 1e-12);
    assert!(vacancy["npv_high"].as_f64().unwrap() < vacancy["npv_low"].as_f64().unwrap());
}

#[test]
fn a_price_of_1e9_stops_its_high_step_at_the_limit() {
    let result = sensitivity(&f1_with(|x| x["price"] = 1e9.into())).unwrap();
    let price = bar(&result, "price");
    assert_eq!(price["low_value"], 0.9e9);
    assert_eq!(price["high_value"], 1e9);
}

#[test]
fn appreciation_and_the_index_stop_at_their_limits() {
    let inputs = f1_with(|x| {
        x["g_app"] = 0.49.into();
        x["loan"] = serde_json::json!({ "kind": "variable", "spread": 0.01, "index": 0.195,
            "index_path": [0.2], "term_years": 25 });
    });
    let result = sensitivity(&inputs).unwrap();
    assert_eq!(bar(&result, "appreciation")["high_value"], 0.5);
    assert_eq!(bar(&result, "interest")["high_value"], 0.2);
}
