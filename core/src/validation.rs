use axum::extract::{FromRequest, Request};
use axum::Json;
use serde::de::DeserializeOwned;
use validator::Validate;

use crate::error::ApiError;

/// เหมือน `axum::Json<T>` แต่รัน `T::validate()` ต่อทันที — ถ้า deserialize หรือ validate
/// ล้มเหลว ตอบกลับด้วยรูปแบบ error เดียวกับ error ทั่วทั้ง API (`{"error": "..."}`, 400)
/// แทนที่จะเป็น plain-text rejection ของ axum เอง
pub struct ValidatedJson<T>(pub T);

impl<S, T> FromRequest<S> for ValidatedJson<T>
where
    T: DeserializeOwned + Validate,
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) = Json::<T>::from_request(req, state)
            .await
            .map_err(|rejection| orva_error::Error::Validation(rejection.to_string()))?;

        value
            .validate()
            .map_err(|e| orva_error::Error::Validation(e.to_string()))?;

        Ok(ValidatedJson(value))
    }
}
