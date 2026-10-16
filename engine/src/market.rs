use std::sync::OnceLock;

use serde::{Deserialize, Deserializer, Serialize};

use crate::inputs::GenericPurchase;

#[derive(Debug, Clone, Deserialize)]
pub struct Bracket {
    pub from: f64,
    pub rate: f64,
}

/// A `Band` charges the whole base at the rate of the bracket it falls in; a `Progressive` one charges each slice.
#[derive(Debug, Clone)]
pub enum Schedule {
    Flat(f64),
    Progressive(Vec<Bracket>),
    Band(Vec<Bracket>),
}

impl Schedule {
    pub fn tax(&self, base: f64) -> f64 {
        if base <= 0.0 {
            return 0.0;
        }
        match self {
            Schedule::Flat(rate) => base * rate,
            Schedule::Band(brackets) => brackets
                .iter()
                .rev()
                .find(|b| b.from <= base)
                .map_or(0.0, |b| base * b.rate),
            Schedule::Progressive(brackets) => {
                let mut tax = 0.0;
                for (k, b) in brackets.iter().enumerate() {
                    let upper = brackets.get(k + 1).map_or(f64::INFINITY, |next| next.from);
                    if base > b.from {
                        tax += (base.min(upper) - b.from) * b.rate;
                    }
                }
                tax
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ScheduleWire {
    Flat { rate: f64 },
    Progressive { brackets: Vec<Bracket> },
    Band { brackets: Vec<Bracket> },
}

impl From<ScheduleWire> for Schedule {
    fn from(wire: ScheduleWire) -> Schedule {
        match wire {
            ScheduleWire::Flat { rate } => Schedule::Flat(rate),
            ScheduleWire::Progressive { brackets } => Schedule::Progressive(brackets),
            ScheduleWire::Band { brackets } => Schedule::Band(brackets),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct FeeBracket {
    pub from: f64,
    pub per_mille: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FeeScale {
    pub base_fee: f64,
    pub brackets: Vec<FeeBracket>,
    pub cap_base: Option<f64>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    #[serde(default)]
    pub rebate: f64,
}

impl FeeScale {
    /// The «derechos» of the official scale, before the minimum, maximum, rebate and VAT.
    pub fn scale(&self, base: f64) -> f64 {
        let base = base.min(self.cap_base.unwrap_or(f64::INFINITY));
        let mut fee = self.base_fee;
        for (k, b) in self.brackets.iter().enumerate() {
            let upper = self
                .brackets
                .get(k + 1)
                .map_or(f64::INFINITY, |next| next.from);
            if base > b.from {
                fee += (base.min(upper) - b.from) * b.per_mille / 1000.0;
            }
        }
        fee
    }
}

/// `new_build_vat` is `None` where the data gives no rate (Ceuta and Melilla charge IPSI, which the user enters).
#[derive(Debug, Clone)]
pub struct Region {
    pub code: String,
    pub resale: Schedule,
    pub new_build_vat: Option<f64>,
    pub new_build_stamp: f64,
}

#[derive(Debug, Clone)]
pub struct SpainData {
    pub regions: Vec<Region>,
    pub new_build_vat_default: f64,
    pub fee_vat: f64,
    pub notary: FeeScale,
    pub registry: FeeScale,
    pub capital_gains: Schedule,
}

#[derive(Deserialize)]
struct RegionWire {
    code: String,
    resale: ScheduleWire,
    #[serde(default, deserialize_with = "present")]
    new_build_vat: Option<Option<f64>>,
    new_build_stamp: f64,
}

// Tells a missing key (the national default applies) from an explicit null (no rate).
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<f64>>, D::Error> {
    Option::<f64>::deserialize(d).map(Some)
}

#[derive(Deserialize)]
struct Rate {
    rate: f64,
}

#[derive(Deserialize)]
struct FeesWire {
    fee_vat: Rate,
    notary_purchase: FeeScale,
    registry_purchase: FeeScale,
}

#[derive(Deserialize)]
struct IncomeTaxWire {
    capital_gains_scale: ScheduleWire,
}

#[derive(Deserialize)]
struct SpainWire {
    regions: Vec<RegionWire>,
    new_build_vat_default: Rate,
    fees: FeesWire,
    income_tax: IncomeTaxWire,
}

impl From<SpainWire> for SpainData {
    fn from(wire: SpainWire) -> SpainData {
        let default_vat = wire.new_build_vat_default.rate;
        let regions = wire
            .regions
            .into_iter()
            .map(|r| Region {
                code: r.code,
                resale: r.resale.into(),
                new_build_vat: r.new_build_vat.unwrap_or(Some(default_vat)),
                new_build_stamp: r.new_build_stamp,
            })
            .collect();
        SpainData {
            regions,
            new_build_vat_default: default_vat,
            fee_vat: wire.fees.fee_vat.rate,
            notary: wire.fees.notary_purchase,
            registry: wire.fees.registry_purchase,
            capital_gains: wire.income_tax.capital_gains_scale.into(),
        }
    }
}

#[allow(
    clippy::expect_used,
    reason = "the file is compiled in and tests/market.rs parses it"
)]
pub fn spain() -> &'static SpainData {
    static DATA: OnceLock<SpainData> = OnceLock::new();
    DATA.get_or_init(|| {
        let wire: SpainWire = serde_json::from_str(include_str!("../../data/es-2026.json"))
            .expect("data/es-2026.json is valid");
        wire.into()
    })
}

#[derive(Debug, Clone)]
pub enum Market {
    Spain {
        region: &'static Region,
        new_build: bool,
        reference_value: Option<f64>,
        manual_transfer_rate: Option<f64>,
        notary_extras: f64,
        gestoria: f64,
        buyer_agency_rate: f64,
    },
    Generic(GenericPurchase),
}

#[derive(Debug, Clone, Serialize)]
pub struct Acquisition {
    pub transfer_tax: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notary: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<f64>,
    pub acq_costs: f64,
    pub loan: f64,
    pub total_investment: f64,
    pub equity0: f64,
}

struct Purchase {
    transfer_tax: f64,
    notary: Option<f64>,
    registry: Option<f64>,
    acq_costs: f64,
}

fn purchase(market: &Market, price: f64) -> Purchase {
    match market {
        Market::Generic(g) => {
            let transfer_tax = g.transfer_tax_rate * price;
            let acq_costs = transfer_tax
                + g.closing_cost_rate * price
                + g.closing_cost_fixed
                + g.buyer_agency_rate * price;
            Purchase {
                transfer_tax,
                notary: None,
                registry: None,
                acq_costs,
            }
        }
        Market::Spain {
            region,
            new_build,
            reference_value,
            manual_transfer_rate,
            notary_extras,
            gestoria,
            buyer_agency_rate,
        } => {
            // The transfer tax and stamp duty are charged on the greater of the price and the
            // administration's reference value; VAT / IGIC on a new build is charged on the price.
            let taxable = price.max(reference_value.unwrap_or(0.0));
            let transfer_tax = match manual_transfer_rate {
                // A typed rate on a new build stands in for VAT / IGIC / IPSI, which are charged on the price.
                Some(rate) if *new_build => rate * price,
                Some(rate) => rate * taxable,
                None if *new_build => {
                    let vat = region
                        .new_build_vat
                        .unwrap_or(spain().new_build_vat_default);
                    price * vat + taxable * region.new_build_stamp
                }
                None => region.resale.tax(taxable),
            };
            let notary = notary_fee(price, *notary_extras);
            let registry = registry_fee(price);
            let fees = notary + registry + gestoria + buyer_agency_rate * price;
            Purchase {
                transfer_tax,
                notary: Some(notary),
                registry: Some(registry),
                acq_costs: transfer_tax + fees,
            }
        }
    }
}

pub fn acquisition(
    market: &Market,
    price: f64,
    renovation: f64,
    ltv: f64,
    loan_fees: f64,
) -> Acquisition {
    let p = purchase(market, price);
    let loan = ltv * price;
    let total_investment = price + p.acq_costs + renovation;
    // No loan, no arrangement or valuation fees.
    let loan_fees = if ltv > 0.0 { loan_fees } else { 0.0 };
    Acquisition {
        transfer_tax: p.transfer_tax,
        notary: p.notary,
        registry: p.registry,
        acq_costs: p.acq_costs,
        loan,
        total_investment,
        equity0: total_investment + loan_fees - loan,
    }
}

/// `(scale + extras) * (1 + VAT)`.
pub fn notary_fee(price: f64, extras: f64) -> f64 {
    let data = spain();
    (data.notary.scale(price) + extras) * (1.0 + data.fee_vat)
}

/// `clamp(scale, min, max) * (1 - rebate) * (1 + VAT)`.
pub fn registry_fee(price: f64) -> f64 {
    let data = spain();
    let scale = &data.registry;
    let fee = scale
        .scale(price)
        .max(scale.min.unwrap_or(f64::NEG_INFINITY))
        .min(scale.max.unwrap_or(f64::INFINITY));
    fee * (1.0 - scale.rebate) * (1.0 + data.fee_vat)
}
