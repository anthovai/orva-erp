use orva_config::Config;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::load()?;

    let pool = orva_data::connect(&config.database.url).await?;
    orva_data::migrate(&pool).await?;
    tracing::info!("database connected and migrated");

    let keys = load_or_generate_keys(&config.auth.rsa_key_path)?;

    // SMTP mailer — ไม่ config = email notification บันทึกแถวไว้เฉย ๆ (ADR 0008)
    let mailer: Option<std::sync::Arc<dyn orva_notifications::Mailer>> = match &config.email {
        Some(email) => {
            tracing::info!(
                host = %email.smtp_host,
                port = email.smtp_port,
                tls = email.smtp_tls,
                "SMTP mailer configured — email notifications will be sent"
            );
            Some(std::sync::Arc::new(orva_notifications::SmtpMailer::new(
                orva_notifications::SmtpConfig {
                    host: email.smtp_host.clone(),
                    port: email.smtp_port,
                    username: email.smtp_username.clone(),
                    password: email.smtp_password.clone(),
                    from: email.from_address.clone(),
                    tls: email.smtp_tls,
                },
            )?))
        }
        None => {
            tracing::info!("no SMTP configured — email notifications recorded but not sent");
            None
        }
    };

    // AI analyst — ไม่ config = ชั้น AI ปิด (ADR 0018)
    let analyst: Option<std::sync::Arc<dyn orva_intelligence::Analyst>> = match &config.ai {
        Some(ai) => {
            let model = ai
                .model
                .clone()
                .unwrap_or_else(|| orva_intelligence::DEFAULT_MODEL.to_string());
            tracing::info!(model = %model, "AI analyst configured — /intelligence/analyze enabled");
            Some(std::sync::Arc::new(orva_intelligence::ClaudeAnalyst::new(
                ai.api_key.clone(),
                Some(model),
            )))
        }
        None => {
            tracing::info!("no AI configured — /intelligence/analyze disabled");
            None
        }
    };

    let state = orva_core::AppState::with_options(
        pool,
        keys,
        &config.auth.issuer,
        orva_core::state::DEFAULT_REQUESTS_PER_MINUTE,
        mailer,
        analyst,
    )
    .await;

    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("ORVA Core listening on http://{addr}");

    axum::serve(
        listener,
        orva_core::app(state).into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}

/// โหลด RSA signing key จาก PEM ที่ path นี้ — ถ้าไม่มี generate ใหม่แล้วเขียนเก็บไว้
/// (dev bootstrap เท่านั้น — ดู ADR 0006; production ต้อง provision key เองเสมอ
/// เพราะ key ที่หายไป = ID token เก่าทั้งหมด verify ไม่ผ่านทันที)
fn load_or_generate_keys(path: &str) -> Result<orva_auth::JwtKeys, Box<dyn std::error::Error>> {
    if std::path::Path::new(path).exists() {
        let pem = std::fs::read_to_string(path)?;
        let keys = orva_auth::JwtKeys::from_rsa_pem(&pem)?;
        tracing::info!("loaded RSA signing key from {path} (kid: {})", keys.kid);
        Ok(keys)
    } else {
        let (keys, pem) = orva_auth::JwtKeys::generate()?;
        if let Some(parent) = std::path::Path::new(path).parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, pem)?;
        tracing::warn!(
            "generated new RSA signing key at {path} (kid: {}) — dev bootstrap; \
             production ต้อง provision key เองผ่าน ORVA_JWT_RSA_KEY_PATH",
            keys.kid
        );
        Ok(keys)
    }
}
