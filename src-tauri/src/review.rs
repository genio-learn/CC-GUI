//! Review diff + comment commands.

use claude_commander::api::NewComment;
use claude_commander::comment::{ApplyOutcome, CommentSide};

use crate::service::{parse_session_id, with_service};

/// Open the review diff for a session: parsed base→working-tree diff plus the
/// session's re-anchored comments.
#[tauri::command]
pub async fn open_review(id: String) -> Result<claude_commander::api::ReviewSnapshot, String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move { svc.open_review(&id).await.map_err(|e| e.to_string()) })
        .await
}

/// Stage a review comment. `side` is "old" or "new"; `line_range` is the
/// inclusive range on that side; `snippet` re-anchors the comment if the diff
/// changes. Returns the new comment's id.
#[tauri::command]
pub async fn create_comment(
    id: String,
    file: String,
    side: String,
    line_range: (usize, usize),
    snippet: String,
    comment: String,
) -> Result<String, String> {
    let id = parse_session_id(&id)?;
    let side = match side.as_str() {
        "old" => CommentSide::Old,
        "new" => CommentSide::New,
        other => return Err(format!("invalid comment side {other:?}")),
    };
    with_service(move |svc| async move {
        let draft = NewComment {
            file,
            side,
            line_range,
            snippet,
            comment,
        };
        svc.create_comment(&id, draft)
            .await
            .map(|uuid| uuid.to_string())
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn delete_comment(id: String, comment_id: String) -> Result<(), String> {
    let id = parse_session_id(&id)?;
    let comment_id = uuid::Uuid::parse_str(&comment_id).map_err(|e| e.to_string())?;
    with_service(move |svc| async move {
        svc.delete_comment(&id, comment_id)
            .await
            .map_err(|e| e.to_string())
    })
    .await
}

/// Apply staged comments: composes the markdown brief and injects a pointer
/// prompt into the session's pane (delivery gated on agent state). May block
/// up to the library's hold timeout while a permission prompt clears.
#[tauri::command]
pub async fn apply_comments(id: String) -> Result<ApplyOutcome, String> {
    let id = parse_session_id(&id)?;
    with_service(move |svc| async move { svc.apply_comments(&id).await.map_err(|e| e.to_string()) })
        .await
}
