//! ORVA Core — configuration
//!
//! ลำดับการโหลด: defaults → ไฟล์ TOML (`ORVA_CONFIG` หรือ `config/default.toml`) → env override
//! env ที่รองรับ: `ORVA_SERVER_HOST`, `ORVA_SERVER_PORT`, `ORVA_DATABASE_URL`

use orva_error::{Error, Result};
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub database: DatabaseConfig,
    #[serde(default)]
    pub auth: AuthConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_database_url")]
    pub url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthConfig {
    /// path ไปยัง RSA private key PEM (PKCS#8) สำหรับเซ็น ID token แบบ RS256 (ADR 0006)
    /// ถ้าไฟล์ไม่มี server จะ generate ให้เองตอน start (dev bootstrap) —
    /// production ต้อง provision key เองแล้วชี้ path นี้ (หรือ env `ORVA_JWT_RSA_KEY_PATH`)
    #[serde(default = "default_rsa_key_path")]
    pub rsa_key_path: String,
    #[serde(default = "default_issuer")]
    pub issuer: String,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            rsa_key_path: default_rsa_key_path(),
            issuer: default_issuer(),
        }
    }
}

fn default_rsa_key_path() -> String {
    "config/keys/jwt_rsa.pem".to_string()
}

fn default_issuer() -> String {
    "orva-core".to_string()
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    8080
}

fn default_database_url() -> String {
    "postgres://orva_app:orva@localhost:5432/orva".to_string()
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
        }
    }
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            url: default_database_url(),
        }
    }
}

impl Config {
    pub fn load() -> Result<Self> {
        let path =
            std::env::var("ORVA_CONFIG").unwrap_or_else(|_| "config/default.toml".to_string());

        let mut config = if std::path::Path::new(&path).exists() {
            let text = std::fs::read_to_string(&path).map_err(|e| Error::Config(e.to_string()))?;
            toml::from_str(&text).map_err(|e| Error::Config(e.to_string()))?
        } else {
            Config::default()
        };

        if let Ok(host) = std::env::var("ORVA_SERVER_HOST") {
            config.server.host = host;
        }
        if let Ok(port) = std::env::var("ORVA_SERVER_PORT") {
            config.server.port = port
                .parse()
                .map_err(|e| Error::Config(format!("invalid ORVA_SERVER_PORT: {e}")))?;
        }
        if let Ok(url) = std::env::var("ORVA_DATABASE_URL") {
            config.database.url = url;
        }
        if let Ok(path) = std::env::var("ORVA_JWT_RSA_KEY_PATH") {
            config.auth.rsa_key_path = path;
        }

        Ok(config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        let config = Config::default();
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.server.port, 8080);
        assert!(config.database.url.starts_with("postgres://"));
    }

    #[test]
    fn partial_toml_fills_defaults() {
        let config: Config = toml::from_str("[server]\nport = 9000\n").unwrap();
        assert_eq!(config.server.port, 9000);
        assert_eq!(config.server.host, "127.0.0.1");
        assert!(config.database.url.starts_with("postgres://"));
    }
}
