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
    /// ไม่ใส่ section `[email]` = ไม่ส่งอีเมลจริง (email notification บันทึกแถวไว้เฉย ๆ)
    #[serde(default)]
    pub email: Option<EmailConfig>,
    /// ไม่ใส่ section `[ai]` = ปิดชั้น AI (POST /intelligence/analyze ตอบ 400) — ADR 0018
    #[serde(default)]
    pub ai: Option<AiConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiConfig {
    /// Anthropic API key (หรือ env `ORVA_AI_API_KEY` / `ANTHROPIC_API_KEY`)
    pub api_key: String,
    /// model id — ไม่ระบุ = default ของ orva-intelligence (`claude-opus-5`)
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EmailConfig {
    pub smtp_host: String,
    #[serde(default = "default_smtp_port")]
    pub smtp_port: u16,
    #[serde(default)]
    pub smtp_username: Option<String>,
    #[serde(default)]
    pub smtp_password: Option<String>,
    /// ที่อยู่ผู้ส่ง เช่น `ORVA <no-reply@example.com>`
    pub from_address: String,
    /// STARTTLS — ปิดได้เฉพาะ dev (เช่น Mailpit) เท่านั้น
    #[serde(default = "default_smtp_tls")]
    pub smtp_tls: bool,
}

fn default_smtp_port() -> u16 {
    587
}

fn default_smtp_tls() -> bool {
    true
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

        // env override สำหรับ SMTP — ตั้ง ORVA_SMTP_HOST อย่างเดียวก็เปิดการส่งจริงได้
        // (from address ต้องมาด้วย ไม่งั้นถือว่า config ไม่ครบ)
        if let Ok(host) = std::env::var("ORVA_SMTP_HOST") {
            let from_address = std::env::var("ORVA_SMTP_FROM").map_err(|_| {
                Error::Config("ORVA_SMTP_HOST is set but ORVA_SMTP_FROM is missing".to_string())
            })?;
            config.email = Some(EmailConfig {
                smtp_host: host,
                smtp_port: match std::env::var("ORVA_SMTP_PORT") {
                    Ok(p) => p
                        .parse()
                        .map_err(|e| Error::Config(format!("invalid ORVA_SMTP_PORT: {e}")))?,
                    Err(_) => default_smtp_port(),
                },
                smtp_username: std::env::var("ORVA_SMTP_USERNAME").ok(),
                smtp_password: std::env::var("ORVA_SMTP_PASSWORD").ok(),
                from_address,
                smtp_tls: match std::env::var("ORVA_SMTP_TLS") {
                    Ok(v) => v != "false" && v != "0",
                    Err(_) => default_smtp_tls(),
                },
            });
        }

        // env override สำหรับ AI — ตั้ง key ตัวเดียวก็เปิดชั้น AI ได้
        let ai_key = std::env::var("ORVA_AI_API_KEY")
            .or_else(|_| std::env::var("ANTHROPIC_API_KEY"))
            .ok();
        if let Some(api_key) = ai_key {
            let model = std::env::var("ORVA_AI_MODEL")
                .ok()
                .or_else(|| config.ai.as_ref().and_then(|a| a.model.clone()));
            config.ai = Some(AiConfig { api_key, model });
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
