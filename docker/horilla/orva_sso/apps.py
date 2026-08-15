# Distributed under LGPL-2.1 to match Horilla's license.
from django.apps import AppConfig


class OrvaSsoConfig(AppConfig):
    name = "orva_sso"
    verbose_name = "ORVA SSO + Event Hooks"

    def ready(self):
        # ลงทะเบียน Django signal hooks (Horilla -> ORVA Event Bus) ตอน app โหลดเสร็จ
        from . import hooks  # noqa: F401
