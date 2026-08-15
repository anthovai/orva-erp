//! Canonical entities ที่ยังไม่ implement เต็ม (ดู MILESTONES.md M1)
//!
//! นิยามชื่อ/ตำแหน่งไว้ก่อนตาม ARCHITECTURE.md §8 เพื่อกันโมดูลธุรกิจในอนาคต
//! นิยามเอนทิตีเดียวกันซ้ำคนละแบบ — ยังไม่มีตาราง ไม่มี field ยังไม่ใช้งานจริง

macro_rules! not_yet_implemented_entity {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy)]
        pub struct $name;
    };
}

// Employee implement จริงแล้ว (ADR 0016) — ดู orva_data::Employee
not_yet_implemented_entity!(Customer);
not_yet_implemented_entity!(Vendor);
// Product implement จริงแล้ว (ADR 0016) — ดู orva_data::Product
not_yet_implemented_entity!(Project);
not_yet_implemented_entity!(Invoice);
not_yet_implemented_entity!(Transaction);
not_yet_implemented_entity!(Ticket);
