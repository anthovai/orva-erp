//! ORVA Core — error type กลางของทุก crate
//!
//! ตั้งใจให้ framework-agnostic: crate นี้ไม่รู้จัก axum/sqlx
//! การ map เป็น HTTP response ทำที่ชั้น API (core)

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("configuration error: {0}")]
    Config(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("rate limit exceeded")]
    RateLimited,

    #[error("internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, Error>;
