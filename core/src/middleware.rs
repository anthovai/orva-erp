use axum::http::header::{HeaderName, HeaderValue};
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;

/// v0.1: อนุญาตทุก origin เพราะยังไม่มี Unified UI จริงให้ล็อก origin — ต้องจำกัดก่อนขึ้น production
pub fn cors_layer() -> CorsLayer {
    CorsLayer::permissive()
}

/// Security headers พื้นฐานที่ควรมีทุก response — ไม่ครอบคลุม CSP เพราะยังไม่มีหน้า HTML ให้ป้องกัน
pub fn security_headers() -> Vec<SetResponseHeaderLayer<HeaderValue>> {
    vec![
        SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ),
        SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ),
        SetResponseHeaderLayer::overriding(
            HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("no-referrer"),
        ),
    ]
}
