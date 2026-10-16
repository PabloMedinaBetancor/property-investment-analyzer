use std::cell::RefCell;

use serde::{Deserialize, Serialize};

use crate::error::InputError;
use crate::inputs::{Inputs, parse};
use crate::montecarlo::{McRequest, Simulator};
use crate::proforma;
use crate::sensitivity as tornado;

thread_local! {
    // Kept between calls so the Monte Carlo buffers are allocated once.
    static SIMULATOR: RefCell<Simulator> = RefCell::new(Simulator::default());
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SensitivityRequest {
    inputs: Inputs,
}

#[derive(Serialize)]
struct Success<'a, T> {
    ok: bool,
    value: &'a T,
}

#[derive(Serialize)]
struct Failure<'a> {
    ok: bool,
    error: &'a InputError,
}

// Only reachable if the serializer itself fails, which plain structs and finite numbers cannot do.
const UNWRITABLE: &[u8] = br#"{"ok":false,"error":{"code":"not_finite","field":"result","message":"the result could not be written"}}"#;

fn envelope<T: Serialize>(result: Result<T, InputError>) -> Vec<u8> {
    let bytes = match &result {
        Ok(value) => serde_json::to_vec(&Success { ok: true, value }),
        Err(error) => serde_json::to_vec(&Failure { ok: false, error }),
    };
    bytes.unwrap_or_else(|_| UNWRITABLE.to_vec())
}

pub fn analyze(bytes: &[u8]) -> Vec<u8> {
    envelope(run_analyze(bytes))
}

fn run_analyze(bytes: &[u8]) -> Result<proforma::Analysis, InputError> {
    let scenario = parse::<Inputs>(bytes)?.resolve()?;
    let analysis = proforma::analyze(&scenario);
    analysis.check_finite()?;
    Ok(analysis)
}

pub fn simulate(bytes: &[u8]) -> Vec<u8> {
    envelope(run_simulate(bytes))
}

fn run_simulate(bytes: &[u8]) -> Result<crate::montecarlo::McResult, InputError> {
    let request = parse::<McRequest>(bytes)?;
    let scenario = request.inputs.resolve()?;
    let result = SIMULATOR.with_borrow_mut(|simulator| {
        simulator.run(&scenario, &request.params, request.n, request.seed)
    })?;
    result.check_finite()?;
    Ok(result)
}

pub fn sensitivity(bytes: &[u8]) -> Vec<u8> {
    envelope(parse::<SensitivityRequest>(bytes).and_then(|r| tornado::sensitivity(&r.inputs)))
}
