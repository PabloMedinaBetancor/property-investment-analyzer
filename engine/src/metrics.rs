use serde::Serialize;

const MAX_ROOTS: usize = 16;
const RATE_FLOOR: f64 = -0.99;
const RATE_CEILING: f64 = 10.0;
const GRID_POINTS: usize = 290;

/// Does not discount `flows[0]`, as the reference (Excel's `NPV()` would).
pub fn npv(rate: f64, flows: &[f64]) -> f64 {
    let x = 1.0 / (1.0 + rate);
    flows.iter().rev().fold(0.0, |acc, cf| acc * x + cf)
}

/// Zeros are skipped.
pub fn sign_changes(flows: &[f64]) -> usize {
    let mut changes = 0;
    let mut previous = 0.0_f64;
    for &cf in flows.iter().filter(|cf| **cf != 0.0) {
        if previous * cf < 0.0 {
            changes += 1;
        }
        previous = cf;
    }
    changes
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum NoIrr {
    NoSignChange,
    OutOfRange,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum Irr {
    Unique { rate: f64 },
    Multiple { rates: Vec<f64> },
    None { reason: NoIrr },
}

/// Rates of the scan: -0.99 ..= 1.00 in steps of 0.01, then 1.1 ..= 10.0 in steps of 0.1, each an exact quotient.
fn grid_rate(k: usize) -> f64 {
    if k < 200 {
        (k as f64 - 99.0) / 100.0
    } else {
        1.0 + (k - 199) as f64 / 10.0
    }
}

/// Bisection on a bracket whose ends have opposite signs.
fn bisect(flows: &[f64], mut a: f64, mut b: f64, mut fa: f64) -> f64 {
    for _ in 0..200 {
        let mid = (a + b) / 2.0;
        let fm = npv(mid, flows);
        if fm == 0.0 {
            return mid;
        }
        if (b - a) / 2.0 < 1e-15 {
            break;
        }
        if fa * fm < 0.0 {
            b = mid;
        } else {
            a = mid;
            fa = fm;
        }
    }
    (a + b) / 2.0
}

/// Every root on the grid range in ascending order; returns how many were stored (at most `MAX_ROOTS`).
fn scan(flows: &[f64], roots: &mut [f64; MAX_ROOTS]) -> usize {
    let mut count = 0;
    let mut push = |root: f64| {
        if count < MAX_ROOTS {
            roots[count] = root;
            count += 1;
        }
    };
    let mut a = grid_rate(0);
    let mut fa = npv(a, flows);
    if fa == 0.0 {
        push(a);
    }
    for k in 1..GRID_POINTS {
        let b = grid_rate(k);
        let fb = npv(b, flows);
        if fb == 0.0 {
            push(b);
        } else if fa * fb < 0.0 {
            push(bisect(flows, a, b, fa));
        }
        a = b;
        fa = fb;
    }
    count
}

pub fn irr(flows: &[f64]) -> Irr {
    if sign_changes(flows) == 0 {
        return Irr::None {
            reason: NoIrr::NoSignChange,
        };
    }
    let mut roots = [0.0; MAX_ROOTS];
    let count = scan(flows, &mut roots);
    match count {
        0 => Irr::None {
            reason: NoIrr::OutOfRange,
        },
        1 => Irr::Unique { rate: roots[0] },
        _ => Irr::Multiple {
            rates: roots[..count].to_vec(),
        },
    }
}

/// The Monte Carlo's allocation-free view of `Irr`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScenarioIrr {
    Rate(f64),
    Multiple,
    NoRoot,
}

/// Same answer as `irr`; the single-sign-change case, nearly every scenario, skips the scan.
pub fn scenario_irr(flows: &[f64]) -> ScenarioIrr {
    match sign_changes(flows) {
        0 => ScenarioIrr::NoRoot,
        1 => single_root(flows).map_or(ScenarioIrr::NoRoot, ScenarioIrr::Rate),
        _ => {
            let mut roots = [0.0; MAX_ROOTS];
            match scan(flows, &mut roots) {
                0 => ScenarioIrr::NoRoot,
                1 => ScenarioIrr::Rate(roots[0]),
                _ => ScenarioIrr::Multiple,
            }
        }
    }
}

/// One sign change means exactly one root for r > -1 (Descartes on x = 1/(1+r)), so it exists in the scan range
/// exactly when the ends of the range disagree.
fn single_root(flows: &[f64]) -> Option<f64> {
    single_root_counted(flows).map(|(rate, _)| rate)
}

/// Newton keeps a bracket and takes its step only when the step stays inside the bracket and is at most half the
/// previous step (the standard safeguard: a Newton run that does not shrink fast enough is replaced by a bisection),
/// so the bracket at least halves every two steps and the loop ends at the root. Also returns the iterations used.
fn single_root_counted(flows: &[f64]) -> Option<(f64, u32)> {
    let (mut lo, mut hi) = (RATE_FLOOR, RATE_CEILING);
    let flo = npv(lo, flows);
    let fhi = npv(hi, flows);
    if flo == 0.0 {
        return Some((lo, 0));
    }
    if fhi == 0.0 {
        return Some((hi, 0));
    }
    if flo * fhi > 0.0 {
        return None;
    }
    let mut r = 0.1;
    let mut prev = hi - lo;
    let mut used = 0;
    for _ in 0..200 {
        used += 1;
        let x = 1.0 / (1.0 + r);
        let (mut value, mut slope) = (0.0, 0.0);
        for &cf in flows.iter().rev() {
            slope = slope * x + value;
            value = value * x + cf;
        }
        if value == 0.0 {
            return Some((r, used));
        }
        if (value > 0.0) == (flo > 0.0) {
            lo = r;
        } else {
            hi = r;
        }
        let newton = r + value / (x * x * slope);
        if (newton - r).abs() < 1e-13 && newton >= lo && newton <= hi {
            // Newton has stopped moving inside the bracket: that is the root (its error is the square of the step).
            r = newton;
            break;
        }
        let next = if newton > lo && newton < hi && (newton - r).abs() <= prev / 2.0 {
            newton
        } else {
            (lo + hi) / 2.0
        };
        let step = (next - r).abs();
        prev = step;
        r = next;
        if step < 1e-13 || hi - lo < 1e-13 {
            break;
        }
    }
    Some((r, used))
}

/// `None` without a positive and a negative flow.
pub fn mirr(flows: &[f64], finance: f64, reinvest: f64) -> Option<f64> {
    let last = flows.len().checked_sub(1).filter(|n| *n > 0)?;
    let mut future = 0.0;
    let mut present = 0.0;
    for (t, &cf) in flows.iter().enumerate() {
        if cf > 0.0 {
            future += cf * libm::pow(1.0 + reinvest, (last - t) as f64);
        } else if cf < 0.0 {
            present += cf / libm::pow(1.0 + finance, t as f64);
        }
    }
    if future == 0.0 || present == 0.0 {
        return None;
    }
    let rate = libm::pow(future / -present, 1.0 / last as f64) - 1.0;
    rate.is_finite().then_some(rate)
}

/// Years until the cumulative flow, `cf0` plus the operating flows (never the exit), turns non-negative; the year
/// in which it does is interpolated linearly.
pub fn payback(cf0: f64, operating: &[f64]) -> Option<f64> {
    if cf0 >= 0.0 {
        return Some(0.0);
    }
    let mut cumulative = cf0;
    for (i, &cf) in operating.iter().enumerate() {
        if cumulative + cf >= 0.0 {
            return Some(i as f64 - cumulative / cf);
        }
        cumulative += cf;
    }
    None
}

/// Type-7 percentile of an ascending slice (`p` in 0..=1). An infinity must not turn the
/// interpolation into NaN: next to -inf the answer is -inf, next to +inf it is +inf.
pub fn percentile7(sorted: &[f64], p: f64) -> f64 {
    let Some(last) = sorted.len().checked_sub(1) else {
        return f64::NAN;
    };
    let h = last as f64 * p.clamp(0.0, 1.0);
    let lo = h.floor() as usize;
    let frac = h - lo as f64;
    if frac == 0.0 || lo >= last {
        return sorted[lo.min(last)];
    }
    let (below, above) = (sorted[lo], sorted[lo + 1]);
    if below == f64::NEG_INFINITY {
        f64::NEG_INFINITY
    } else if above == f64::INFINITY {
        f64::INFINITY
    } else {
        below + frac * (above - below)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LONG_HOLD: [f64; 36] = [
        -612381.0, -30272.0, -29880.0, -29466.0, -29027.0, -28562.0, -28070.0, -27549.0, -26998.0,
        -26414.0, -25796.0, -25142.0, -24450.0, -23717.0, -22941.0, -22121.0, -21252.0, -20332.0,
        -19358.0, 15890.0, 13066.0, 13848.0, 14676.0, 15553.0, 16480.0, 17462.0, 18502.0, 19602.0,
        20766.0, 21998.0, 23303.0, 24683.0, 26144.0, 27691.0, 28196.0, 1279481.0,
    ];

    #[test]
    fn the_35_year_case_converges_in_few_iterations_to_the_root() {
        let (rate, used) = single_root_counted(&LONG_HOLD).unwrap();
        assert!((rate - 0.0134019).abs() < 1e-6, "{rate}");
        assert!(used <= 20, "{used} iterations");
    }

    #[test]
    fn typical_one_sign_change_flows_need_few_iterations_on_average() {
        // A deterministic spread of equity, running cash flow and exit multiples over 10 and 30 years.
        let (mut total, mut cases) = (0u32, 0u32);
        for years in [10usize, 30] {
            for equity in [30_000.0, 60_000.0, 120_000.0, 230_000.0] {
                for running in [-3_000.0, -500.0, 1_000.0, 4_000.0] {
                    for multiple in [0.7, 1.0, 1.5, 2.2] {
                        let mut flows = vec![-equity];
                        flows.extend((1..years).map(|t| running * 1.02f64.powi(t as i32)));
                        flows.push(running + equity * multiple);
                        if sign_changes(&flows) != 1 {
                            continue;
                        }
                        let Some((rate, used)) = single_root_counted(&flows) else {
                            continue;
                        };
                        if rate < -0.5 {
                            continue; // a loss of over half the money a year: not a case Newton is for
                        }
                        assert!(used <= 30, "{used} iterations at {rate} for {flows:?}");
                        assert!(npv(rate, &flows).abs() < 1e-6 * equity, "{rate}");
                        total += used;
                        cases += 1;
                    }
                }
            }
        }
        assert!(cases > 40, "{cases}");
        let mean = f64::from(total) / f64::from(cases);
        assert!(mean < 12.0, "mean {mean} iterations over {cases} flows");
    }
}
