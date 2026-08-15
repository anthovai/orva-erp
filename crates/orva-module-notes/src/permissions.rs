use orva_module_sdk::{ModulePermission, PermissionKey};

pub const MODULE_NAME: &str = "notes";

pub struct DocumentManage;
impl PermissionKey for DocumentManage {
    const KEY: &'static str = "notes.document.manage";
}
impl ModulePermission for DocumentManage {
    const MODULE_NAME: &'static str = MODULE_NAME;
}

pub struct DocumentRead;
impl PermissionKey for DocumentRead {
    const KEY: &'static str = "notes.document.read";
}
impl ModulePermission for DocumentRead {
    const MODULE_NAME: &'static str = MODULE_NAME;
}
