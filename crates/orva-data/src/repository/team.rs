use orva_error::{Error, Result};
use uuid::Uuid;

use crate::{
    entity::{Team, TeamMember},
    pool::Pool,
};

pub struct TeamRepository {
    pool: Pool,
}

impl TeamRepository {
    pub fn new(pool: Pool) -> Self {
        Self { pool }
    }

    pub async fn create(
        &self,
        organization_id: Uuid,
        name: &str,
        created_by: Option<Uuid>,
    ) -> Result<Team> {
        sqlx::query_as::<_, Team>(
            "insert into teams (organization_id, name, created_by) values ($1, $2, $3) returning *",
        )
        .bind(organization_id)
        .bind(name)
        .bind(created_by)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("create team failed: {e}")))
    }

    pub async fn find_by_id(&self, organization_id: Uuid, id: Uuid) -> Result<Option<Team>> {
        sqlx::query_as::<_, Team>(
            "select * from teams where organization_id = $1 and id = $2 and deleted_at is null",
        )
        .bind(organization_id)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("find team failed: {e}")))
    }

    pub async fn list(&self, organization_id: Uuid) -> Result<Vec<Team>> {
        sqlx::query_as::<_, Team>(
            "select * from teams where organization_id = $1 and deleted_at is null order by created_at",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list teams failed: {e}")))
    }

    pub async fn soft_delete(&self, organization_id: Uuid, id: Uuid) -> Result<()> {
        sqlx::query("update teams set deleted_at = now() where organization_id = $1 and id = $2")
            .bind(organization_id)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("soft delete team failed: {e}")))?;
        Ok(())
    }

    pub async fn add_member(&self, team_id: Uuid, user_id: Uuid, role: &str) -> Result<TeamMember> {
        sqlx::query_as::<_, TeamMember>(
            "insert into team_members (team_id, user_id, role) values ($1, $2, $3)
             on conflict (team_id, user_id) do update set role = excluded.role
             returning *",
        )
        .bind(team_id)
        .bind(user_id)
        .bind(role)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("add team member failed: {e}")))
    }

    pub async fn list_members(&self, team_id: Uuid) -> Result<Vec<TeamMember>> {
        sqlx::query_as::<_, TeamMember>(
            "select * from team_members where team_id = $1 order by created_at",
        )
        .bind(team_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| Error::Internal(format!("list team members failed: {e}")))
    }

    pub async fn remove_member(&self, team_id: Uuid, user_id: Uuid) -> Result<()> {
        sqlx::query("delete from team_members where team_id = $1 and user_id = $2")
            .bind(team_id)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(|e| Error::Internal(format!("remove team member failed: {e}")))?;
        Ok(())
    }
}
