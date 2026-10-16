mod common;

use common::fixture;
use invest_engine::metrics::{
    Irr, NoIrr, ScenarioIrr, irr, mirr, npv, payback, scenario_irr, sign_changes,
};
use proptest::prelude::*;
use serde_json::Value;

fn floats(value: &Value) -> Vec<f64> {
    value
        .as_array()
        .expect("array")
        .iter()
        .map(|v| v.as_f64().expect("number"))
        .collect()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * 1.0_f64.max(a.abs()).max(b.abs())
}

#[test]
fn npv_at_10pct_does_not_discount_t0_unlike_excels_npv_function() {
    let case = &fixture("npv")[0];
    let flows = floats(&case["flows_t0_first"]);
    let got = npv(case["rate"].as_f64().expect("rate"), &flows);
    assert!(close(got, 1307.287753568743), "{got}");
    assert!(!close(
        got,
        case["excel_npv_function_gives"].as_f64().expect("excel")
    ));
}

#[test]
fn sign_changes_skips_zeros() {
    assert_eq!(sign_changes(&[0.0, -100.0, 0.0, 121.0]), 1);
    assert_eq!(sign_changes(&[-100.0, 230.0, -132.0]), 2);
    assert_eq!(sign_changes(&[100.0, 50.0]), 0);
    assert_eq!(sign_changes(&[]), 0);
}

fn expected_irr(value: &Value) -> Irr {
    match value["kind"].as_str().expect("kind") {
        "Unique" => Irr::Unique {
            rate: value["rate"].as_f64().expect("rate"),
        },
        "Multiple" => Irr::Multiple {
            rates: floats(&value["rates"]),
        },
        _ => Irr::None {
            reason: match value["reason"].as_str().expect("reason") {
                "NoSignChange" => NoIrr::NoSignChange,
                _ => NoIrr::OutOfRange,
            },
        },
    }
}

fn same_irr(want: &Irr, got: &Irr) -> bool {
    match (want, got) {
        (Irr::Unique { rate: a }, Irr::Unique { rate: b }) => close(*a, *b),
        (Irr::Multiple { rates: a }, Irr::Multiple { rates: b }) => {
            a.len() == b.len() && a.iter().zip(b).all(|(x, y)| close(*x, *y))
        }
        _ => want == got,
    }
}

#[test]
fn irr_agrees_with_every_reference_case() {
    for case in fixture("irr").as_array().expect("array") {
        let flows = floats(&case["flows"]);
        let want = expected_irr(&case["irr"]);
        let got = irr(&flows);
        assert!(
            same_irr(&want, &got),
            "{}: expected {want:?}, got {got:?}",
            case["note"]
        );
    }
}

#[test]
fn scenario_irr_agrees_with_every_reference_case() {
    for case in fixture("irr").as_array().expect("array") {
        let flows = floats(&case["flows"]);
        let got = scenario_irr(&flows);
        let ok = match expected_irr(&case["irr"]) {
            Irr::Unique { rate } => matches!(got, ScenarioIrr::Rate(r) if close(r, rate)),
            Irr::Multiple { .. } => got == ScenarioIrr::Multiple,
            Irr::None { .. } => got == ScenarioIrr::NoRoot,
        };
        assert!(ok, "{}: got {got:?}", case["note"]);
    }
}

#[test]
fn scenario_irr_of_a_35_year_hold_with_a_large_exit_is_the_root_not_an_unconverged_step() {
    let flows = [
        -612381.0, -30272.0, -29880.0, -29466.0, -29027.0, -28562.0, -28070.0, -27549.0, -26998.0,
        -26414.0, -25796.0, -25142.0, -24450.0, -23717.0, -22941.0, -22121.0, -21252.0, -20332.0,
        -19358.0, 15890.0, 13066.0, 13848.0, 14676.0, 15553.0, 16480.0, 17462.0, 18502.0, 19602.0,
        20766.0, 21998.0, 23303.0, 24683.0, 26144.0, 27691.0, 28196.0, 1279481.0,
    ];
    let Irr::Unique { rate } = irr(&flows) else {
        panic!("one sign change has one root");
    };
    assert!((rate - 0.0134020).abs() < 1e-6, "scan: {rate}");
    assert!(matches!(scenario_irr(&flows), ScenarioIrr::Rate(r) if close(r, rate)));
}

#[test]
fn mirr_agrees_with_the_two_excel_documentation_examples() {
    for case in fixture("mirr").as_array().expect("array") {
        let got = mirr(
            &floats(&case["flows"]),
            case["finance"].as_f64().expect("finance"),
            case["reinvest"].as_f64().expect("reinvest"),
        )
        .expect("defined");
        assert!(
            close(got, case["mirr"].as_f64().expect("mirr")),
            "{}: {got}",
            case["note"]
        );
    }
}

#[test]
fn mirr_needs_a_positive_and_a_negative_flow() {
    assert_eq!(mirr(&[-100.0, -50.0], 0.05, 0.05), None);
    assert_eq!(mirr(&[100.0, 50.0], 0.05, 0.05), None);
    assert_eq!(mirr(&[-100.0], 0.05, 0.05), None);
}

#[test]
fn payback_agrees_with_every_reference_case() {
    for case in fixture("payback").as_array().expect("array") {
        let got = payback(
            case["cf0"].as_f64().expect("cf0"),
            &floats(&case["operating"]),
        );
        match case["payback"].as_f64() {
            Some(want) => assert!(close(got.expect("a payback"), want)),
            None => assert_eq!(got, None),
        }
    }
}

#[test]
fn payback_is_zero_when_nothing_was_invested() {
    assert_eq!(payback(0.0, &[10.0]), Some(0.0));
}

fn one_change_flows() -> impl Strategy<Value = Vec<f64>> {
    (100.0..1.0e6, proptest::collection::vec(1.0..1.0e5, 1..30)).prop_map(
        |(outlay, gains): (f64, Vec<f64>)| std::iter::once(-outlay).chain(gains).collect(),
    )
}

// Years of small losses, then small gains and one exit worth most of the money: Newton's worst case.
fn long_hold_flows() -> impl Strategy<Value = Vec<f64>> {
    (
        1.0e4..1.0e6,
        proptest::collection::vec(1.0..5.0e4, 15..40),
        1.0e5..1.0e7,
    )
        .prop_map(|(outlay, running, exit): (f64, Vec<f64>, f64)| {
            let split = running.len() / 2;
            let (losses, gains) = running.split_at(split);
            std::iter::once(-outlay)
                .chain(losses.iter().map(|f| -f))
                .chain(gains.iter().copied())
                .chain(std::iter::once(exit))
                .collect()
        })
}

fn two_change_flows() -> impl Strategy<Value = Vec<f64>> {
    (
        100.0..1.0e5,
        proptest::collection::vec(1.0..1.0e5, 1..20),
        1.0..1.0e5,
    )
        .prop_map(|(outlay, gains, closing): (f64, Vec<f64>, f64)| {
            std::iter::once(-outlay)
                .chain(gains)
                .chain(std::iter::once(-closing))
                .collect()
        })
}

proptest! {
    #[test]
    fn npv_at_the_irr_is_zero_relative_to_the_flows(flows in one_change_flows()) {
        if let Irr::Unique { rate } = irr(&flows) {
            let scale: f64 = flows.iter().map(|f| f.abs()).sum();
            prop_assert!(npv(rate, &flows).abs() <= 1e-9 * scale);
        }
    }

    #[test]
    fn scaling_every_flow_leaves_the_irr_unchanged(flows in one_change_flows(), k in 0.01..1.0e3) {
        let scaled: Vec<f64> = flows.iter().map(|f| f * k).collect();
        match (irr(&flows), irr(&scaled)) {
            (Irr::Unique { rate: a }, Irr::Unique { rate: b }) => prop_assert!((a - b).abs() < 1e-9),
            (a, b) => prop_assert_eq!(a, b),
        }
    }

    #[test]
    fn scenario_irr_is_irr_on_one_and_two_sign_changes(
        flows in prop_oneof![one_change_flows(), two_change_flows()],
    ) {
        match (irr(&flows), scenario_irr(&flows)) {
            (Irr::Unique { rate }, ScenarioIrr::Rate(r)) => prop_assert!((rate - r).abs() < 1e-12),
            (Irr::Multiple { .. }, ScenarioIrr::Multiple) => {}
            (Irr::None { .. }, ScenarioIrr::NoRoot) => {}
            (a, b) => prop_assert!(false, "{a:?} vs {b:?}"),
        }
    }

    #[test]
    fn scenario_irr_is_irr_on_long_holds_with_a_large_exit(flows in long_hold_flows()) {
        match (irr(&flows), scenario_irr(&flows)) {
            (Irr::Unique { rate }, ScenarioIrr::Rate(r)) => prop_assert!((rate - r).abs() < 1e-9, "{rate} vs {r}"),
            (a, b) => prop_assert!(false, "{a:?} vs {b:?}"),
        }
    }
}
