mod common;

use common::fixture;
use invest_engine::correlation::Cholesky;
use invest_engine::error::ErrorCode;
use invest_engine::metrics::percentile7;
use invest_engine::rng::Rng;
use serde_json::Value;

fn numbers(value: &Value) -> Vec<f64> {
    value
        .as_array()
        .expect("array")
        .iter()
        .map(|v| match v.as_str() {
            Some("inf") => f64::INFINITY,
            Some("-inf") => f64::NEG_INFINITY,
            _ => v.as_f64().expect("number"),
        })
        .collect()
}

#[test]
fn seed_42_first_eight_outputs_match_the_reference_bit_for_bit() {
    let expected = numbers(&fixture("prng")["first_u32"]);
    let mut rng = Rng::new(42);
    for want in expected {
        assert_eq!(f64::from(rng.next_u32()), want);
    }
}

#[test]
fn seed_0_first_output_is_3809008728() {
    let want = numbers(&fixture("prng")["seed_0_first_u32"]);
    assert_eq!(f64::from(Rng::new(0).next_u32()), want[0]);
}

#[test]
fn seed_42_uniforms_match_the_reference_bit_for_bit() {
    let mut rng = Rng::new(42);
    for want in numbers(&fixture("prng")["first_uniforms"]) {
        assert_eq!(rng.uniform(), want);
    }
}

#[test]
fn seed_42_normals_match_the_reference_to_1e_12() {
    let mut rng = Rng::new(42);
    let want = numbers(&fixture("prng")["first_normals"]);
    for pair in want.chunks(2) {
        let (a, b) = rng.normal_pair();
        assert!((a - pair[0]).abs() < 1e-12, "{a} vs {}", pair[0]);
        assert!((b - pair[1]).abs() < 1e-12, "{b} vs {}", pair[1]);
    }
}

#[test]
fn uniforms_stay_in_the_half_open_unit_interval() {
    let mut rng = Rng::new(7);
    for _ in 0..100_000 {
        let u = rng.uniform();
        assert!((0.0..1.0).contains(&u));
    }
}

#[test]
fn percentile7_matches_every_reference_case() {
    for case in fixture("percentile_type7").as_array().expect("array") {
        let data = numbers(&case["data"]);
        let p = case["p"].as_f64().expect("p");
        let want = numbers(&Value::Array(vec![case["value"].clone()]))[0];
        let got = percentile7(&data, p);
        assert!(
            got == want || (got - want).abs() < 1e-12,
            "{data:?} at {p}: expected {want}, got {got}"
        );
    }
}

#[test]
fn percentile7_of_one_value_is_that_value() {
    assert_eq!(percentile7(&[5.0], 0.9), 5.0);
}

const DEFAULT_CORR: [[f64; 4]; 4] = [
    [1.0, 0.0, 0.0, 0.3],
    [0.0, 1.0, 0.5, 0.4],
    [0.0, 0.5, 1.0, 0.2],
    [0.3, 0.4, 0.2, 1.0],
];

fn factor_columns(corr: &[[f64; 4]; 4]) -> [[f64; 4]; 4] {
    let l = Cholesky::new(corr).expect("positive definite");
    let mut columns = [[0.0; 4]; 4];
    for (j, column) in columns.iter_mut().enumerate() {
        let mut unit = [0.0; 4];
        unit[j] = 1.0;
        *column = l.correlate(&unit);
    }
    columns
}

#[test]
fn cholesky_of_the_default_matrix_rebuilds_it_to_1e_15() {
    let columns = factor_columns(&DEFAULT_CORR);
    for i in 0..4 {
        for j in 0..4 {
            let rebuilt: f64 = (0..4).map(|k| columns[k][i] * columns[k][j]).sum();
            assert!(
                (rebuilt - DEFAULT_CORR[i][j]).abs() < 1e-15,
                "({i},{j}) gives {rebuilt}"
            );
        }
    }
}

#[test]
fn correlate_keeps_the_first_shock_and_mixes_the_last_one_by_0_3() {
    let l = Cholesky::new(&DEFAULT_CORR).expect("positive definite");
    assert_eq!(l.correlate(&[1.0, 0.0, 0.0, 0.0]), [1.0, 0.0, 0.0, 0.3]);
}

fn rejected(corr: &[[f64; 4]; 4]) -> ErrorCode {
    Cholesky::new(corr).expect_err("must be rejected").code
}

#[test]
fn a_matrix_that_is_not_positive_definite_is_bad_correlation() {
    let mut corr = DEFAULT_CORR;
    corr[0][1] = 0.9;
    corr[1][0] = 0.9;
    corr[0][2] = 0.9;
    corr[2][0] = 0.9;
    corr[1][2] = -0.9;
    corr[2][1] = -0.9;
    assert_eq!(rejected(&corr), ErrorCode::BadCorrelation);
}

#[test]
fn an_asymmetric_matrix_is_bad_correlation() {
    let mut corr = DEFAULT_CORR;
    corr[1][3] = 0.41;
    assert_eq!(rejected(&corr), ErrorCode::BadCorrelation);
}

#[test]
fn a_diagonal_other_than_one_is_bad_correlation() {
    let mut corr = DEFAULT_CORR;
    corr[2][2] = 1.1;
    assert_eq!(rejected(&corr), ErrorCode::BadCorrelation);
}

#[test]
fn an_entry_above_one_is_bad_correlation() {
    let mut corr = DEFAULT_CORR;
    corr[0][3] = 1.2;
    corr[3][0] = 1.2;
    assert_eq!(rejected(&corr), ErrorCode::BadCorrelation);
}

#[test]
fn the_identity_leaves_the_shocks_alone() {
    let mut identity = [[0.0; 4]; 4];
    for (i, row) in identity.iter_mut().enumerate() {
        row[i] = 1.0;
    }
    let l = Cholesky::new(&identity).expect("identity");
    assert_eq!(l.correlate(&[0.5, -1.0, 2.0, 0.25]), [0.5, -1.0, 2.0, 0.25]);
}
