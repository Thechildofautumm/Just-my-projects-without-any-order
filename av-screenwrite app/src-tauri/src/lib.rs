//! Оболочка AV-сценария. Вся логика редактора живёт в интерфейсе (src/core);
//! здесь только то, что нельзя сделать надёжно из webview: безопасная запись файлов.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

/// Файлы сценариев больше этого размера не открываем (защита от случайного выбора чужого файла).
const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

fn has_ext(path: &Path, allowed: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| allowed.iter().any(|a| a.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

/// Прочитать выбранный пользователем файл сценария (.avs, а также .json от прототипа).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !has_ext(&p, &["avs", "json"]) {
        return Err("Поддерживаются только файлы .avs и .json".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Это не файл".into());
    }
    if meta.len() > MAX_READ_BYTES {
        return Err("Файл слишком большой для сценария".into());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "Файл не в кодировке UTF-8".to_string())
}

/// Атомарная запись: временный файл рядом → копия прежней версии в `имя.avs.bak` →
/// переименование поверх. При любой ошибке исходный файл остаётся нетронутым.
fn write_atomic(target: &Path, contents: &[u8], keep_bak: bool) -> Result<(), String> {
    let dir = target
        .parent()
        .filter(|d| !d.as_os_str().is_empty())
        .ok_or_else(|| "Не удалось определить папку файла".to_string())?;
    let name = target
        .file_name()
        .ok_or_else(|| "Не удалось определить имя файла".to_string())?
        .to_string_lossy()
        .into_owned();

    let tmp = dir.join(format!(".{name}.tmp"));
    let result = (|| -> Result<(), String> {
        {
            let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            f.write_all(contents).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
        }
        if keep_bak && target.exists() {
            let bak = dir.join(format!("{name}.bak"));
            fs::copy(target, &bak).map_err(|e| format!("не удалось сохранить копию .bak: {e}"))?;
        }
        // На Windows и Unix rename заменяет существующий файл.
        fs::rename(&tmp, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[tauri::command]
fn write_text_file_atomic(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !has_ext(&target, &["avs"]) {
        return Err("Файл сценария должен иметь расширение .avs".into());
    }
    write_atomic(&target, contents.as_bytes(), true)
}

/// Записать экспорт (PDF или Word) в выбранное пользователем место. Без `.bak`: это не рабочий файл.
#[tauri::command]
fn write_export_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !has_ext(&target, &["pdf", "docx"]) {
        return Err("Экспорт возможен только в .pdf и .docx".into());
    }
    write_atomic(&target, &contents, false)
}

/* ---------- Библиотека проектов: файлы в папке данных приложения ---------- */

/// Идентификатор проекта — имя файла без расширения. Только строчные латинские буквы и цифры:
/// так из интерфейса нельзя выйти за пределы папки проектов.
fn valid_id(id: &str) -> bool {
    (6..=32).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn project_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("Недопустимый идентификатор проекта".into());
    }
    Ok(dir.join(format!("{id}.avs")))
}

fn millis(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Все проекты: (id, время изменения в мс, содержимое файла).
fn list_in(dir: &Path) -> Result<Vec<(String, u64, String)>, String> {
    let mut out = Vec::new();
    let rd = match fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.to_string()),
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if !path.is_file() || !has_ext(&path, &["avs"]) {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|s| s.to_str()).filter(|s| valid_id(s)) else { continue };
        let Ok(meta) = entry.metadata() else { continue };
        if meta.len() > MAX_READ_BYTES {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        let modified = meta.modified().map(millis).unwrap_or(0);
        out.push((id.to_string(), modified, String::from_utf8_lossy(&bytes).into_owned()));
    }
    Ok(out)
}

fn read_in(dir: &Path, id: &str) -> Result<String, String> {
    let bytes = fs::read(project_path(dir, id)?).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "Файл проекта не в кодировке UTF-8".to_string())
}

fn write_in(dir: &Path, id: &str, contents: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    write_atomic(&project_path(dir, id)?, contents.as_bytes(), true)
}

/// «Удаление» — перенос в подпапку .trash: ошибочно удалённый проект можно вернуть вручную.
fn delete_in(dir: &Path, id: &str) -> Result<(), String> {
    let path = project_path(dir, id)?;
    if !path.exists() {
        return Ok(());
    }
    let trash = dir.join(".trash");
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let stamp = millis(SystemTime::now());
    fs::rename(&path, trash.join(format!("{id}-{stamp}.avs"))).map_err(|e| e.to_string())?;
    let bak = dir.join(format!("{id}.avs.bak"));
    if bak.exists() {
        let _ = fs::rename(&bak, trash.join(format!("{id}-{stamp}.avs.bak")));
    }
    Ok(())
}

fn projects_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("projects"))
}

#[tauri::command]
fn library_list(app: tauri::AppHandle) -> Result<Vec<(String, u64, String)>, String> {
    list_in(&projects_dir(&app)?)
}

#[tauri::command]
fn library_read(app: tauri::AppHandle, id: String) -> Result<String, String> {
    read_in(&projects_dir(&app)?, &id)
}

#[tauri::command]
fn library_write(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    write_in(&projects_dir(&app)?, &id, &contents)
}

#[tauri::command]
fn library_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    delete_in(&projects_dir(&app)?, &id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file_atomic,
            write_export_file,
            library_list,
            library_read,
            library_write,
            library_delete
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("av-scenariy-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn creates_new_file_without_bak() {
        let d = temp_dir("new");
        let f = d.join("a.avs");
        write_atomic(&f, b"one", true).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "one");
        assert!(!d.join("a.avs.bak").exists());
        assert!(!d.join(".a.avs.tmp").exists());
    }

    #[test]
    fn export_overwrite_makes_no_bak() {
        let d = temp_dir("export");
        let f = d.join("a.pdf");
        write_export_file(f.to_string_lossy().into_owned(), vec![1, 2, 3]).unwrap();
        write_export_file(f.to_string_lossy().into_owned(), vec![4, 5]).unwrap();
        assert_eq!(fs::read(&f).unwrap(), vec![4, 5]);
        assert!(!d.join("a.pdf.bak").exists());
        assert!(write_export_file(d.join("a.exe").to_string_lossy().into_owned(), vec![]).is_err());
    }

    #[test]
    fn overwrite_keeps_previous_version_in_bak() {
        let d = temp_dir("bak");
        let f = d.join("a.avs");
        write_atomic(&f, b"one", true).unwrap();
        write_atomic(&f, b"two", true).unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "two");
        assert_eq!(fs::read_to_string(d.join("a.avs.bak")).unwrap(), "one");
        assert!(!d.join(".a.avs.tmp").exists());
    }

    #[test]
    fn library_roundtrip_list_and_trash() {
        let d = temp_dir("lib");
        assert!(list_in(&d.join("nope")).unwrap().is_empty());
        write_in(&d, "abc12345", "{\"one\":1}").unwrap();
        write_in(&d, "abc12345", "{\"two\":2}").unwrap(); // перезапись → .bak
        write_in(&d, "zz99zz99", "x").unwrap();
        assert_eq!(read_in(&d, "abc12345").unwrap(), "{\"two\":2}");
        assert!(d.join("abc12345.avs.bak").exists());
        let mut list = list_in(&d).unwrap();
        list.sort();
        assert_eq!(list.iter().map(|e| e.0.as_str()).collect::<Vec<_>>(), vec!["abc12345", "zz99zz99"]); // .bak не в списке
        assert!(list[0].1 > 0);

        delete_in(&d, "abc12345").unwrap();
        assert!(!d.join("abc12345.avs").exists());
        assert!(!d.join("abc12345.avs.bak").exists());
        assert_eq!(fs::read_dir(d.join(".trash")).unwrap().count(), 2);
        assert_eq!(list_in(&d).unwrap().len(), 1);
        delete_in(&d, "abc12345").unwrap(); // повторное удаление не ошибка
    }

    #[test]
    fn library_rejects_bad_ids() {
        let d = temp_dir("badid");
        for bad in ["", "abc", "../evil1234", "a/b/c/d/e/f", "ABCDEFGH", "abc 1234", "abc.1234x", "абвгдежз"] {
            assert!(read_in(&d, bad).is_err(), "{bad}");
            assert!(write_in(&d, bad, "x").is_err(), "{bad}");
            assert!(delete_in(&d, bad).is_err(), "{bad}");
        }
        assert!(fs::read_dir(&d).unwrap().next().is_none());
    }

    #[test]
    fn library_ignores_foreign_files() {
        let d = temp_dir("foreign");
        fs::write(d.join("notes.txt"), "x").unwrap();
        fs::write(d.join("Bad Name.avs"), "x").unwrap();
        fs::create_dir_all(d.join("sub12345.avs")).unwrap();
        write_in(&d, "good1234", "{}").unwrap();
        let ids: Vec<_> = list_in(&d).unwrap().into_iter().map(|e| e.0).collect();
        assert_eq!(ids, vec!["good1234"]);
    }

    #[test]
    fn rejects_wrong_extensions() {
        assert!(write_text_file_atomic("x.txt".into(), "".into()).is_err());
        assert!(read_text_file("x.exe".into()).is_err());
    }
}
