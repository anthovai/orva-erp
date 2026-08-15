# ADR 0002 — OIDC Foundation ใช้ HS256 + Password Grant ใน v0.1

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

M2 (Identity & Authentication) ต้องวาง "OIDC provider foundation" ตาม [MILESTONES.md](../MILESTONES.md) แต่ ณ ตอนนี้ยังไม่มี OSS module หรือ relying party ภายนอกจริงมาเชื่อม SSO (ตั้งใจไม่ต่อ Module ในรอบพัฒนา M2) การสร้าง Authorization Code flow แบบ redirect เต็มรูปแบบ + RS256/JWKS โดยไม่มีอะไรมาทดสอบจริงเสี่ยงต่อการออกแบบผิดทิศทางและเสียเวลาไปกับสิ่งที่ยังพิสูจน์ไม่ได้

## Decision

1. **ใช้ HS256 (shared secret)** สำหรับเซ็น ID token แทน RS256 — secret มาจาก `ORVA_JWT_SECRET` (มี default ไม่ปลอดภัยสำหรับ dev เท่านั้น) เหตุผล: RS256 มีประโยชน์ตอนมี relying party ภายนอกที่ต้อง verify token เองผ่าน JWKS endpoint สาธารณะ ซึ่งยังไม่มีอยู่จริง
2. **Token endpoint ใช้ credential ตรง ๆ** (`POST /api/v1/auth/login` รับ email+password คืน session token + id_token) แทน Authorization Code + redirect + consent screen เหตุผล: ไม่มี login UI/relying party จริงให้ทดสอบ redirect flow ตอนนี้ — Unified UI ยังไม่ถูกสร้าง (อยู่ Phase หลัง)
3. Discovery document (`/.well-known/openid-configuration`) และ userinfo endpoint (`/api/v1/auth/userinfo`) ยังคงสร้างไว้ตามสเปก OIDC เพื่อให้โครงพร้อมขยาย

## Consequences

- Token ที่ออกตอนนี้ verify ได้เฉพาะฝั่ง ORVA เอง (มี secret เดียวกัน) — โมดูลภายนอกจะ verify เองไม่ได้จนกว่าจะย้ายเป็น RS256
- เมื่อเริ่มต่อ OSS module จริง (M7 หรือเร็วกว่านั้นถ้าจำเป็น) ต้อง:
  - ย้ายเป็น RS256 + เปิด JWKS endpoint (`/.well-known/jwks.json`)
  - เพิ่ม `authorization_endpoint` แบบ redirect จริง + หน้า login/consent (ต้องมี Unified UI หรืออย่างน้อย minimal login page)
  - เพิ่ม OAuth client registry (`oauth_clients` table) ให้แต่ละ module ลงทะเบียนเป็น relying party
- เก็บ "ทดสอบ SSO กับ OSS module จริง" เป็นงานค้างใน M2 (ดู [MILESTONES.md](../MILESTONES.md)) จนกว่าจะถึงตอนนั้น
