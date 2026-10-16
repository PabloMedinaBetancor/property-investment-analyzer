mod common;

use common::{assert_json_close, fixture};
use invest_engine::inputs::GenericPurchase;
use invest_engine::market::{
    Market, Region, Schedule, acquisition, notary_fee, registry_fee, spain,
};
use serde_json::Value;

fn region(code: &str) -> &'static Region {
    spain()
        .regions
        .iter()
        .find(|r| r.code == code)
        .unwrap_or_else(|| panic!("no region {code}"))
}

fn spanish_market(code: &str, new_build: bool, reference_value: Option<f64>) -> Market {
    Market::Spain {
        region: region(code),
        new_build,
        reference_value,
        manual_transfer_rate: None,
        notary_extras: 0.0,
        gestoria: 0.0,
        buyer_agency_rate: 0.0,
    }
}

fn base_of(key: &str) -> f64 {
    key.parse().unwrap()
}

#[test]
fn shipped_data_has_19_regions_and_a_21_percent_fee_vat() {
    assert_eq!(spain().regions.len(), 19);
    assert_eq!(spain().fee_vat, 0.21);
    assert_eq!(spain().new_build_vat_default, 0.10);
}

#[test]
fn ceuta_has_no_new_build_vat_and_canarias_has_7_percent_igic() {
    assert_eq!(region("CE").new_build_vat, None);
    assert_eq!(region("ML").new_build_vat, None);
    assert_eq!(region("CN").new_build_vat, Some(0.07));
    assert_eq!(region("MD").new_build_vat, Some(0.10));
}

#[test]
fn resale_transfer_tax_of_every_region_matches_the_fixture() {
    let expected = fixture("taxes_and_fees");
    for (code, bases) in expected["transfer_tax_resale"].as_object().unwrap() {
        for (base, tax) in bases.as_object().unwrap() {
            let actual = region(code).resale.tax(base_of(base));
            assert_json_close(tax, &Value::from(actual));
        }
    }
}

#[test]
fn new_build_transfer_tax_of_every_region_matches_the_fixture() {
    let expected = fixture("taxes_and_fees");
    for (code, bases) in expected["transfer_tax_new_build"].as_object().unwrap() {
        for (base, tax) in bases.as_object().unwrap() {
            let price = base_of(base);
            let actual = acquisition(&spanish_market(code, true, None), price, 0.0, 0.0, 0.0);
            assert_json_close(tax, &Value::from(actual.transfer_tax));
        }
    }
}

#[test]
fn notary_and_registry_fees_match_the_fixture() {
    let expected = fixture("taxes_and_fees");
    for (price, fees) in expected["fees"].as_object().unwrap() {
        let price = base_of(price);
        assert_json_close(
            &fees["notary_scale"],
            &Value::from(spain().notary.scale(price)),
        );
        assert_json_close(
            &fees["notary_total_extras300"],
            &Value::from(notary_fee(price, 300.0)),
        );
        assert_json_close(&fees["registry_total"], &Value::from(registry_fee(price)));
    }
}

#[test]
fn capital_gains_scale_matches_the_fixture() {
    let expected = fixture("taxes_and_fees");
    for (gain, tax) in expected["capital_gains_es"].as_object().unwrap() {
        let actual = spain().capital_gains.tax(base_of(gain));
        assert_json_close(tax, &Value::from(actual));
    }
}

#[test]
fn progressive_schedule_charges_each_slice_aragon_at_450k_pays_36_250() {
    assert_eq!(region("AR").resale.tax(450_000.0), 36_250.0);
}

#[test]
fn band_schedule_charges_the_whole_base_asturias_at_400k_pays_36_000() {
    assert_eq!(region("AS").resale.tax(400_000.0), 36_000.0);
}

#[test]
fn band_schedule_changes_rate_only_above_the_threshold_asturias_at_300k_pays_8_percent() {
    assert_eq!(region("AS").resale.tax(300_000.0), 24_000.0);
}

#[test]
fn a_schedule_taxes_nothing_on_a_zero_or_negative_base() {
    assert_eq!(Schedule::Flat(0.1).tax(0.0), 0.0);
    assert_eq!(region("AR").resale.tax(-5.0), 0.0);
}

#[test]
fn registry_fee_is_floored_at_the_minimum_scale_on_a_tiny_price() {
    let floor = 24.040484 * 0.95 * 1.21;
    assert!((registry_fee(100.0) - floor).abs() < 1e-9);
}

#[test]
fn registry_fee_is_capped_at_the_maximum_scale_on_a_huge_price() {
    let cap = 2181.673939 * 0.95 * 1.21;
    assert!((registry_fee(2.0e9) - cap).abs() < 1e-9);
}

#[test]
fn the_transfer_tax_is_charged_on_the_reference_value_when_it_exceeds_the_price() {
    let market = spanish_market("MD", false, Some(200_000.0));
    let acq = acquisition(&market, 150_000.0, 0.0, 0.0, 0.0);
    assert_eq!(acq.transfer_tax, 12_000.0);
}

#[test]
fn a_manual_transfer_rate_replaces_the_regional_tax() {
    let market = Market::Spain {
        region: region("CE"),
        new_build: true,
        reference_value: None,
        manual_transfer_rate: Some(0.04),
        notary_extras: 0.0,
        gestoria: 0.0,
        buyer_agency_rate: 0.0,
    };
    let acq = acquisition(&market, 100_000.0, 0.0, 0.0, 0.0);
    assert_eq!(acq.transfer_tax, 4_000.0);
}

#[test]
fn a_manual_transfer_rate_on_a_new_build_is_charged_on_the_price_not_the_reference_value() {
    let new_build = |new_build| Market::Spain {
        region: region("CE"),
        new_build,
        reference_value: Some(180_000.0),
        manual_transfer_rate: Some(0.04),
        notary_extras: 0.0,
        gestoria: 0.0,
        buyer_agency_rate: 0.0,
    };
    let built = acquisition(&new_build(true), 100_000.0, 0.0, 0.0, 0.0);
    assert_eq!(built.transfer_tax, 4_000.0);
    // A resale keeps the higher base.
    let resale = acquisition(&new_build(false), 100_000.0, 0.0, 0.0, 0.0);
    assert_eq!(resale.transfer_tax, 7_200.0);
}

#[test]
fn acquisition_of_every_proforma_fixture_matches() {
    for name in ["F1", "F2", "F3", "F4", "F5"] {
        let doc = fixture(&format!("proforma_{name}"));
        let x = &doc["inputs"];
        let market = if x["profile"] == "generic" {
            let purchase: GenericPurchase = serde_json::from_value(x["purchase"].clone()).unwrap();
            Market::Generic(purchase)
        } else {
            Market::Spain {
                region: region(x["region"].as_str().unwrap()),
                new_build: x["new_build"].as_bool().unwrap(),
                reference_value: x["reference_value"].as_f64(),
                manual_transfer_rate: x["manual_transfer_rate"].as_f64(),
                notary_extras: x["notary_extras"].as_f64().unwrap(),
                gestoria: x["gestoria"].as_f64().unwrap(),
                buyer_agency_rate: x["buyer_agency_rate"].as_f64().unwrap(),
            }
        };
        let actual = acquisition(
            &market,
            x["price"].as_f64().unwrap(),
            x["renovation"].as_f64().unwrap(),
            x["ltv"].as_f64().unwrap(),
            x["loan_fees"].as_f64().unwrap(),
        );
        assert_json_close(
            &doc["result"]["acquisition"],
            &serde_json::to_value(&actual).unwrap(),
        );
    }
}

#[test]
fn new_build_vat_is_charged_on_the_price_and_stamp_duty_on_the_reference_value() {
    // Madrid: 10 % VAT on the 200,000 paid, 0.75 % AJD on the 300,000 reference value.
    let market = spanish_market("MD", true, Some(300_000.0));
    let acq = acquisition(&market, 200_000.0, 0.0, 0.0, 0.0);
    assert!((acq.transfer_tax - (20_000.0 + 2_250.0)).abs() < 1e-9);
    // Canary Islands: 7 % IGIC on the price.
    let market = spanish_market("CN", true, Some(300_000.0));
    let acq = acquisition(&market, 200_000.0, 0.0, 0.0, 0.0);
    assert!(
        (acq.transfer_tax - (14_000.0 + 300_000.0 * region("CN").new_build_stamp)).abs() < 1e-9
    );
}

#[test]
fn a_cash_purchase_pays_no_loan_fees() {
    let market = spanish_market("MD", false, None);
    let cash = acquisition(&market, 200_000.0, 0.0, 0.0, 400.0);
    assert_eq!(cash.equity0, cash.total_investment);
    let loan = acquisition(&market, 200_000.0, 0.0, 0.7, 400.0);
    assert!((loan.equity0 - (loan.total_investment + 400.0 - 140_000.0)).abs() < 1e-9);
}
