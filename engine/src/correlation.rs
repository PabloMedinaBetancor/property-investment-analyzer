use crate::error::{ErrorCode, InputError};

const TOLERANCE: f64 = 1e-12;

/// Lower-triangular factor of the 4x4 correlation matrix.
#[derive(Debug, Clone)]
pub struct Cholesky([[f64; 4]; 4]);

fn within(x: f64, limit: f64) -> bool {
    x.abs() <= limit
}

fn bad(message: String) -> InputError {
    InputError::new(ErrorCode::BadCorrelation, "params.corr", message)
}

fn check_shape(corr: &[[f64; 4]; 4]) -> Result<(), InputError> {
    for (i, row) in corr.iter().enumerate() {
        if !within(row[i] - 1.0, TOLERANCE) {
            return Err(bad(format!("diagonal entry {i} must be 1, got {}", row[i])));
        }
        for (j, &rho) in row.iter().enumerate().take(i) {
            if !within(rho - corr[j][i], TOLERANCE) {
                return Err(bad(format!("entries ({i},{j}) and ({j},{i}) differ")));
            }
            if !within(rho, 1.0) {
                return Err(bad(format!(
                    "entry ({i},{j}) must be between -1 and 1, got {rho}"
                )));
            }
        }
    }
    Ok(())
}

impl Cholesky {
    /// Rejects an asymmetric matrix, a non-unit diagonal, `|rho| > 1` and pivots below 1e-12 (`bad_correlation`).
    pub fn new(corr: &[[f64; 4]; 4]) -> Result<Cholesky, InputError> {
        check_shape(corr)?;
        let mut l = [[0.0; 4]; 4];
        for (i, row) in corr.iter().enumerate() {
            for (j, &rho) in row.iter().enumerate().take(i + 1) {
                let s: f64 = l[i].iter().zip(&l[j]).take(j).map(|(a, b)| a * b).sum();
                if i == j {
                    let pivot = rho - s;
                    if pivot.is_nan() || pivot <= TOLERANCE {
                        return Err(bad("the matrix is not positive definite".to_string()));
                    }
                    l[i][j] = pivot.sqrt();
                } else {
                    l[i][j] = (rho - s) / l[j][j];
                }
            }
        }
        Ok(Cholesky(l))
    }

    /// `z_i = sum over k <= i of L[i][k] * eps[k]`, k ascending.
    pub fn correlate(&self, eps: &[f64; 4]) -> [f64; 4] {
        let mut z = [0.0; 4];
        for (zi, row) in z.iter_mut().zip(&self.0) {
            for (l, e) in row.iter().zip(eps) {
                *zi += l * e;
            }
        }
        z
    }
}
