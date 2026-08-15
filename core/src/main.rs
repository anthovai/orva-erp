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

    let state = orva_core::AppState::new(pool, &config.auth.jwt_secret, &config.auth.issuer).await;

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
