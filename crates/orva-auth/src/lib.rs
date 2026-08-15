//! ORVA Core — Identity & Authentication (M2)
//!
//! Business logic ของ auth (hashing, token, JWT) แยกจาก `orva-data` (schema/CRUD ล้วน)
//!
//! - [`password`] — argon2 hashing + policy
//! - [`token`] — opaque session/service-key generation + hashing
//! - [`jwt`] — OIDC-style ID token (RS256 — ดู ADR 0006)
//! - [`keys`] — RSA key pair + JWK สาธารณะสำหรับ JWKS endpoint
//! - [`service::AuthService`] — orchestrator: register/login/session/service identity

pub mod authz;
pub mod jwt;
pub mod keys;
pub mod password;
mod service;
pub mod token;

pub use authz::{Authorizer, PermissionSet, Policy, PolicyContext};
pub use keys::JwtKeys;
pub use service::{AuthConfig, AuthResult, AuthService};
