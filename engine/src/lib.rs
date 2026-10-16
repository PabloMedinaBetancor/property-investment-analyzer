#![deny(unsafe_code)]
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

pub mod api;
pub mod correlation;
pub mod error;
#[cfg(target_arch = "wasm32")]
#[allow(unsafe_code)]
mod ffi;
pub mod income_tax;
pub mod inputs;
pub mod loan;
pub mod market;
pub mod metrics;
pub mod montecarlo;
pub mod proforma;
pub mod rng;
pub mod sensitivity;
