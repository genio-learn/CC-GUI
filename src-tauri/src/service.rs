//! Shared access to the claude-commander `CommanderService` plus id parsing.

use std::sync::Arc;

use claude_commander::api::CommanderService;
use claude_commander::session::{ProjectId, SessionId};
use claude_commander::telemetry::FrontendInfo;
use tokio::sync::OnceCell;

static SERVICE: OnceCell<Arc<CommanderService>> = OnceCell::const_new();

pub async fn service() -> Result<&'static Arc<CommanderService>, String> {
    SERVICE
        .get_or_try_init(|| async {
            let config = claude_commander::Config::load().map_err(|e| e.to_string())?;
            let frontend = FrontendInfo::new("cc-gui", env!("CARGO_PKG_VERSION"));
            CommanderService::for_cli(config, frontend)
                .map(Arc::new)
                .map_err(|e| e.to_string())
        })
        .await
}

/// Run a service operation on a dedicated thread with its own current-thread
/// runtime. Needed because several `CommanderService` methods hold non-Send
/// gix types across awaits, and Tauri async commands require Send futures.
pub async fn with_service<T, Fut, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    Fut: std::future::Future<Output = Result<T, String>> + 'static,
    F: FnOnce(&'static Arc<CommanderService>) -> Fut + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        rt.block_on(async move {
            let svc = service().await?;
            f(svc).await
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn parse_session_id(id: &str) -> Result<SessionId, String> {
    uuid::Uuid::parse_str(id)
        .map(SessionId::from_uuid)
        .map_err(|e| format!("invalid session id {id}: {e}"))
}

pub fn parse_project_id(id: &str) -> Result<ProjectId, String> {
    uuid::Uuid::parse_str(id)
        .map(ProjectId::from_uuid)
        .map_err(|e| format!("invalid project id {id}: {e}"))
}
