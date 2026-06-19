//! Review diff + comment commands.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use base64::Engine;
use claude_commander::api::NewComment;
use claude_commander::comment::{ApplyOutcome, CommentSide};

use crate::service::{parse_session_id, service, with_service};

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

/// Read one side of an image file in the review diff and return it as a
/// `data:<mime>;base64,…` URL the frontend can drop into an `<img>`.
///
/// `side` is "old" (the `base` revision) or "new" (the working tree). LFS
/// images are stored as a small text pointer; whenever the bytes look like a
/// pointer we resolve them through `git lfs smudge` to the real image.
#[tauri::command]
pub async fn read_review_image(
    id: String,
    base: String,
    path: String,
    side: String,
) -> Result<String, String> {
    let sid = parse_session_id(&id)?;
    let svc = service().await?;
    let worktree = {
        let state = svc.store().read().await;
        state
            .sessions
            .get(&sid)
            .map(|s| s.worktree_path.clone())
            .ok_or_else(|| "session not found".to_string())?
    };
    // git/disk IO is blocking; keep it off the async runtime thread.
    tauri::async_runtime::spawn_blocking(move || image_data_url(&worktree, &base, &path, &side))
        .await
        .map_err(|e| e.to_string())?
}

fn image_data_url(worktree: &Path, base: &str, path: &str, side: &str) -> Result<String, String> {
    // `path`/`base` come from the trusted diff snapshot, but this is a public
    // Tauri command: reject anything that could be read by git as an option or
    // escape the worktree (absolute path or `..` segment).
    if base.is_empty() || base.starts_with('-') {
        return Err(format!("invalid base ref {base:?}"));
    }
    let rel = Path::new(path);
    if path.is_empty()
        || path.starts_with('-')
        || rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(format!("invalid image path {path:?}"));
    }
    let raw = match side {
        "new" => {
            std::fs::read(worktree.join(path)).map_err(|e| format!("read working image: {e}"))?
        }
        "old" => git_show(worktree, base, path)?,
        other => return Err(format!("invalid image side {other:?}")),
    };
    let bytes = if is_lfs_pointer(&raw) {
        lfs_smudge(worktree, path, &raw)?
    } else {
        raw
    };
    let mime = mime_for(path).ok_or_else(|| format!("unsupported image type: {path}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

/// The blob stored at `base:path` — for an LFS image this is the pointer text.
fn git_show(worktree: &Path, base: &str, path: &str) -> Result<Vec<u8>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .args(["show", &format!("{base}:{path}")])
        .output()
        .map_err(|e| format!("git show: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git show {base}:{path}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

/// Resolve an LFS pointer to its real bytes by piping it through the smudge
/// filter (the same one git runs on checkout). The path lets git match the
/// `.gitattributes` filter.
fn lfs_smudge(worktree: &Path, path: &str, pointer: &[u8]) -> Result<Vec<u8>, String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(worktree)
        .args(["lfs", "smudge", "--", path])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("git lfs smudge: {e}"))?;
    {
        let mut stdin = child.stdin.take().ok_or("git lfs smudge: no stdin")?;
        stdin
            .write_all(pointer)
            .map_err(|e| format!("git lfs smudge: {e}"))?;
        // drop stdin so smudge sees EOF before we wait
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("git lfs smudge: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git lfs smudge: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

fn is_lfs_pointer(bytes: &[u8]) -> bool {
    bytes.starts_with(b"version https://git-lfs")
}

fn mime_for(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        _ => return None,
    })
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
