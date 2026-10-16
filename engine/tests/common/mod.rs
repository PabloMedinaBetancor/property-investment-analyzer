// Each test binary uses a part of this module.
#![allow(dead_code)]

use serde_json::Value;

pub fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/../tests/fixtures/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path} is not JSON: {e}"))
}

/// Walks `expected`: every key must exist in `actual`, arrays have the same length, and numbers agree within
/// `1e-9 * max(1, |a|, |b|)`. The strings "inf" and "-inf" stand for the infinities.
pub fn assert_json_close(expected: &Value, actual: &Value) {
    close_at("$", expected, actual);
}

fn as_number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) if s == "inf" => Some(f64::INFINITY),
        Value::String(s) if s == "-inf" => Some(f64::NEG_INFINITY),
        _ => None,
    }
}

fn numbers_close(a: f64, b: f64) -> bool {
    if a.is_infinite() || b.is_infinite() {
        return a == b;
    }
    (a - b).abs() <= 1e-9 * 1.0_f64.max(a.abs()).max(b.abs())
}

fn close_at(path: &str, expected: &Value, actual: &Value) {
    if let (Some(a), Some(b)) = (as_number(expected), as_number(actual)) {
        assert!(numbers_close(a, b), "{path}: expected {a}, got {b}");
        return;
    }
    match (expected, actual) {
        (Value::Object(e), Value::Object(a)) => {
            for (key, value) in e {
                let found = a
                    .get(key)
                    .unwrap_or_else(|| panic!("{path}: missing key `{key}`"));
                close_at(&format!("{path}.{key}"), value, found);
            }
        }
        (Value::Array(e), Value::Array(a)) => {
            assert_eq!(e.len(), a.len(), "{path}: array length");
            for (i, (value, found)) in e.iter().zip(a).enumerate() {
                close_at(&format!("{path}[{i}]"), value, found);
            }
        }
        _ => assert_eq!(expected, actual, "{path}"),
    }
}
