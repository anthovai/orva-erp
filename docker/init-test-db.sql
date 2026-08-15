-- สร้างฐานข้อมูลแยกสำหรับ integration test ของ orva-data (กันไม่ให้ปนกับข้อมูล dev)
CREATE DATABASE orva_test;

-- Role ที่แอปใช้เชื่อมต่อจริง — ต้องไม่ใช่ superuser ไม่งั้น Row-Level Security ถูกข้ามหมด
-- (`orva` ที่ postgres image สร้างให้เป็น superuser — เก็บไว้เป็น admin/ops เท่านั้น)
-- membership ใน role `orva` ให้สิทธิ์ ownership (รัน migration ได้) แต่ attribute
-- SUPERUSER/BYPASSRLS ไม่ถูกส่งต่อผ่าน membership — ดู ADR 0005
-- รหัสผ่านนี้ใช้สำหรับ dev เท่านั้น — production ต้องตั้งใหม่เสมอ
CREATE ROLE orva_app LOGIN PASSWORD 'orva' NOSUPERUSER NOBYPASSRLS IN ROLE orva;
