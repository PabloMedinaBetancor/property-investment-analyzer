use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::error::{ErrorCode, InputError};
use crate::income_tax::{GenericTax, SpainTax, TaxRules};
use crate::loan::{Loan, LoanRate};
use crate::market::{self, Market};
use crate::proforma::{MAX_YEARS, Scenario};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    #[default]
    Es,
    Generic,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inputs {
    pub name: Option<String>,
    pub currency: Option<String>,
    #[serde(default)]
    pub profile: Profile,
    pub region: Option<String>,
    pub new_build: Option<bool>,
    pub reference_value: Option<f64>,
    pub manual_transfer_rate: Option<f64>,
    pub notary_extras: Option<f64>,
    pub gestoria: Option<f64>,
    pub buyer_agency_rate: Option<f64>,
    pub purchase: Option<GenericPurchase>,
    #[serde(default)]
    pub property_tax_rate: f64,
    pub price: f64,
    pub renovation: f64,
    pub loan_fees: f64,
    pub ltv: f64,
    pub loan: LoanInput,
    pub rent_month: f64,
    pub vacancy: f64,
    pub ibi: f64,
    pub community: f64,
    pub insurance: f64,
    pub other_fixed: f64,
    pub maintenance_rate: f64,
    pub management_rate: f64,
    pub g_rent: f64,
    pub g_exp: f64,
    pub g_app: f64,
    pub years: u32,
    pub sell_rate: f64,
    pub municipal_gain_tax: f64,
    pub discount_rate: f64,
    pub value0: Option<f64>,
    pub tax: TaxInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(try_from = "RawLoan")]
pub enum LoanInput {
    Fixed {
        fixed_rate: f64,
        term_years: u32,
    },
    Variable {
        spread: f64,
        index: f64,
        index_path: Vec<f64>,
        term_years: u32,
    },
    Mixed {
        fixed_rate: f64,
        fixed_years: u32,
        spread: f64,
        index: f64,
        index_path: Vec<f64>,
        term_years: u32,
    },
}

/// A tagged enum is buffered by serde, which loses the JSON path of an error inside it; this flat mirror keeps it.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum LoanKind {
    Fixed,
    Variable,
    Mixed,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLoan {
    kind: LoanKind,
    #[serde(default, deserialize_with = "present")]
    fixed_rate: Option<f64>,
    #[serde(default, deserialize_with = "present")]
    fixed_years: Option<u32>,
    #[serde(default, deserialize_with = "present")]
    spread: Option<f64>,
    #[serde(default, deserialize_with = "present")]
    index: Option<f64>,
    #[serde(default, deserialize_with = "present")]
    index_path: Option<Vec<f64>>,
    #[serde(default, deserialize_with = "present")]
    term_years: Option<u32>,
}

/// Like `Option<T>`, but a `null` is an error: it is how `JSON.stringify` writes NaN.
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}

impl TryFrom<RawLoan> for LoanInput {
    type Error = String;

    fn try_from(raw: RawLoan) -> Result<LoanInput, String> {
        let need =
            |name: &str, value: Option<f64>| value.ok_or_else(|| format!("missing field `{name}`"));
        let term =
            |value: Option<u32>| value.ok_or_else(|| "missing field `term_years`".to_owned());
        let reject = |name: &str, present: bool| {
            if present {
                Err(format!("unknown field `{name}` for this loan kind"))
            } else {
                Ok(())
            }
        };
        match raw.kind {
            LoanKind::Fixed => {
                let (fixed_rate, term_years) =
                    (need("fixed_rate", raw.fixed_rate)?, term(raw.term_years)?);
                reject("fixed_years", raw.fixed_years.is_some())?;
                reject("spread", raw.spread.is_some())?;
                reject("index", raw.index.is_some())?;
                reject("index_path", raw.index_path.is_some())?;
                Ok(LoanInput::Fixed {
                    fixed_rate,
                    term_years,
                })
            }
            LoanKind::Variable => {
                let (spread, index) = (need("spread", raw.spread)?, need("index", raw.index)?);
                let term_years = term(raw.term_years)?;
                reject("fixed_rate", raw.fixed_rate.is_some())?;
                reject("fixed_years", raw.fixed_years.is_some())?;
                let index_path = raw.index_path.unwrap_or_default();
                Ok(LoanInput::Variable {
                    spread,
                    index,
                    index_path,
                    term_years,
                })
            }
            LoanKind::Mixed => {
                let fixed_rate = need("fixed_rate", raw.fixed_rate)?;
                let fixed_years = raw.fixed_years.ok_or("missing field `fixed_years`")?;
                let (spread, index) = (need("spread", raw.spread)?, need("index", raw.index)?);
                let term_years = term(raw.term_years)?;
                let index_path = raw.index_path.unwrap_or_default();
                Ok(LoanInput::Mixed {
                    fixed_rate,
                    fixed_years,
                    spread,
                    index,
                    index_path,
                    term_years,
                })
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxInput {
    pub on: bool,
    pub marginal: Option<f64>,
    pub reduction: Option<f64>,
    pub construction_share: Option<f64>,
    pub offset_other_income: Option<bool>,
    pub rate: Option<f64>,
    pub interest_deductible: Option<bool>,
    pub depreciation_years: Option<f64>,
    pub building_share: Option<f64>,
    pub offset_losses: Option<bool>,
    pub capital_gains_rate: Option<f64>,
    pub depreciation_recapture_rate: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenericPurchase {
    pub transfer_tax_rate: f64,
    pub closing_cost_rate: f64,
    pub closing_cost_fixed: f64,
    pub buyer_agency_rate: f64,
}

const MAX_YEARS_U32: u32 = MAX_YEARS as u32;

impl Inputs {
    /// Checks the limits of the validation table in its order, stopping at the first failure, then computes the
    /// acquisition.
    pub fn resolve(&self) -> Result<Scenario, InputError> {
        self.check_amounts()?;
        let loan = self.resolve_loan()?;
        self.check_operations()?;
        let market = self.market()?;
        let acquisition = market::acquisition(
            &market,
            self.price,
            self.renovation,
            self.ltv,
            self.loan_fees,
        );
        let basis = self.price + acquisition.acq_costs + self.renovation;
        let tax = self.resolve_tax(basis)?;
        let (index0, index_path) = match (&loan, &self.loan) {
            (
                Some(_),
                LoanInput::Variable {
                    index, index_path, ..
                },
            )
            | (
                Some(_),
                LoanInput::Mixed {
                    index, index_path, ..
                },
            ) => (*index, index_path.clone()),
            _ => (0.0, Vec::new()),
        };
        Ok(Scenario {
            years: self.years as usize,
            price: self.price,
            renovation: self.renovation,
            acquisition,
            loan,
            index0,
            index_path,
            rent_month: self.rent_month,
            vacancy: self.vacancy,
            fixed_costs: self.ibi + self.community + self.insurance + self.other_fixed,
            property_tax_rate: self.property_tax_rate,
            maintenance_rate: self.maintenance_rate,
            management_rate: self.management_rate,
            g_rent: self.g_rent,
            g_exp: self.g_exp,
            g_app: self.g_app,
            value0: self.value0.unwrap_or(self.price),
            sell_rate: self.sell_rate,
            municipal_gain_tax: self.municipal_gain_tax,
            discount_rate: self.discount_rate,
            basis,
            tax,
        })
    }

    fn check_amounts(&self) -> Result<(), InputError> {
        above_zero("price", self.price, 1e9)?;
        let spanish = self.profile == Profile::Es;
        let amounts = [
            ("renovation", Some(self.renovation)),
            ("loan_fees", Some(self.loan_fees)),
            ("ibi", Some(self.ibi)),
            ("community", Some(self.community)),
            ("insurance", Some(self.insurance)),
            ("other_fixed", Some(self.other_fixed)),
            ("municipal_gain_tax", Some(self.municipal_gain_tax)),
            ("notary_extras", self.notary_extras.filter(|_| spanish)),
            ("gestoria", self.gestoria.filter(|_| spanish)),
            (
                "purchase.closing_cost_fixed",
                self.purchase
                    .as_ref()
                    .filter(|_| !spanish)
                    .map(|p| p.closing_cost_fixed),
            ),
        ];
        for (field, value) in amounts {
            if let Some(value) = value {
                within(field, value, 0.0, 1e8)?;
            }
        }
        if let Some(value) = self.reference_value.filter(|_| spanish) {
            within("reference_value", value, 0.0, 1e9)?;
        }
        if let Some(value) = self.value0 {
            above_zero("value0", value, 1e10)?;
        }
        Ok(())
    }

    /// Returns `None` without a loan (`ltv = 0`): its fields are then ignored.
    fn resolve_loan(&self) -> Result<Option<Loan>, InputError> {
        within("ltv", self.ltv, 0.0, 1.0)?;
        if self.ltv == 0.0 {
            return Ok(None);
        }
        let principal = self.ltv * self.price;
        let (rate, term_years) = match &self.loan {
            LoanInput::Fixed {
                fixed_rate,
                term_years,
            } => {
                check_term(*term_years)?;
                within("loan.fixed_rate", *fixed_rate, 0.0, 0.3)?;
                (LoanRate::Fixed(*fixed_rate), *term_years)
            }
            LoanInput::Variable {
                spread,
                index,
                index_path,
                term_years,
            } => {
                check_term(*term_years)?;
                check_index_terms(*spread, *index, index_path)?;
                (LoanRate::Variable { spread: *spread }, *term_years)
            }
            LoanInput::Mixed {
                fixed_rate,
                fixed_years,
                spread,
                index,
                index_path,
                term_years,
            } => {
                check_term(*term_years)?;
                within("loan.fixed_rate", *fixed_rate, 0.0, 0.3)?;
                check_index_terms(*spread, *index, index_path)?;
                within(
                    "loan.fixed_years",
                    f64::from(*fixed_years),
                    0.0,
                    f64::from(*term_years),
                )?;
                let rate = LoanRate::Mixed {
                    fixed_rate: *fixed_rate,
                    fixed_years: *fixed_years as usize,
                    spread: *spread,
                };
                (rate, *term_years)
            }
        };
        Ok(Some(Loan {
            principal,
            term_years: term_years as usize,
            rate,
        }))
    }

    fn check_operations(&self) -> Result<(), InputError> {
        above_zero("rent_month", self.rent_month, 1e7)?;
        within("vacancy", self.vacancy, 0.0, 0.99)?;
        within("maintenance_rate", self.maintenance_rate, 0.0, 0.9)?;
        within("management_rate", self.management_rate, 0.0, 0.9)?;
        within("property_tax_rate", self.property_tax_rate, 0.0, 0.05)?;
        for (field, value) in [
            ("g_rent", self.g_rent),
            ("g_exp", self.g_exp),
            ("g_app", self.g_app),
        ] {
            within(field, value, -0.5, 0.5)?;
        }
        within("sell_rate", self.sell_rate, 0.0, 0.5)?;
        within("discount_rate", self.discount_rate, -0.5, 1.0)?;
        check_count("years", self.years, 1, MAX_YEARS_U32)
    }

    fn market(&self) -> Result<Market, InputError> {
        let spanish = self.profile == Profile::Es;
        if let Some(rate) = self.manual_transfer_rate.filter(|_| spanish) {
            within("manual_transfer_rate", rate, 0.0, 0.5)?;
        }
        if let Some(rate) = self.buyer_agency_rate.filter(|_| spanish) {
            within("buyer_agency_rate", rate, 0.0, 0.5)?;
        }
        if let Some(purchase) = self.purchase.as_ref().filter(|_| !spanish) {
            within(
                "purchase.transfer_tax_rate",
                purchase.transfer_tax_rate,
                0.0,
                0.5,
            )?;
            within(
                "purchase.closing_cost_rate",
                purchase.closing_cost_rate,
                0.0,
                0.5,
            )?;
            within(
                "purchase.buyer_agency_rate",
                purchase.buyer_agency_rate,
                0.0,
                0.5,
            )?;
        }
        match self.profile {
            Profile::Generic => Ok(Market::Generic(required(
                "purchase",
                self.purchase.clone(),
            )?)),
            Profile::Es => self.spanish_market(),
        }
    }

    fn spanish_market(&self) -> Result<Market, InputError> {
        let code = required("region", self.region.as_deref())?;
        let new_build = required("new_build", self.new_build)?;
        let notary_extras = required("notary_extras", self.notary_extras)?;
        let gestoria = required("gestoria", self.gestoria)?;
        let buyer_agency_rate = required("buyer_agency_rate", self.buyer_agency_rate)?;
        let region = market::spain()
            .regions
            .iter()
            .find(|region| region.code == code)
            .ok_or_else(|| {
                InputError::new(
                    ErrorCode::UnknownRegion,
                    "region",
                    format!("unknown region code `{code}`"),
                )
            })?;
        if new_build && region.new_build_vat.is_none() && self.manual_transfer_rate.is_none() {
            return Err(InputError::new(
                ErrorCode::MissingField,
                "manual_transfer_rate",
                "new builds in this region pay IPSI, so the transfer rate must be entered",
            ));
        }
        Ok(Market::Spain {
            region,
            new_build,
            reference_value: self.reference_value,
            manual_transfer_rate: self.manual_transfer_rate,
            notary_extras,
            gestoria,
            buyer_agency_rate,
        })
    }

    fn resolve_tax(&self, basis: f64) -> Result<TaxRules, InputError> {
        let tax = &self.tax;
        if !tax.on {
            return Ok(TaxRules::None);
        }
        match self.profile {
            Profile::Es => {
                let marginal = required("tax.marginal", tax.marginal)?;
                let reduction = required("tax.reduction", tax.reduction)?;
                let construction_share =
                    required("tax.construction_share", tax.construction_share)?;
                let offset_other_income =
                    required("tax.offset_other_income", tax.offset_other_income)?;
                within("tax.marginal", marginal, 0.0, 0.7)?;
                within("tax.reduction", reduction, 0.0, 1.0)?;
                within("tax.construction_share", construction_share, 0.0, 1.0)?;
                Ok(TaxRules::Spain(SpainTax {
                    marginal,
                    reduction,
                    offset_other_income,
                    amortisation_per_year: 0.03 * construction_share * basis,
                    amortisation_basis: construction_share * basis,
                    capital_gains: &market::spain().capital_gains,
                }))
            }
            Profile::Generic => {
                let rate = required("tax.rate", tax.rate)?;
                let interest_deductible =
                    required("tax.interest_deductible", tax.interest_deductible)?;
                let depreciation_years =
                    required("tax.depreciation_years", tax.depreciation_years)?;
                let building_share = required("tax.building_share", tax.building_share)?;
                let offset_losses = required("tax.offset_losses", tax.offset_losses)?;
                let capital_gains_rate =
                    required("tax.capital_gains_rate", tax.capital_gains_rate)?;
                let recapture_rate = required(
                    "tax.depreciation_recapture_rate",
                    tax.depreciation_recapture_rate,
                )?;
                within("tax.rate", rate, 0.0, 0.7)?;
                within("tax.capital_gains_rate", capital_gains_rate, 0.0, 0.7)?;
                within("tax.depreciation_recapture_rate", recapture_rate, 0.0, 0.7)?;
                within("tax.building_share", building_share, 0.0, 1.0)?;
                if depreciation_years != 0.0 {
                    within("tax.depreciation_years", depreciation_years, 1.0, 100.0)?;
                }
                let depreciation_per_year = if depreciation_years > 0.0 {
                    building_share * basis / depreciation_years
                } else {
                    0.0
                };
                Ok(TaxRules::Generic(GenericTax {
                    rate,
                    interest_deductible,
                    offset_losses,
                    depreciation_years,
                    depreciation_per_year,
                    capital_gains_rate,
                    recapture_rate,
                }))
            }
        }
    }
}

fn check_term(term_years: u32) -> Result<(), InputError> {
    check_count("loan.term_years", term_years, 1, MAX_YEARS_U32)
}

fn check_index_terms(spread: f64, index: f64, index_path: &[f64]) -> Result<(), InputError> {
    within("loan.spread", spread, -0.05, 0.1)?;
    within("loan.index", index, -0.05, 0.2)?;
    if index_path.len() > MAX_YEARS {
        return Err(out_of_range(
            "loan.index_path",
            format!(
                "must have at most {MAX_YEARS} entries, got {}",
                index_path.len()
            ),
        ));
    }
    for (i, value) in index_path.iter().enumerate() {
        within(&format!("loan.index_path[{i}]"), *value, -0.05, 0.2)?;
    }
    Ok(())
}

fn required<T>(field: &str, value: Option<T>) -> Result<T, InputError> {
    value.ok_or_else(|| InputError::new(ErrorCode::MissingField, field, "is required"))
}

fn out_of_range(field: &str, message: String) -> InputError {
    InputError::new(ErrorCode::OutOfRange, field, message)
}

fn finite(field: &str, value: f64) -> Result<(), InputError> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(InputError::new(
            ErrorCode::NotFinite,
            field,
            "must be a finite number",
        ))
    }
}

fn within(field: &str, value: f64, lo: f64, hi: f64) -> Result<(), InputError> {
    finite(field, value)?;
    if (lo..=hi).contains(&value) {
        Ok(())
    } else {
        Err(out_of_range(
            field,
            format!("must be between {lo} and {hi}, got {value}"),
        ))
    }
}

fn above_zero(field: &str, value: f64, hi: f64) -> Result<(), InputError> {
    finite(field, value)?;
    if value > 0.0 && value <= hi {
        Ok(())
    } else {
        Err(out_of_range(
            field,
            format!("must be above 0 and at most {hi}, got {value}"),
        ))
    }
}

fn check_count(field: &str, value: u32, lo: u32, hi: u32) -> Result<(), InputError> {
    if (lo..=hi).contains(&value) {
        Ok(())
    } else {
        Err(out_of_range(
            field,
            format!("must be between {lo} and {hi}, got {value}"),
        ))
    }
}

/// Maps serde errors to `missing_field`, `not_finite` (a `null` where a number is expected, which is how
/// `JSON.stringify` writes NaN and Infinity) or `invalid_json`, with the JSON path of the value.
pub fn parse<T: DeserializeOwned>(json: &[u8]) -> Result<T, InputError> {
    let mut deserializer = serde_json::Deserializer::from_slice(json);
    let value = serde_path_to_error::deserialize(&mut deserializer)
        .map_err(|e| classify(&json_path(e.path()), e.inner()))?;
    deserializer
        .end()
        .map_err(|e| InputError::new(ErrorCode::InvalidJson, "", e.to_string()))?;
    Ok(value)
}

fn json_path(path: &serde_path_to_error::Path) -> String {
    use serde_path_to_error::Segment;
    let mut out = String::new();
    for segment in path {
        match segment {
            Segment::Map { key } | Segment::Enum { variant: key } => {
                if !out.is_empty() {
                    out.push('.');
                }
                out.push_str(key);
            }
            Segment::Seq { index } => out.push_str(&format!("[{index}]")),
            Segment::Unknown => {}
        }
    }
    out
}

fn classify(path: &str, error: &serde_json::Error) -> InputError {
    let message = error.to_string();
    let quoted = |prefix: &str| {
        message
            .strip_prefix(prefix)?
            .split('`')
            .next()
            .map(str::to_owned)
    };
    let beneath = |name: &str| {
        if path.is_empty() {
            name.to_owned()
        } else {
            format!("{path}.{name}")
        }
    };
    if let Some(name) = quoted("missing field `") {
        InputError::new(ErrorCode::MissingField, beneath(&name), message)
    } else if message.starts_with("invalid type: null, expected f64")
        || message.starts_with("invalid type: null, expected u32")
    {
        InputError::new(ErrorCode::NotFinite, path, message)
    } else if let Some(name) = quoted("unknown field `") {
        // serde's own unknown-field error already has the key in the path; the loan mirror's does not.
        let field = if path.rsplit('.').next() == Some(name.as_str()) {
            path.to_owned()
        } else {
            beneath(&name)
        };
        InputError::new(ErrorCode::InvalidJson, field, message)
    } else {
        InputError::new(ErrorCode::InvalidJson, path, message)
    }
}
