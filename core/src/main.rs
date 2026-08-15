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
    let state = orva_core::AppState::new(pool, keys, &config.auth.issuer).await;

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
