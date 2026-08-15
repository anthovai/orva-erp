use axum::Router;
use utoipa::openapi::security::{ApiKey, ApiKeyValue, HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};
use utoipa_swagger_ui::SwaggerUi;

use crate::{
    routes, routes_agent, routes_external, routes_intelligence, routes_modules,
    routes_notifications, routes_workflow, state::AppState,
};

struct BearerAuth;

impl Modify for BearerAuth {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("opaque session token")
                    .build(),
            ),
        );
        components.add_security_scheme(
            "service_key",
            SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::new("X-Orva-Service-Key"))),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    paths(
        routes::health,
        routes::openid_configuration,
        routes::jwks,
        routes::provision_organization,
        routes::suspend_current_organization,
        routes::set_rate_limit,
        routes::register,
        routes::login,
        routes::logout,
        routes::mfa_setup,
        routes::mfa_activate,
        routes::mfa_disable,
        routes::me,
        routes::my_permissions,
        routes::userinfo,
        routes::create_service_identity,
        routes::create_role,
        routes::grant_role_permission,
        routes::assign_role,
        routes::list_events,
        routes_workflow::create_definition,
        routes_workflow::list_definitions,
        routes_workflow::create_workflow,
        routes_workflow::get_workflow,
        routes_workflow::start_review,
        routes_workflow::advance,
        routes_workflow::complete,
        routes_workflow::my_pending_tasks,
        routes_workflow::approve_task,
        routes_workflow::reject_task,
        routes_notifications::list_notifications,
        routes_notifications::stream_notifications,
        routes_notifications::mark_read,
        routes_notifications::set_preference,
        routes_modules::list_modules,
        routes_modules::install_module,
        routes_modules::enable_module,
        routes_modules::disable_module,
        routes_external::register_module,
        routes_external::list_modules,
        routes_external::enable_module,
        routes_external::disable_module,
        routes_external::proxy,
        routes_agent::publish_event,
        routes_intelligence::list_recommendations,
        routes_intelligence::accept_recommendation,
        routes_intelligence::dismiss_recommendation,
        routes_intelligence::create_rule,
        routes_intelligence::list_rules,
        routes_intelligence::list_insights,
        routes_agent::context,
        routes_agent::propose_workflow,
        routes_agent::get_workflow,
    ),
    components(schemas(
        routes::TokenResponse,
        routes::ProvisionOrganizationRequest,
        routes::SetRateLimitRequest,
        routes::RegisterRequest,
        routes::UserResponse,
        routes::LoginRequest,
        routes::MfaSetupResponse,
        routes::MfaCodeRequest,
        routes::CreateServiceIdentityRequest,
        routes::ServiceIdentityResponse,
        routes::CreateRoleRequest,
        routes::RoleResponse,
        routes::GrantPermissionRequest,
        routes::AssignRoleRequest,
        routes::EventResponse,
        routes_workflow::CreateDefinitionRequest,
        routes_workflow::WorkflowDefinitionResponse,
        routes_workflow::CreateWorkflowRequest,
        routes_workflow::WorkflowResponse,
        routes_workflow::AdvanceWorkflowRequest,
        routes_workflow::ApprovalTaskResponse,
        routes_workflow::RejectTaskRequest,
        routes_notifications::NotificationResponse,
        routes_notifications::SetNotificationPreferenceRequest,
        orva_workflow::Rule,
        orva_workflow::RuleOperator,
        routes_modules::ModuleInfo,
        routes_modules::InstallStatus,
        routes_intelligence::CreateRuleRequest,
        routes_intelligence::RuleResponse,
        routes_intelligence::InsightResponse,
        routes_intelligence::RecommendationResponse,
        routes_external::RegisterExternalModuleRequest,
        routes_external::ExternalModuleResponse,
        routes_agent::PublishEventRequest,
        routes_agent::PublishEventResponse,
        routes_agent::AgentContextResponse,
        routes_agent::ProposeWorkflowRequest,
    )),
    modifiers(&BearerAuth),
    tags(
        (name = "system", description = "Health + OIDC discovery"),
        (name = "tenant", description = "Tenant provisioning (M3)"),
        (name = "auth", description = "Identity & session (M2)"),
        (name = "identity", description = "Service identity for modules/workers"),
        (name = "authorization", description = "Role & permission management (M3)"),
        (name = "events", description = "Event log / audit trail (M5-M6)"),
        (name = "workflow", description = "Workflow engine + human approval tasks (M6)"),
        (name = "notifications", description = "In-app / email notification (M6)"),
        (name = "modules", description = "Module registry — install/enable/disable per tenant (M7)"),
        (name = "intelligence", description = "Context Engine + rules + insights (M8)"),
        (name = "agent", description = "ORVA Agent API — for ORVA Worker (OpenWorker) in a future phase (M8)"),
    ),
    info(
        title = "ORVA Core API",
        description = "ORVA ERP — Intelligence Engineered · Core Platform API (v0.1)",
        version = env!("CARGO_PKG_VERSION"),
    )
)]
struct ApiDoc;

/// `GET /api-docs/openapi.json` (spec) + `GET /docs` (Swagger UI) — M4 DoD: "มี OpenAPI docs อัตโนมัติ"
pub(crate) fn router() -> Router<AppState> {
    Router::new().merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
}
