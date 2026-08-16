use serde::Serialize;
use uuid::Uuid;

use orva_data::{KnowledgeLink, KnowledgeNote, KnowledgeRepository, ParsedLink, Pool};
use orva_error::{Error, Result};
use orva_events::{EventBus, PublishOptions};

use crate::parser::{parse_links, LinkTarget};

/// โน้ตพร้อมลิงก์สองทาง — payload หลักของ `GET /api/v1/knowledge/notes/{id}`
#[derive(Debug, Serialize)]
pub struct NoteWithLinks {
    pub note: KnowledgeNote,
    pub links: Vec<KnowledgeLink>,
    pub backlinks: Vec<KnowledgeNote>,
}

/// กราฟความรู้ทั้งองค์กร — nodes = โน้ต + canonical entity ที่ถูกอ้าง, edges = ลิงก์
#[derive(Debug, Serialize)]
pub struct KnowledgeGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Serialize)]
pub struct GraphNode {
    /// โน้ต = note id, entity = `<kind>:<ref>` (ไม่มีแถวโน้ตให้ชี้)
    pub id: String,
    pub kind: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
}

pub struct KnowledgeService {
    repo: KnowledgeRepository,
    events: EventBus,
}

impl KnowledgeService {
    pub fn new(pool: Pool, events: EventBus) -> Self {
        Self {
            repo: KnowledgeRepository::new(pool),
            events,
        }
    }

    /// สร้างโน้ต: parse ลิงก์จากเนื้อหา, resolve หาโน้ตที่มีอยู่, บันทึก, แล้ว
    /// resolve ลิงก์ค้างของโน้ตอื่นที่เคยชี้ชื่อนี้ไว้ล่วงหน้า
    pub async fn create_note(
        &self,
        organization_id: Uuid,
        title: &str,
        content: &str,
        created_by: Option<Uuid>,
    ) -> Result<NoteWithLinks> {
        let title = title.trim();
        if title.is_empty() {
            return Err(Error::Validation("title must not be empty".to_string()));
        }

        let note = self
            .repo
            .create_note(organization_id, title, content, created_by)
            .await?;
        self.store_links(organization_id, &note, content).await?;

        let resolved = self
            .repo
            .resolve_pending_links(organization_id, title, note.id)
            .await?;

        self.events
            .publish(
                organization_id,
                "knowledge.note.created",
                serde_json::json!({
                    "note_id": note.id,
                    "title": note.title,
                    "resolved_backlinks": resolved,
                }),
                PublishOptions {
                    actor_user_id: created_by,
                    resource: Some(("knowledge_note".to_string(), note.id)),
                    ..Default::default()
                },
            )
            .await?;

        self.get_note(organization_id, note.id).await
    }

    /// แก้เนื้อหา — ลิงก์ขาออกถูก parse ใหม่ทั้ง set
    pub async fn update_note(
        &self,
        organization_id: Uuid,
        id: Uuid,
        content: &str,
        updated_by: Option<Uuid>,
    ) -> Result<NoteWithLinks> {
        let note = self
            .repo
            .update_content(organization_id, id, content)
            .await?
            .ok_or_else(|| Error::NotFound(format!("knowledge note '{id}'")))?;
        self.store_links(organization_id, &note, content).await?;

        self.events
            .publish(
                organization_id,
                "knowledge.note.updated",
                serde_json::json!({ "note_id": note.id, "title": note.title }),
                PublishOptions {
                    actor_user_id: updated_by,
                    resource: Some(("knowledge_note".to_string(), note.id)),
                    ..Default::default()
                },
            )
            .await?;

        self.get_note(organization_id, id).await
    }

    pub async fn delete_note(
        &self,
        organization_id: Uuid,
        id: Uuid,
        deleted_by: Option<Uuid>,
    ) -> Result<()> {
        self.repo
            .find_by_id(organization_id, id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("knowledge note '{id}'")))?;
        self.repo.soft_delete_note(organization_id, id).await?;
        self.events
            .publish(
                organization_id,
                "knowledge.note.deleted",
                serde_json::json!({ "note_id": id }),
                PublishOptions {
                    actor_user_id: deleted_by,
                    resource: Some(("knowledge_note".to_string(), id)),
                    ..Default::default()
                },
            )
            .await?;
        Ok(())
    }

    pub async fn list_notes(&self, organization_id: Uuid) -> Result<Vec<KnowledgeNote>> {
        self.repo.list_notes(organization_id).await
    }

    pub async fn get_note(&self, organization_id: Uuid, id: Uuid) -> Result<NoteWithLinks> {
        let note = self
            .repo
            .find_by_id(organization_id, id)
            .await?
            .ok_or_else(|| Error::NotFound(format!("knowledge note '{id}'")))?;
        let links = self.repo.outgoing_links(organization_id, id).await?;
        let backlinks = self.repo.backlinks(organization_id, id).await?;
        Ok(NoteWithLinks {
            note,
            links,
            backlinks,
        })
    }

    /// กราฟทั้งองค์กร — โน้ตทุกใบเป็น node เสมอ (แม้ไม่มีลิงก์), entity ที่ถูกอ้าง
    /// เป็น node เพิ่ม, ลิงก์ note ที่ยังไม่ resolve เป็น node ชนิด `missing`
    /// (ธรรมเนียม knowledge graph — เห็นได้ว่าความรู้ตรงไหนยังไม่ถูกเขียน)
    pub async fn graph(&self, organization_id: Uuid) -> Result<KnowledgeGraph> {
        let notes = self.repo.list_notes(organization_id).await?;
        let links = self.repo.all_links(organization_id).await?;

        let mut nodes: Vec<GraphNode> = notes
            .iter()
            .map(|n| GraphNode {
                id: n.id.to_string(),
                kind: "note".to_string(),
                label: n.title.clone(),
            })
            .collect();
        let mut edges = Vec::new();

        for link in &links {
            let to_id = match (&link.to_note_id, link.target_kind.as_str()) {
                (Some(note_id), _) => note_id.to_string(),
                (None, "note") => format!("missing:{}", link.target_ref.to_lowercase()),
                (None, kind) => format!("{kind}:{}", link.target_ref),
            };
            if link.to_note_id.is_none() {
                let kind = if link.target_kind == "note" {
                    "missing"
                } else {
                    link.target_kind.as_str()
                };
                if !nodes.iter().any(|n| n.id == to_id) {
                    nodes.push(GraphNode {
                        id: to_id.clone(),
                        kind: kind.to_string(),
                        label: link.target_ref.clone(),
                    });
                }
            }
            edges.push(GraphEdge {
                from: link.from_note_id.to_string(),
                to: to_id,
                kind: link.target_kind.clone(),
            });
        }

        Ok(KnowledgeGraph { nodes, edges })
    }

    async fn store_links(
        &self,
        organization_id: Uuid,
        note: &KnowledgeNote,
        content: &str,
    ) -> Result<()> {
        let mut parsed = Vec::new();
        for target in parse_links(content) {
            let link = match target {
                LinkTarget::Note(title) => {
                    // ลิงก์หาตัวเองไม่นับ
                    if title.eq_ignore_ascii_case(&note.title) {
                        continue;
                    }
                    let resolved = self
                        .repo
                        .find_by_title(organization_id, &title)
                        .await?
                        .map(|n| n.id);
                    ParsedLink {
                        target_kind: "note".to_string(),
                        target_ref: title,
                        to_note_id: resolved,
                    }
                }
                LinkTarget::Employee(email) => ParsedLink {
                    target_kind: "employee".to_string(),
                    target_ref: email,
                    to_note_id: None,
                },
                LinkTarget::Product(sku) => ParsedLink {
                    target_kind: "product".to_string(),
                    target_ref: sku,
                    to_note_id: None,
                },
            };
            parsed.push(link);
        }
        self.repo
            .replace_links(organization_id, note.id, &parsed)
            .await
    }
}
