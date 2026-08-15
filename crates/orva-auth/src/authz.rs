use std::collections::HashSet;

use uuid::Uuid;

/// Policy engine ขั้นพื้นฐาน — เงื่อนไขเพิ่มเติมนอกเหนือจาก role/permission เช่น "owner-only"
///
/// permission ตอบคำถามว่า "ทำ action นี้ได้ไหม" ส่วน policy ตอบคำถามว่า "ทำกับ resource
/// ชิ้นนี้ได้ไหม" — ทั้งสองอย่างต้องผ่านถึงจะอนุญาต (ดู [`Authorizer::check`])
pub trait Policy {
    fn allows(&self, ctx: &PolicyContext) -> bool;
}

pub struct PolicyContext {
    pub user_id: Uuid,
    pub resource_owner_id: Option<Uuid>,
}

/// อนุญาตเฉพาะเจ้าของ resource เอง (`created_by` ตรงกับ user ที่เรียก)
pub struct OwnerOnly;

impl Policy for OwnerOnly {
    fn allows(&self, ctx: &PolicyContext) -> bool {
        ctx.resource_owner_id == Some(ctx.user_id)
    }
}

/// permission key ทั้งหมดที่ user มีในองค์กรหนึ่ง ๆ (โหลดจาก `RoleRepository::permission_keys_for_user`)
#[derive(Debug, Clone, Default)]
pub struct PermissionSet(HashSet<String>);

impl PermissionSet {
    pub fn new(keys: Vec<String>) -> Self {
        Self(keys.into_iter().collect())
    }

    pub fn has(&self, key: &str) -> bool {
        self.0.contains(key)
    }

    pub fn into_keys(self) -> Vec<String> {
        self.0.into_iter().collect()
    }
}

pub struct Authorizer;

impl Authorizer {
    /// ตรวจ permission เสมอ + ตรวจ policy เพิ่มถ้ามี (ทั้งคู่ต้องผ่าน)
    pub fn check(
        permissions: &PermissionSet,
        required_permission: &str,
        policy: Option<(&dyn Policy, &PolicyContext)>,
    ) -> bool {
        if !permissions.has(required_permission) {
            return false;
        }
        match policy {
            Some((policy, ctx)) => policy.allows(ctx),
            None => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_permission_first() {
        let perms = PermissionSet::new(vec!["core.team.manage".to_string()]);
        assert!(Authorizer::check(&perms, "core.team.manage", None));
        assert!(!Authorizer::check(&perms, "core.role.manage", None));
    }

    #[test]
    fn policy_can_still_reject_after_permission_passes() {
        let perms = PermissionSet::new(vec!["core.document.delete".to_string()]);
        let user_id = Uuid::new_v4();
        let ctx = PolicyContext {
            user_id,
            resource_owner_id: Some(Uuid::new_v4()),
        };
        assert!(!Authorizer::check(
            &perms,
            "core.document.delete",
            Some((&OwnerOnly, &ctx))
        ));

        let ctx_owner = PolicyContext {
            user_id,
            resource_owner_id: Some(user_id),
        };
        assert!(Authorizer::check(
            &perms,
            "core.document.delete",
            Some((&OwnerOnly, &ctx_owner))
        ));
    }
}
