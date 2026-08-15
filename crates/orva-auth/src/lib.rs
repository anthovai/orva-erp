//! ORVA Core — Identity & Authentication (M2)
//!
//! Business logic ของ auth (hashing, token, JWT) แยกจาก `orva-data` (schema/CRUD ล้วน)
//!
//! - [`password`] — argon2 hashing + policy
//! - [`token`] — opaque session/service-key generation + hashing
//! - [`jwt`] — OIDC-style ID token (HS256 ใน v0.1 — ดู ADR 0002)
//! - [`service::AuthService`] — orchestrator: register/login/session/service identity

pub mod authz;
pub mod jwt;
pub mod password;
mod service;
pub mod token;

pub use authz::{Authorizer, PermissionSet, Policy, PolicyContext};
pub use service::{AuthConfig, AuthResult, AuthService};
