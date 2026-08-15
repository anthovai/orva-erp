-- ติดตามผลการส่งจริงของ notification (โดยเฉพาะ channel email — SMTP ใน ADR 0008)
--   created = สร้างแถวแล้ว (in_app จบแค่นี้ / email = ยังไม่ได้ส่ง)
--   sent    = ส่งออกทาง SMTP สำเร็จ
--   failed  = ส่งไม่สำเร็จ (ดูรายละเอียดใน delivery_error)
alter table notifications
    add column delivery_status text not null default 'created',
    add column delivered_at timestamptz,
    add column delivery_error text;
