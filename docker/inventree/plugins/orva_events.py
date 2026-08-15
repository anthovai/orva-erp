# ORVA Event Bridge plugin for InvenTree (ADR 0014/0016)
# License: MIT (เข้ากับ InvenTree)
#
# ยิง event `inventree.product.<created|updated|deleted>` เข้า ORVA Event Bus
# (`POST /api/v1/agent/events`, service key scope `agent:event:publish`) เมื่อ Part
# ถูกสร้าง/แก้/ลบ — ORVA project ลง canonical `products` อัตโนมัติ (ADR 0016)
#
# ใช้ Django signals ตรง ๆ ตอน plugin โหลด (ไม่พึ่ง EventMixin/background worker —
# deterministic กว่า และ pattern เดียวกับ orva_sso/hooks.py ฝั่ง Horilla)
# หลักการเดิม: best-effort, ห้ามทำ InvenTree พัง (daemon thread + timeout + log-only)
import logging
import os
import threading

import requests
from django.db.models.signals import post_delete, post_save
from plugin import InvenTreePlugin

logger = logging.getLogger(__name__)

EVENTS_URL = os.environ.get(
    "ORVA_EVENTS_URL", "http://host.docker.internal:8080/api/v1/agent/events"
)
SERVICE_KEY = os.environ.get("ORVA_SERVICE_KEY", "")
TIMEOUT_SECONDS = 3


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


def _part_payload(instance):
    return {
        "source_id": str(instance.pk),
        "name": getattr(instance, "name", "") or "",
        "sku": getattr(instance, "IPN", "") or "",
        "description": getattr(instance, "description", "") or "",
        "is_active": bool(getattr(instance, "active", True)),
    }


def _part_saved(sender, instance, created, **kwargs):
    _publish(
        "inventree.product.created" if created else "inventree.product.updated",
        _part_payload(instance),
    )


def _part_deleted(sender, instance, **kwargs):
    _publish("inventree.product.deleted", {"source_id": str(instance.pk)})


class OrvaEventsPlugin(InvenTreePlugin):
    """Bridge InvenTree Part changes into the ORVA Event Bus."""

    NAME = "OrvaEvents"
    SLUG = "orvaevents"
    TITLE = "ORVA Event Bridge"
    DESCRIPTION = "Publishes Part changes to the ORVA Event Bus (canonical Product sync)"
    VERSION = "0.1.0"
    AUTHOR = "ORVA"

    def __init__(self):
        super().__init__()
        try:
            from part.models import Part

            post_save.connect(_part_saved, sender=Part, dispatch_uid="orva_part_saved")
            post_delete.connect(
                _part_deleted, sender=Part, dispatch_uid="orva_part_deleted"
            )
            if not SERVICE_KEY:
                logger.info("ORVA event bridge loaded but disabled (ORVA_SERVICE_KEY not set)")
            else:
                logger.info("ORVA event bridge active -> %s", EVENTS_URL)
        except Exception as exc:  # pragma: no cover
            logger.warning("ORVA event bridge failed to register signals: %s", exc)
