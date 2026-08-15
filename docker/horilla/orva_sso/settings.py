# ORVA SSO settings overlay (ADR 0014 Phase 2) — ไม่แตะ source ของ Horilla เลย:
# ใช้ DJANGO_SETTINGS_MODULE=orva_sso.settings แล้ว extend MIDDLEWARE ต่อท้าย
# Distributed under LGPL-2.1 to match Horilla's license.
from horilla.settings import *  # noqa: F401,F403

from horilla.settings import MIDDLEWARE as _BASE_MIDDLEWARE

# ต้องอยู่หลัง AuthenticationMiddleware (ต้องมี request.user/session ก่อน)
MIDDLEWARE = list(_BASE_MIDDLEWARE) + ["orva_sso.middleware.OrvaSSOMiddleware"]
