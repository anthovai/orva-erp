//! สกัดลิงก์ `[[...]]` จากเนื้อหาโน้ต — ไม่ใช้ regex (คงจำนวน dependency ให้ต่ำ)

/// เป้าหมายของลิงก์หนึ่งตัวในเนื้อหา
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkTarget {
    /// `[[ชื่อโน้ต]]`
    Note(String),
    /// `[[employee:email@x]]` — canonical Employee (ref = email)
    Employee(String),
    /// `[[product:SKU-1]]` — canonical Product (ref = sku)
    Product(String),
}

/// สแกนหา `[[...]]` ทั้งหมด — ลิงก์ว่าง/ซ้ำถูกตัดทิ้ง, ชื่อถูก trim
pub fn parse_links(content: &str) -> Vec<LinkTarget> {
    let mut found = Vec::new();
    let mut rest = content;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let inner = after[..end].trim();
        if !inner.is_empty() && !inner.contains("[[") {
            let target = if let Some(email) = inner.strip_prefix("employee:") {
                LinkTarget::Employee(email.trim().to_string())
            } else if let Some(sku) = inner.strip_prefix("product:") {
                LinkTarget::Product(sku.trim().to_string())
            } else {
                LinkTarget::Note(inner.to_string())
            };
            if !found.contains(&target) {
                found.push(target);
            }
        }
        rest = &after[end + 2..];
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_note_entity_links_and_dedupes() {
        let content = "\
เราคุยเรื่อง [[Q3 Planning]] กับ [[employee:somchai@x.test]] แล้ว\n\
สินค้า [[product:BOLT-M3]] ต้องสั่งเพิ่ม — ดู [[Q3 Planning]] อีกครั้ง\n\
ลิงก์ว่าง [[  ]] และ [[broken ต้องถูกข้าม";
        assert_eq!(
            parse_links(content),
            vec![
                LinkTarget::Note("Q3 Planning".to_string()),
                LinkTarget::Employee("somchai@x.test".to_string()),
                LinkTarget::Product("BOLT-M3".to_string()),
            ]
        );
    }

    #[test]
    fn empty_content_has_no_links() {
        assert!(parse_links("no links here").is_empty());
        assert!(parse_links("").is_empty());
    }
}
