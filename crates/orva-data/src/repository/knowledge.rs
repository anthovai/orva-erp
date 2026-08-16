use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{KnowledgeLink, KnowledgeNote},
    pool::{begin_tenant, Pool},
};

/// ลิงก์ที่ parse แล้วรอบันทึก (จาก `orva-knowledge`)
pub struct ParsedLink {
    pub target_kind: String,
    pub target_ref: String,
    pub to_note_id: Option<Uuid>,
}

#[derive(Clone)]
pub struct KnowledgeRepository {
    pool: Pool,
}

impl KnowledgeRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create_note(
        &self,
        organization_id: Uuid,
        title: &str,
        content: &str,
        created_by: Option<Uuid>,
    ) -> Result<KnowledgeNote> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let note = sqlx::query_as::<_, KnowledgeNote>(
            "insert into knowledge_notes (organization_id, title, content, created_by)
             values ($1, $2, $3, $4) returning *",
        )
        .bind(organization_id)
        .bind(title)
        .bind(content)
        .bind(created_by)
        .fetch_one(ttx.as_executor())
        .await
        .map_err(|e| {
            if e.to_string().contains("idx_knowledge_notes_title") {
                Error::Validation(format!("note titled '{title}' already exists"))
            } else {
                Error::Internal(format!("create knowledge note failed: {e}"))
            }
        })?;
        ttx.commit().await?;
        Ok(note)
    }

    pub async fn update_content(
        &self,
        organization_id: Uuid,
        id: Uuid,
        content: &str,
    ) -> Result<Option<KnowledgeNote>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let note = sqlx::query_as::<_, KnowledgeNote>(
            "update knowledge_notes set content = $1, updated_at = now()
             where organization_id = $2 and id = $3 and deleted_at is null returning *",
        )
        .bind(content)
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("update knowledge note failed: {e}")))?;
        ttx.commit().await?;
        Ok(note)
    }

    pub async fn find_by_id(
        &self,
        organization_id: Uuid,
        id: Uuid,
    ) -> Result<Option<KnowledgeNote>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let note = sqlx::query_as::<_, KnowledgeNote>(
            "select * from knowledge_notes
             where organization_id = $1 and id = $2 and deleted_at is null",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find knowledge note failed: {e}")))?;
        ttx.commit().await?;
        Ok(note)
    }

    pub async fn find_by_title(
        &self,
        organization_id: Uuid,
        title: &str,
    ) -> Result<Option<KnowledgeNote>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let note = sqlx::query_as::<_, KnowledgeNote>(
            "select * from knowledge_notes
             where organization_id = $1 and lower(title) = lower($2) and deleted_at is null",
        )
        .bind(organization_id)
        .bind(title)
        .fetch_optional(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("find knowledge note by title failed: {e}")))?;
        ttx.commit().await?;
        Ok(note)
    }

    pub async fn list_notes(&self, organization_id: Uuid) -> Result<Vec<KnowledgeNote>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let notes = sqlx::query_as::<_, KnowledgeNote>(
            "select * from knowledge_notes
             where organization_id = $1 and deleted_at is null order by updated_at desc",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list knowledge notes failed: {e}")))?;
        ttx.commit().await?;
        Ok(notes)
    }

    pub async fn soft_delete_note(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        // ลิงก์ขาออกของโน้ตนี้หายไปด้วย และลิงก์ขาเข้ากลับเป็น pending (โน้ตอาจถูกสร้างใหม่)
        sqlx::query("delete from knowledge_links where organization_id = $1 and from_note_id = $2")
            .bind(organization_id)
            .bind(id)
            .execute(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("delete outgoing links failed: {e}")))?;
        sqlx::query(
            "update knowledge_links set to_note_id = null
             where organization_id = $1 and to_note_id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("unresolve incoming links failed: {e}")))?;
        sqlx::query(
            "update knowledge_notes set deleted_at = now()
             where organization_id = $1 and id = $2",
        )
        .bind(organization_id)
        .bind(id)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("soft delete knowledge note failed: {e}")))?;
        ttx.commit().await?;
        Ok(())
    }

    /// แทนที่ลิงก์ขาออกทั้งหมดของโน้ต (เรียกทุกครั้งที่เนื้อหาเปลี่ยน — set ใหม่ทับ set เดิม)
    pub async fn replace_links(
        &self,
        organization_id: Uuid,
        from_note_id: Uuid,
        links: &[ParsedLink],
    ) -> Result<()> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        sqlx::query("delete from knowledge_links where organization_id = $1 and from_note_id = $2")
            .bind(organization_id)
            .bind(from_note_id)
            .execute(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("clear links failed: {e}")))?;
        for link in links {
            sqlx::query(
                "insert into knowledge_links
                    (organization_id, from_note_id, target_kind, target_ref, to_note_id)
                 values ($1, $2, $3, $4, $5)",
            )
            .bind(organization_id)
            .bind(from_note_id)
            .bind(&link.target_kind)
            .bind(&link.target_ref)
            .bind(link.to_note_id)
            .execute(ttx.as_executor())
            .await
            .map_err(|e| Error::Internal(format!("insert link failed: {e}")))?;
        }
        ttx.commit().await?;
        Ok(())
    }

    /// resolve ลิงก์ค้าง (`to_note_id is null`) ที่ชี้ชื่อโน้ตที่เพิ่งถูกสร้าง
    pub async fn resolve_pending_links(
        &self,
        organization_id: Uuid,
        title: &str,
        note_id: Uuid,
    ) -> Result<u64> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let result = sqlx::query(
            "update knowledge_links set to_note_id = $1
             where organization_id = $2 and target_kind = 'note'
               and to_note_id is null and lower(target_ref) = lower($3)",
        )
        .bind(note_id)
        .bind(organization_id)
        .bind(title)
        .execute(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("resolve pending links failed: {e}")))?;
        ttx.commit().await?;
        Ok(result.rows_affected())
    }

    /// ลิงก์ขาออกของโน้ต
    pub async fn outgoing_links(
        &self,
        organization_id: Uuid,
        from_note_id: Uuid,
    ) -> Result<Vec<KnowledgeLink>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let links = sqlx::query_as::<_, KnowledgeLink>(
            "select * from knowledge_links
             where organization_id = $1 and from_note_id = $2 order by created_at",
        )
        .bind(organization_id)
        .bind(from_note_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list outgoing links failed: {e}")))?;
        ttx.commit().await?;
        Ok(links)
    }

    /// backlinks — โน้ตอื่นที่ลิงก์มาหาโน้ตนี้
    pub async fn backlinks(
        &self,
        organization_id: Uuid,
        note_id: Uuid,
    ) -> Result<Vec<KnowledgeNote>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let notes = sqlx::query_as::<_, KnowledgeNote>(
            "select distinct n.* from knowledge_notes n
             join knowledge_links l on l.from_note_id = n.id
             where l.organization_id = $1 and l.to_note_id = $2 and n.deleted_at is null",
        )
        .bind(organization_id)
        .bind(note_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list backlinks failed: {e}")))?;
        ttx.commit().await?;
        Ok(notes)
    }

    /// ลิงก์ทั้งหมดขององค์กร (สำหรับ knowledge graph)
    pub async fn all_links(&self, organization_id: Uuid) -> Result<Vec<KnowledgeLink>> {
        let mut ttx = begin_tenant(&self.pool, organization_id).await?;
        let links = sqlx::query_as::<_, KnowledgeLink>(
            "select l.* from knowledge_links l
             join knowledge_notes n on n.id = l.from_note_id
             where l.organization_id = $1 and n.deleted_at is null",
        )
        .bind(organization_id)
        .fetch_all(ttx.as_executor())
        .await
        .map_err(|e| Error::Internal(format!("list all links failed: {e}")))?;
        ttx.commit().await?;
        Ok(links)
    }
}
