# ADR 0007 — MFA ด้วย TOTP แบบ inline ใน login (ไม่ใช่ two-step challenge)

- **สถานะ**: Accepted (2026-08-15)
- **เกี่ยวข้อง**: `orva_auth::totp`, `/api/v1/auth/mfa/*`, migration `identity` (M2 — คอลัมน์รออยู่แล้ว)

## บริบท

Schema `users` มี `mfa_enabled`/`mfa_secret` ตั้งแต่ M2 แต่ยังไม่มี logic
ต้องเลือกรูปแบบ protocol ของ MFA ตอน login:

1. **Inline** (เลือก) — `POST /auth/login` รับ `totp_code` เป็น field optional
2. Two-step challenge — login คืน challenge token แล้วแลก token จริงอีกขั้น

เลือก inline เพราะ client ปัจจุบันเป็น API-first (ยังไม่มี Unified UI) —
flow สองขั้นเพิ่ม state (challenge token + TTL + storage) โดยยังไม่มี UI ที่ได้
ประโยชน์จากมัน ค่อยยกระดับเป็น two-step เมื่อทำ Authorization Code flow จริง

## การตัดสินใจ

### Protocol

- TOTP ตาม RFC 6238 ค่ามาตรฐาน authenticator app: **SHA-1, 6 หลัก, 30 วินาที,
  skew ±1 ช่วง** (ห่อ `totp-rs`)
- login: ตรวจ TOTP **หลังรหัสผ่านถูกเท่านั้น** — ไม่ leak ว่า user ไหนเปิด MFA
  - MFA เปิด + ไม่ส่ง code → **400** `totp_code required` (บอก client ให้ถาม code)
  - MFA เปิด + code ผิด → **401** (เหมือน credential ผิดทั่วไป)

### Lifecycle (self-service ทั้งหมด — ไม่มี permission พิเศษ)

| ขั้น | endpoint | ผล |
|---|---|---|
| setup | `POST /auth/mfa/setup` | ออก secret ใหม่ (base32) + `otpauth://` URI — สถานะ **pending**, login ยังไม่ถูกบังคับ |
| activate | `POST /auth/mfa/activate` + code | ยืนยัน code แรกสำเร็จ → `mfa_enabled = true` |
| disable | `POST /auth/mfa/disable` + code | ต้องยืนยัน code ปัจจุบัน → ปิด + **ล้าง secret ทิ้ง** |

- pending state กัน user ล็อกตัวเองออก (setup แล้วแต่ยังไม่ทันสแกน QR)
- disable ต้องมี code — session ที่ถูกขโมยปิด MFA เองไม่ได้
- เปิดใหม่หลัง disable ต้อง setup secret ใหม่เสมอ (secret เก่าถูกล้าง)
- activate/disable publish event `user.mfa_enabled`/`user.mfa_disabled` เข้า audit log

## ผลลัพธ์

- พิสูจน์ครบวงจรใน `core/tests/mfa_flow.rs` (test เล่นบท authenticator app —
  คำนวณ code จริงจาก secret) + dev tool `cargo run -p orva-auth --example totp_code`
- สิ่งที่ยังไม่ทำ (ตั้งใจ — บันทึกเป็น known gap):
  - **Recovery code** — user ทำเครื่องหาย = ล็อกถาวร ต้องให้ admin แก้ที่ DB ตรง ๆ
  - **Replay protection ภายในช่วงเวลาเดียว** — code เดิมใช้ซ้ำได้ภายใน ~30-90 วิ
    (ยังไม่เก็บ last-used timestep)
  - **Secret เก็บ plaintext ใน DB** — ควร encrypt at rest เมื่อมี KMS/secret แผนกลาง
