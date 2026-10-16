use invest_engine::api;
use serde_json::{Value, json};

mod common;

const ERROR_CODES: [&str; 7] = [
    "invalid_json",
    "missing_field",
    "not_finite",
    "out_of_range",
    "unknown_region",
    "bad_correlation",
    "too_many_scenarios",
];

fn f1_inputs() -> Value {
    common::fixture("proforma_F1")["inputs"].clone()
}

fn envelope(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).expect("every call returns JSON")
}

fn assert_error(bytes: &[u8], code: &str, field: &str) {
    let out = envelope(bytes);
    assert_eq!(out["ok"], json!(false), "{out}");
    assert_eq!(out["error"]["code"], json!(code), "{out}");
    assert_eq!(out["error"]["field"], json!(field), "{out}");
    assert!(
        out["error"]["message"]
            .as_str()
            .is_some_and(|m| !m.is_empty())
    );
}

fn simulate_request(n: u64) -> Value {
    let params = common::fixture("monte_carlo_F2_n2000_seed42")["params"].clone();
    let inputs = common::fixture("proforma_F2")["inputs"].clone();
    json!({ "inputs": inputs, "params": params, "n": n, "seed": 42 })
}

#[test]
fn analyze_of_f1_is_an_ok_envelope_that_carries_the_reference_result() {
    let bytes = serde_json::to_vec(&f1_inputs()).unwrap();
    let out = envelope(&api::analyze(&bytes));
    assert_eq!(out["ok"], json!(true));
    common::assert_json_close(&common::fixture("proforma_F1")["result"], &out["value"]);
    assert!(
        out["value"]["schedule"]
            .as_array()
            .is_some_and(|s| s.len() == 120)
    );
}

#[test]
fn a_missing_price_is_missing_field_price() {
    let mut inputs = f1_inputs();
    inputs.as_object_mut().unwrap().remove("price");
    assert_error(
        &api::analyze(&serde_json::to_vec(&inputs).unwrap()),
        "missing_field",
        "price",
    );
}

#[test]
fn a_null_number_is_not_finite_at_its_path() {
    let mut inputs = f1_inputs();
    inputs["loan"]["fixed_rate"] = Value::Null;
    assert_error(
        &api::analyze(&serde_json::to_vec(&inputs).unwrap()),
        "not_finite",
        "loan.fixed_rate",
    );
}

#[test]
fn an_unknown_field_is_invalid_json() {
    let mut inputs = f1_inputs();
    inputs["pricee"] = json!(1);
    let out = envelope(&api::analyze(&serde_json::to_vec(&inputs).unwrap()));
    assert_eq!(out["error"]["code"], json!("invalid_json"), "{out}");
}

#[test]
fn broken_json_is_invalid_json_for_the_whole_document() {
    assert_error(&api::analyze(b"{\"price\": 18"), "invalid_json", "");
    assert_error(&api::simulate(b""), "invalid_json", "");
    assert_error(&api::sensitivity(b"{"), "invalid_json", "");
}

#[test]
fn a_price_of_zero_is_out_of_range() {
    let mut inputs = f1_inputs();
    inputs["price"] = json!(0);
    assert_error(
        &api::analyze(&serde_json::to_vec(&inputs).unwrap()),
        "out_of_range",
        "price",
    );
}

#[test]
fn simulate_with_200_000_scenarios_is_too_many_scenarios() {
    let bytes = serde_json::to_vec(&simulate_request(200_000)).unwrap();
    assert_error(&api::simulate(&bytes), "too_many_scenarios", "n");
}

#[test]
fn simulate_with_no_scenarios_is_out_of_range() {
    let bytes = serde_json::to_vec(&simulate_request(0)).unwrap();
    assert_error(&api::simulate(&bytes), "out_of_range", "n");
}

#[test]
fn simulate_of_f2_matches_the_reference_and_the_committed_bytes() {
    let bytes = serde_json::to_vec(&simulate_request(2000)).unwrap();
    let out = api::simulate(&bytes);
    let parsed = envelope(&out);
    assert_eq!(parsed["ok"], json!(true), "{parsed}");
    let mut expected = common::fixture("monte_carlo_F2_n2000_seed42");
    for echoed in ["params", "n", "seed"] {
        expected.as_object_mut().unwrap().remove(echoed);
    }
    common::assert_json_close(&expected, &parsed["value"]);
    let golden = std::fs::read(format!(
        "{}/tests/golden/simulate_F2_n2000_seed42.json",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("golden file");
    assert_eq!(out, golden);
}

#[test]
fn sensitivity_of_f1_returns_the_seven_bars_of_the_reference() {
    let expected = common::fixture("sensitivity_F1");
    let bytes = serde_json::to_vec(&json!({ "inputs": expected["inputs"] })).unwrap();
    let out = envelope(&api::sensitivity(&bytes));
    assert_eq!(out["ok"], json!(true), "{out}");
    assert_eq!(out["value"]["bars"].as_array().map(Vec::len), Some(7));
}

#[test]
fn sensitivity_rejects_inputs_that_are_not_wrapped() {
    let bytes = serde_json::to_vec(&f1_inputs()).unwrap();
    let out = envelope(&api::sensitivity(&bytes));
    assert_eq!(out["ok"], json!(false));
}

struct Lcg(u64);

impl Lcg {
    fn next(&mut self, bound: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 33) as usize) % bound
    }
}

fn paths(value: &Value, prefix: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                prefix.push(key.clone());
                out.push(prefix.clone());
                paths(child, prefix, out);
                prefix.pop();
            }
        }
        Value::Array(items) => {
            for (i, child) in items.iter().enumerate() {
                prefix.push(i.to_string());
                out.push(prefix.clone());
                paths(child, prefix, out);
                prefix.pop();
            }
        }
        _ => {}
    }
}

// A path may no longer exist once an earlier mutation of the same document replaced one of its parents.
fn slot<'a>(root: &'a mut Value, path: &[String]) -> Option<&'a mut Value> {
    let mut node = root;
    for step in path {
        node = match node {
            Value::Array(items) => items.get_mut(step.parse::<usize>().ok()?)?,
            Value::Object(map) => map.get_mut(step)?,
            _ => return None,
        };
    }
    Some(node)
}

fn mutate(base: &Value, rng: &mut Lcg, targets: &[Vec<String>]) -> Value {
    let mut doc = base.clone();
    for _ in 0..1 + rng.next(3) {
        let path = &targets[rng.next(targets.len())];
        let (parent, last) = path.split_at(path.len() - 1);
        if rng.next(5) == 0
            && let Some(Value::Object(map)) = slot(&mut doc, parent)
        {
            map.remove(&last[0]);
            continue;
        }
        let Some(node) = slot(&mut doc, path) else {
            continue;
        };
        *node = match (rng.next(7), &*node) {
            (0, Value::Number(n)) => json!(n.as_f64().unwrap_or(0.0) * 1e12),
            (1, Value::Number(n)) => json!(-n.as_f64().unwrap_or(0.0)),
            (2, _) => Value::Null,
            (3, _) => json!("text"),
            (4, _) => json!(true),
            (5, _) => json!([1, 2, 3]),
            (_, Value::Number(_)) => json!([-1.0, 0.0, 1e300, 1e-300][rng.next(4)]),
            _ => json!({}),
        };
    }
    doc
}

#[test]
fn two_thousand_mutations_of_f1_always_return_an_envelope() {
    let base = f1_inputs();
    let mut targets = Vec::new();
    paths(&base, &mut Vec::new(), &mut targets);
    let mut rng = Lcg(2026);
    for _ in 0..2000 {
        let doc = mutate(&base, &mut rng, &targets);
        let out = envelope(&api::analyze(&serde_json::to_vec(&doc).unwrap()));
        match out["ok"].as_bool() {
            Some(true) => assert!(out["value"]["metrics"].is_object()),
            Some(false) => {
                let code = out["error"]["code"].as_str().unwrap();
                assert!(ERROR_CODES.contains(&code), "{code}");
            }
            None => panic!("no ok flag: {out}"),
        }
    }
}

#[test]
fn truncating_f1_at_any_byte_returns_an_error_envelope() {
    let bytes = serde_json::to_vec(&f1_inputs()).unwrap();
    for cut in 0..bytes.len() {
        let out = envelope(&api::analyze(&bytes[..cut]));
        assert_eq!(out["ok"], json!(false), "cut at {cut}");
    }
}

#[test]
fn a_fixed_rate_of_1e_17_analyses_like_a_rate_of_zero() {
    let analysed = |rate: f64| {
        let mut inputs = f1_inputs();
        inputs["loan"]["fixed_rate"] = json!(rate);
        envelope(&api::analyze(&serde_json::to_vec(&inputs).unwrap()))
    };
    let tiny = analysed(1e-17);
    assert_eq!(tiny["ok"], json!(true), "{tiny}");
    common::assert_json_close(&analysed(0.0)["value"], &tiny["value"]);
}
