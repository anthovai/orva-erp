//! ORVA Core — application router
//!
//! แยก `app()` ออกจาก `main` เพื่อให้ integration test เรียก router ตรง ๆ ได้

mod docs;
mod error;
mod extractor;
mod middleware;
mod permissions;
mod rate_limit;
mod routes;
mod routes_agent;
mod routes_external;
mod routes_intelligence;
mod routes_modules;
mod routes_notifications;
mod routes_workflow;
pub mod state;
mod validation;

use axum::middleware::from_fn_with_state;
use axum::Router;

pub use state::AppState;

pub fn app(state: AppState) -> Router {
    let module_router = state.modules.router(state.module_context.clone());

    let mut router = routes::router()
        .merge(routes_workflow::router())
        .merge(routes_notifications::router())
        .merge(routes_modules::router())
        .merge(routes_intelligence::router())
        .merge(routes_agent::router())
        .merge(routes_external::router())
        .merge(docs::router())
        .with_state(state.clone())
        .merge(module_router)
        .layer(from_fn_with_state(state, rate_limit::enforce))
        .layer(middleware::cors_layer());

    for header_layer in middleware::security_headers() {
        router = router.layer(header_layer);
    }

    router
}
