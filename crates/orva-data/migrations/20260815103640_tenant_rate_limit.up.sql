-- Per-tenant rate limit (ADR 0012) — จำกัดจำนวน request ต่อนาทีของทั้งองค์กร
-- null = ใช้ค่า default ของระบบ (ดู core::rate_limit::DEFAULT_TENANT_REQUESTS_PER_MINUTE)
alter table organizations
    add column rate_limit_per_minute integer
    check (rate_limit_per_minute is null or rate_limit_per_minute > 0);
