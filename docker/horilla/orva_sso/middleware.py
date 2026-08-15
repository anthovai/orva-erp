# ORVA SSO middleware for Horilla (ADR 0014 Phase 2)
# Distributed under LGPL-2.1 to match Horilla's license (runs inside Horilla's process).
#
# ตรวจ header `X-Orva-Identity` (JWT RS256 ที่ ORVA Core เซ็น อายุ 60 วิ) กับ JWKS
# สาธารณะของ ORVA — ผ่านแล้ว map claim email -> Django user แล้ว login ให้อัตโนมัติ
# ไม่มี secret แชร์: ของปลอมตกที่ signature verification เสมอ
import logging
import os

import jwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

JWKS_URL = os.environ.get(
    "ORVA_JWKS_URL", "http://host.docker.internal:8080/.well-known/jwks.json"
)
AUDIENCE = os.environ.get("ORVA_SSO_AUDIENCE", "orva-module:horilla")

_jwks_client = PyJWKClient(JWKS_URL, cache_keys=True)


def _verify(token):
    signing_key = _jwks_client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=AUDIENCE,
        leeway=10,
    )


class OrvaSSOMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = request.headers.get("X-Orva-Identity")
        if token and not request.user.is_authenticated:
            try:
                claims = _verify(token)
                self._login(request, claims)
            except Exception as exc:  # ของปลอม/หมดอายุ -> ปล่อยไป login ปกติของ Horilla
                logger.warning("ORVA SSO assertion rejected: %s", exc)
        return self.get_response(request)

    def _login(self, request, claims):
        from django.contrib.auth import get_user_model, login

        email = claims.get("email")
        if not email:
            return
        user_model = get_user_model()
        user, created = user_model.objects.get_or_create(
            username=email,
            defaults={
                "email": email,
                "first_name": (claims.get("name") or "")[:150],
                # SSO-only user — ไม่มีรหัสผ่าน local (login ตรงกับ Horilla ไม่ได้)
            },
        )
        if created:
            user.set_unusable_password()
            user.save(update_fields=["password"])
            self._ensure_employee(user, claims)
            logger.info("ORVA SSO provisioned Horilla user %s", email)
        user.backend = "django.contrib.auth.backends.ModelBackend"
        login(request, user)

    def _ensure_employee(self, user, claims):
        # Horilla ผูก UI ส่วนใหญ่กับ Employee record — สร้างขั้นต่ำให้ dashboard ใช้ได้
        try:
            from employee.models import Employee

            name = (claims.get("name") or claims.get("email") or "").strip()
            first, _, last = name.partition(" ")
            Employee.objects.get_or_create(
                employee_user_id=user,
                defaults={
                    "employee_first_name": first or user.username,
                    "employee_last_name": last,
                    "email": claims.get("email") or "",
                },
            )
        except Exception as exc:
            logger.warning("ORVA SSO could not create Employee record: %s", exc)
