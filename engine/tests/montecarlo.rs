mod common;

use invest_engine::error::ErrorCode;
use invest_engine::inputs::{Inputs, parse};
use invest_engine::montecarlo::{IrrPoint, McParams, McResult, Simulator};
use invest_engine::proforma::{Scenario, analyze};
use proptest::prelude::*;
use serde_json::{Value, json};

use common::{assert_json_close, fixture};

fn scenario_of(inputs: &Value) -> Scenario {
    parse::<Inputs>(inputs.to_string().as_bytes())
        .and_then(|inputs| inputs.resolve())
        .unwrap_or_else(|e| panic!("inputs do not resolve: {e:?}"))
}

fn params_of(value: &Value) -> McParams {
    serde_json::from_value(value.clone()).unwrap()
}

fn simulate(scenario: &Scenario, params: &McParams, n: u32, seed: u32) -> McResult {
    Simulator::default().run(scenario, params, n, seed).unwrap()
}

fn assert_matches_fixture(simulation: &str, case: &str) {
    let mut expected = fixture(simulation);
    let params = params_of(&expected["params"]);
    let (n, seed) = (
        expected["n"].as_u64().unwrap() as u32,
        expected["seed"].as_u64().unwrap() as u32,
    );
    let object = expected.as_object_mut().unwrap();
    for key in ["params", "n", "seed"] {
        object.remove(key);
    }
    let scenario = scenario_of(&fixture(case)["inputs"]);
    let actual = serde_json::to_value(simulate(&scenario, &params, n, seed)).unwrap();
    assert_json_close(&expected, &actual);
}

#[test]
fn f1_fixed_loan_with_tax_matches_the_reference_over_2000_scenarios() {
    assert_matches_fixture("monte_carlo_F1_n2000_seed42", "proforma_F1");
}

#[test]
fn f2_mixed_loan_following_the_index_matches_the_reference_over_2000_scenarios() {
    assert_matches_fixture("monte_carlo_F2_n2000_seed42", "proforma_F2");
}

#[test]
fn f3_generic_profile_matches_the_reference_over_500_scenarios_with_seed_7() {
    assert_matches_fixture("monte_carlo_F3_n500_seed7", "proforma_F3");
}

fn default_params() -> McParams {
    params_of(&fixture("monte_carlo_F1_n2000_seed42")["params"])
}

fn without_noise(mut params: McParams) -> McParams {
    params.sigma_index = 0.0;
    params.sigma_rent = 0.0;
    params.sigma_app = 0.0;
    params.sigma_exp = 0.0;
    params
}

#[test]
fn zero_volatility_and_no_vacancy_reproduce_the_analysis_bit_for_bit() {
    let mut inputs = fixture("proforma_F2")["inputs"].clone();
    inputs["vacancy"] = json!(0);
    inputs["loan"].as_object_mut().unwrap().remove("index_path");
    let scenario = scenario_of(&inputs);
    let analysis = analyze(&scenario);
    let result = simulate(&scenario, &without_noise(default_params()), 50, 1);

    for percentile in result.npv_p {
        assert_eq!(percentile.to_bits(), analysis.metrics.npv.to_bits());
    }
    for (t, band) in result.cum_p_by_year.iter().enumerate() {
        for value in band {
            assert_eq!(
                value.to_bits(),
                analysis.cumulative[t].to_bits(),
                "year {t}"
            );
        }
    }
}

#[test]
fn the_same_seed_gives_the_same_bytes_and_another_seed_does_not() {
    let scenario = scenario_of(&fixture("proforma_F2")["inputs"]);
    let params = default_params();
    let bytes = |seed| serde_json::to_vec(&simulate(&scenario, &params, 300, seed)).unwrap();
    assert_eq!(bytes(42), bytes(42));
    assert_ne!(bytes(42), bytes(43));
}

#[test]
fn a_reused_simulator_ignores_what_a_larger_earlier_run_left_in_its_buffers() {
    let scenario = scenario_of(&fixture("proforma_F1")["inputs"]);
    let params = default_params();
    let mut reused = Simulator::default();
    reused.run(&scenario, &params, 800, 5).unwrap();
    let second = reused.run(&scenario, &params, 200, 9).unwrap();
    let fresh = simulate(&scenario, &params, 200, 9);
    assert_eq!(
        serde_json::to_vec(&second).unwrap(),
        serde_json::to_vec(&fresh).unwrap()
    );
}

#[test]
fn the_histogram_accounts_for_every_scenario() {
    let scenario = scenario_of(&fixture("proforma_F1")["inputs"]);
    let histogram = simulate(&scenario, &default_params(), 1000, 3).npv_histogram;
    assert_eq!(histogram.edges.len(), 31);
    assert_eq!(histogram.counts.len(), 30);
    let total = histogram.counts.iter().sum::<u32>() + histogram.below + histogram.above;
    assert_eq!(total, 1000);
}

#[test]
fn an_empty_scenario_count_is_out_of_range_at_n() {
    let scenario = scenario_of(&fixture("proforma_F1")["inputs"]);
    let error = Simulator::default()
        .run(&scenario, &default_params(), 0, 1)
        .unwrap_err();
    assert_eq!(
        (error.code, error.field.as_str()),
        (ErrorCode::OutOfRange, "n")
    );
}

#[test]
fn more_than_100_000_scenarios_is_too_many() {
    let scenario = scenario_of(&fixture("proforma_F1")["inputs"]);
    let error = Simulator::default()
        .run(&scenario, &default_params(), 100_001, 1)
        .unwrap_err();
    assert_eq!(
        (error.code, error.field.as_str()),
        (ErrorCode::TooManyScenarios, "n")
    );
}

#[test]
fn parameters_outside_their_limits_name_the_field() {
    let scenario = scenario_of(&fixture("proforma_F1")["inputs"]);
    let run = |edit: &dyn Fn(&mut McParams)| {
        let mut params = default_params();
        edit(&mut params);
        Simulator::default()
            .run(&scenario, &params, 10, 1)
            .unwrap_err()
    };
    let error = run(&|p| p.kappa = 1.1);
    assert_eq!(
        (error.code, error.field.as_str()),
        (ErrorCode::OutOfRange, "params.kappa")
    );
    let error = run(&|p| p.sigma_app = 0.6);
    assert_eq!(
        (error.code, error.field.as_str()),
        (ErrorCode::OutOfRange, "params.sigma_app")
    );
    let error = run(&|p| p.sigma_rent = f64::NAN);
    assert_eq!(
        (error.code, error.field.as_str()),
        (ErrorCode::NotFinite, "params.sigma_rent")
    );
    let error = run(&|p| p.corr[0][1] = 0.9);
    assert_eq!(
        (error.code, error.field.as_str()),
        (ErrorCode::BadCorrelation, "params.corr")
    );
}

#[test]
#[ignore = "timing; run with --release -- --ignored --nocapture"]
fn timing_of_10000_scenarios_over_10_and_30_years_on_f1_fixed_and_f2_mixed() {
    const RUNS: usize = 7;
    let params = default_params();
    for (case, loan) in [
        ("F1 fixed loan", "proforma_F1"),
        ("F2 mixed loan", "proforma_F2"),
    ] {
        for years in [10, 30] {
            let mut inputs = fixture(loan)["inputs"].clone();
            inputs["years"] = json!(years);
            let scenario = scenario_of(&inputs);
            let mut simulator = Simulator::default();
            simulator.run(&scenario, &params, 10_000, 42).unwrap();
            let mut times: Vec<_> = (0..RUNS)
                .map(|_| {
                    let start = std::time::Instant::now();
                    simulator.run(&scenario, &params, 10_000, 42).unwrap();
                    start.elapsed()
                })
                .collect();
            times.sort();
            println!(
                "{case}, 10 000 scenarios x {years} years: median {:?}, min {:?} of {RUNS} runs",
                times[RUNS / 2],
                times[0]
            );
        }
    }
}

#[test]
fn a_not_finite_number_anywhere_in_a_result_is_not_finite_at_result() {
    let scenario = scenario_of(&fixture("proforma_F1")["inputs"]);
    let clean = simulate(&scenario, &default_params(), 100, 3);
    clean.check_finite().unwrap();

    let poisoned: [fn(&mut McResult); 5] = [
        |r| r.npv_p[1] = f64::NAN,
        |r| r.p_npv_negative = f64::INFINITY,
        |r| r.cum_p_by_year[2][0] = f64::NAN,
        |r| r.npv_histogram.edges[4] = f64::NEG_INFINITY,
        |r| r.irr_p = Some([IrrPoint::Below, IrrPoint::Rate(f64::NAN), IrrPoint::Above]),
    ];
    for poison in poisoned {
        let mut result = clean.clone();
        poison(&mut result);
        let error = result.check_finite().unwrap_err();
        assert_eq!(error.code, ErrorCode::NotFinite);
        assert_eq!(error.field, "result");
    }
}

fn ordered(values: &[f64]) -> bool {
    values.windows(2).all(|pair| pair[0] <= pair[1])
}

fn irr_value(point: IrrPoint) -> f64 {
    match point {
        IrrPoint::Below => f64::NEG_INFINITY,
        IrrPoint::Rate(rate) => rate,
        IrrPoint::Above => f64::INFINITY,
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn percentiles_are_ordered_p10_p50_p90(seed in any::<u32>(), n in 50u32..300) {
        let scenario = scenario_of(&fixture("proforma_F1")["inputs"]);
        let result = simulate(&scenario, &default_params(), n, seed);
        prop_assert!(ordered(&result.npv_p));
        if let Some(irr_p) = result.irr_p {
            prop_assert!(ordered(&irr_p.map(irr_value)));
        }
        for row in &result.cum_p_by_year {
            prop_assert!(ordered(row));
        }
    }
}

#[test]
fn a_growth_draw_never_falls_below_minus_99_percent() {
    use invest_engine::montecarlo::growth_draw;
    // Rent growth of -50 % with a 50 % shock three deviations down would be -200 %.
    assert_eq!(growth_draw(-0.5, 0.5, -3.0), -0.99);
    assert_eq!(growth_draw(0.02, 0.02, 0.0), 0.02);
    assert!((growth_draw(0.02, 0.01, 1.5) - 0.035).abs() < 1e-15);
}
