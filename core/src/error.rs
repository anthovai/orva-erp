use axum::{http::StatusCode, response::IntoResponse, response::Response, Json};
use serde_json::json;

pub struct ApiError(orva_error::Error);

impl From<orva_error::Error> for ApiError {
    fn from(err: orva_error::Error) -> Self {
        ApiError(err)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        use orva_error::Error::*;

        let (status, message) = match &self.0 {
            NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized".to_string()),
            Forbidden(m) => (StatusCode::FORBIDDEN, m.clone()),
            Validation(m) => (StatusCode::BAD_REQUEST, m.clone()),
            Config(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.clone()),
            Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, m.clone()),
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}
