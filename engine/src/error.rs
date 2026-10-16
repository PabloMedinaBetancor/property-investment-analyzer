use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidJson,
    MissingField,
    NotFinite,
    OutOfRange,
    UnknownRegion,
    BadCorrelation,
    TooManyScenarios,
}

/// `field` is the JSON path of the offending value (`loan.term_years`), empty for the whole document.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InputError {
    pub code: ErrorCode,
    pub field: String,
    pub message: String,
}

impl InputError {
    pub fn new(
        code: ErrorCode,
        field: impl Into<String>,
        message: impl Into<String>,
    ) -> InputError {
        InputError {
            code,
            field: field.into(),
            message: message.into(),
        }
    }
}
