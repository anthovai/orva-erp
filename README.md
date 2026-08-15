# ORVA ERP — Intelligence Engineered

Intelligence-engineered business platform — built from open foundations, unified through a single intelligent core.

**สถานะ: ORVA Core v0.1 🏁 เสร็จสมบูรณ์** (M0–M8) — ดู [docs/MILESTONES.md](docs/MILESTONES.md)

## เอกสาร

- [Architecture](docs/ARCHITECTURE.md) — สถาปัตยกรรม 3 ชั้น (Core / Intelligence / Workers)
- [Milestones](docs/MILESTONES.md) — แผนพัฒนา ORVA Core v0.1 (M0–M8, เสร็จครบ)
- [OSS Strategy](docs/OSS-STRATEGY.md) — เกณฑ์คัดเลือกและประกอบ Open Source เป็น ORVA Modules
- [ADR](docs/adr/README.md) — บันทึกการตัดสินใจเชิงสถาปัตยกรรม

## โครงสร้าง

```
orva-erp/
├── core/                    # orva-core — API server (Rust, axum)
├── crates/
│   ├── orva-config          # configuration loading
│   ├── orva-error           # shared error type
│   ├── orva-data            # canonical entities + repositories (M1)
│   ├── orva-auth            # identity, session, authorization (M2-M3)
│   ├── orva-events          # in-process event bus (M5)
│   ├── orva-workflow        # workflow engine + approval tasks (M6)
│   ├── orva-notifications   # in-app/email notification (M6)
│   ├── orva-module-sdk      # module contract SDK (M7)
│   ├── orva-module-notes    # reference module — Notes (M7)
│   └── orva-intelligence    # context engine + rules + insights (M8)
├── modules/                 # business modules OSS (Phase ถัดไป — ดู OSS-STRATEGY.md)
├── config/                  # configuration files
└── docs/                    # architecture, milestones, ADR
```

## เริ่มพัฒนา

ต้องมี: Rust (stable), Docker

```bash
# database สำหรับ dev
docker compose up -d

# build + test
cargo build --workspace
cargo test --workspace

# รัน API server (http://127.0.0.1:8080/health)
cargo run -p orva-core
```

ตั้งค่าใน [config/default.toml](config/default.toml) — override ด้วย env `ORVA_SERVER_HOST`, `ORVA_SERVER_PORT`, `ORVA_DATABASE_URL`, `ORVA_JWT_SECRET`

## API

- Swagger UI: `http://127.0.0.1:8080/docs`
- OpenAPI spec: `http://127.0.0.1:8080/api-docs/openapi.json`

## Phase ถัดไป

Core v0.1 พร้อมแล้ว — ขั้นต่อไปคือเลือก OSS มาประกอบเป็น Business Modules ตาม [OSS-STRATEGY.md](docs/OSS-STRATEGY.md) (Horilla สำหรับ HRM/CRM, InvenTree สำหรับ Inventory ฯลฯ) และเชื่อม ORVA Worker (OpenWorker) ผ่าน ORVA Agent API ที่วางไว้แล้วใน M8
