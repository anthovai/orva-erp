# ORVA event hooks for Horilla (ADR 0014 — ขากลับ: Horilla -> ORVA Event Bus)
# Distributed under LGPL-2.1 to match Horilla's license.
#
# Django post_save/post_delete signals บน model สำคัญ -> POST /api/v1/agent/events
# ด้วย service key (scope `agent:event:publish`) — event เข้า audit log ของ ORVA
# และ Intelligence Engine ประเมิน rule ที่เฝ้า event_type นั้นทันที
#
# หลักการ: **best-effort, ห้ามทำ Horilla พัง** — ส่งใน daemon thread, timeout สั้น,
# error แค่ log ไม่ propagate; ไม่ตั้ง ORVA_SERVICE_KEY = ปิด hook ทั้งหมด (log ครั้งเดียว)
import logging
import os
import threading

import requests
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

EVENTS_URL = os.environ.get(
    "ORVA_EVENTS_URL", "http://host.docker.internal:8080/api/v1/agent/events"
)
SERVICE_KEY = os.environ.get("ORVA_SERVICE_KEY", "")
TIMEOUT_SECONDS = 3

if not SERVICE_KEY:
    logger.info("ORVA event hooks disabled (ORVA_SERVICE_KEY not set)")


def _publish(event_type, payload):
    if not SERVICE_KEY:
        return

    def send():
        try:
            response = requests.post(
                EVENTS_URL,
                json={"event_type": event_type, "payload": payload},
                headers={"X-Orva-Service-Key": SERVICE_KEY},
                timeout=TIMEOUT_SECONDS,
            )
            if response.status_code != 201:
                logger.warning(
                    "ORVA event %s rejected: %s %s",
                    event_type,
                    response.status_code,
                    response.text[:200],
                )
        except Exception as exc:
            logger.warning("ORVA event %s failed: %s", event_type, exc)

    threading.Thread(target=send, daemon=True).start()


# ---- Employee ----
from employee.models import Employee  # noqa: E402


@receiver(post_save, sender=Employee)
def employee_saved(sender, instance, created, **kwargs):
    _publish(
        "horilla.employee.created" if created else "horilla.employee.updated",
        {
            # `source_id` = contract กลางของ canonical projection (orva-sync)
            "source_id": str(instance.pk),
            "horilla_employee_id": instance.pk,
            "email": getattr(instance, "email", "") or "",
            "first_name": getattr(instance, "employee_first_name", "") or "",
            "last_name": getattr(instance, "employee_last_name", "") or "",
            "is_active": getattr(instance, "is_active", True),
        },
    )


@receiver(post_delete, sender=Employee)
def employee_deleted(sender, instance, **kwargs):
    _publish(
        "horilla.employee.deleted",
        {
            "source_id": str(instance.pk),
            "horilla_employee_id": instance.pk,
            "email": getattr(instance, "email", "") or "",
        },
    )


# ---- Leave requests (optional — โครงสร้าง Horilla บางรุ่นอาจต่าง จึง import แบบกันพลาด) ----
try:
    from leave.models import LeaveRequest  # noqa: E402

    @receiver(post_save, sender=LeaveRequest)
    def leave_request_saved(sender, instance, created, **kwargs):
        _publish(
            "horilla.leave_request.created" if created else "horilla.leave_request.updated",
            {
                "horilla_leave_request_id": instance.pk,
                "status": getattr(instance, "status", "") or "",
                "employee_id": getattr(instance, "employee_id_id", None),
                "start_date": str(getattr(instance, "start_date", "") or ""),
                "end_date": str(getattr(instance, "end_date", "") or ""),
            },
        )

except Exception as exc:  # pragma: no cover
    logger.warning("ORVA leave hooks not registered: %s", exc)


# ---- Attendance (optional) ----
try:
    from attendance.models import Attendance  # noqa: E402

    @receiver(post_save, sender=Attendance)
    def attendance_saved(sender, instance, created, **kwargs):
        if not created:
            return  # อัปเดต attendance ถี่มาก — ส่งเฉพาะตอนเกิดใหม่พอ
        _publish(
            "horilla.attendance.created",
            {
                "horilla_attendance_id": instance.pk,
                "employee_id": getattr(instance, "employee_id_id", None),
                "attendance_date": str(getattr(instance, "attendance_date", "") or ""),
            },
        )

except Exception as exc:  # pragma: no cover
    logger.warning("ORVA attendance hooks not registered: %s", exc)
