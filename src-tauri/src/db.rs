//! The desktop database layer.
//!
//! Deliberately NOT `tauri-plugin-sql`. That plugin exposes only `execute`,
//! `select` and `close`: it has no transaction API, and it manages a sqlx
//! connection *pool*, so issuing `BEGIN` through `execute` gives no guarantee
//! that the following statements land on the same connection. For an
//! application where an import must be all-or-nothing, that is disqualifying.
//! Its `$1` placeholder dialect would also have leaked into every repository
//! query, splitting the one set of SQL the browser and desktop builds share.
//!
//! So: one connection behind a mutex, and four commands that satisfy exactly the
//! `SqlDriver` interface the TypeScript side already speaks.

use rusqlite::{types::ValueRef, Connection, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::sync::Mutex;

/// The single connection. Everything is serialized through it, which matches the
/// browser driver's behaviour and keeps the two builds honest with each other.
pub struct Database(pub Mutex<Connection>);

#[derive(Debug, Serialize)]
pub struct ExecResult {
    #[serde(rename = "rowsAffected")]
    pub rows_affected: i64,
    #[serde(rename = "lastInsertRowId")]
    pub last_insert_row_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct BatchOp {
    pub sql: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct SqlErrorPayload {
    pub name: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sql: Option<String>,
}

impl SqlErrorPayload {
    fn from(error: &rusqlite::Error, sql: Option<&str>) -> Self {
        // The extended result code is preserved: the TypeScript `SqlError` masks
        // it down to a primary code itself, and discarding it here would lose
        // the detail that distinguishes one constraint failure from another.
        let code = match error {
            rusqlite::Error::SqliteFailure(failure, _) => Some(failure.extended_code),
            _ => None,
        };
        Self {
            name: "SQLite3Error".to_string(),
            message: error.to_string(),
            code,
            sql: sql.map(str::to_string),
        }
    }
}

/// Converts the JSON the front end sends into bound parameters.
///
/// Accepts a positional array or a named object, and nothing else - the same two
/// forms `SqlDriver` documents. `$1`-style placeholders are not supported by
/// design; permitting them would fracture the shared SQL.
fn bind(statement: &mut rusqlite::Statement<'_>, params: &Value) -> rusqlite::Result<()> {
    match params {
        Value::Null => Ok(()),
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                statement.raw_bind_parameter(index + 1, JsonParam(value))?;
            }
            Ok(())
        }
        Value::Object(entries) => {
            for (key, value) in entries {
                // The TypeScript side may send `id` or `:id`; accept both, as the
                // browser driver does.
                let name = if key.starts_with([':', '@', '$']) {
                    key.clone()
                } else {
                    format!(":{key}")
                };
                if let Some(index) = statement.parameter_index(&name)? {
                    statement.raw_bind_parameter(index, JsonParam(value))?;
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

struct JsonParam<'a>(&'a Value);

impl rusqlite::ToSql for JsonParam<'_> {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        use rusqlite::types::{ToSqlOutput, Value as SqlValue};
        Ok(match self.0 {
            Value::Null => ToSqlOutput::Owned(SqlValue::Null),
            Value::Bool(value) => ToSqlOutput::Owned(SqlValue::Integer(i64::from(*value))),
            Value::Number(value) => {
                if let Some(int) = value.as_i64() {
                    ToSqlOutput::Owned(SqlValue::Integer(int))
                } else {
                    ToSqlOutput::Owned(SqlValue::Real(value.as_f64().unwrap_or(0.0)))
                }
            }
            Value::String(value) => ToSqlOutput::Owned(SqlValue::Text(value.clone())),
            // Blobs cross the boundary as arrays of byte values.
            Value::Array(values) => ToSqlOutput::Owned(SqlValue::Blob(
                values
                    .iter()
                    .filter_map(|entry| entry.as_u64().map(|byte| byte as u8))
                    .collect(),
            )),
            Value::Object(_) => ToSqlOutput::Owned(SqlValue::Null),
        })
    }
}

fn rows_to_json(statement: &mut rusqlite::Statement<'_>) -> rusqlite::Result<Vec<Value>> {
    let names: Vec<String> = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect();

    let mut out = Vec::new();
    let mut rows = statement.raw_query();
    while let Some(row) = rows.next()? {
        let mut object = Map::new();
        for (index, name) in names.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(int) => Value::Number(Number::from(int)),
                ValueRef::Real(real) => Number::from_f64(real).map_or(Value::Null, Value::Number),
                ValueRef::Text(text) => Value::String(String::from_utf8_lossy(text).into_owned()),
                ValueRef::Blob(bytes) => {
                    Value::Array(bytes.iter().map(|b| Value::Number(Number::from(*b))).collect())
                }
            };
            object.insert(name.clone(), value);
        }
        out.push(Value::Object(object));
    }
    Ok(out)
}

fn run(connection: &Connection, sql: &str, params: &Value) -> rusqlite::Result<ExecResult> {
    let mut statement = connection.prepare_cached(sql)?;
    bind(&mut statement, params)?;
    statement.raw_execute()?;
    Ok(ExecResult {
        rows_affected: connection.changes() as i64,
        last_insert_row_id: connection.last_insert_rowid(),
    })
}

#[tauri::command]
pub fn db_select(
    state: tauri::State<'_, Database>,
    sql: String,
    params: Value,
) -> Result<Vec<Value>, SqlErrorPayload> {
    let connection = state.0.lock().expect("database mutex poisoned");
    (|| {
        let mut statement = connection.prepare_cached(&sql)?;
        bind(&mut statement, &params)?;
        rows_to_json(&mut statement)
    })()
    .map_err(|error| SqlErrorPayload::from(&error, Some(&sql)))
}

#[tauri::command]
pub fn db_exec(
    state: tauri::State<'_, Database>,
    sql: String,
    params: Value,
) -> Result<ExecResult, SqlErrorPayload> {
    let connection = state.0.lock().expect("database mutex poisoned");
    run(&connection, &sql, &params).map_err(|error| SqlErrorPayload::from(&error, Some(&sql)))
}

/// Multi-statement script with no parameters. Migrations and pragmas only.
#[tauri::command]
pub fn db_exec_script(
    state: tauri::State<'_, Database>,
    sql: String,
) -> Result<(), SqlErrorPayload> {
    let connection = state.0.lock().expect("database mutex poisoned");
    connection
        .execute_batch(&sql)
        .map_err(|error| SqlErrorPayload::from(&error, Some(&sql)))
}

/// The default write path: every operation in one transaction, or none of them.
#[tauri::command]
pub fn db_batch(
    state: tauri::State<'_, Database>,
    ops: Vec<BatchOp>,
    mode: String,
) -> Result<Vec<ExecResult>, SqlErrorPayload> {
    let mut connection = state.0.lock().expect("database mutex poisoned");
    let behavior = if mode == "DEFERRED" {
        TransactionBehavior::Deferred
    } else {
        TransactionBehavior::Immediate
    };

    let mut failing_sql: Option<String> = None;
    let outcome = (|| -> rusqlite::Result<Vec<ExecResult>> {
        let transaction: Transaction<'_> = connection.transaction_with_behavior(behavior)?;
        let mut results = Vec::with_capacity(ops.len());
        for op in &ops {
            match run(&transaction, &op.sql, &op.params) {
                Ok(result) => results.push(result),
                Err(error) => {
                    failing_sql = Some(op.sql.clone());
                    return Err(error);
                }
            }
        }
        // Dropping without commit rolls back, so an early return above is safe.
        transaction.commit()?;
        Ok(results)
    })();

    outcome.map_err(|error| SqlErrorPayload::from(&error, failing_sql.as_deref()))
}

/// Raw database bytes, for backup. Uses SQLite's own backup API so the copy is
/// consistent even if something else is mid-write.
#[tauri::command]
pub fn db_export(state: tauri::State<'_, Database>) -> Result<Vec<u8>, SqlErrorPayload> {
    let connection = state.0.lock().expect("database mutex poisoned");
    (|| -> rusqlite::Result<Vec<u8>> {
        let mut memory = Connection::open_in_memory()?;
        {
            let backup = rusqlite::backup::Backup::new(&connection, &mut memory)?;
            backup.run_to_completion(64, std::time::Duration::from_millis(0), None)?;
        }
        memory.serialize(rusqlite::DatabaseName::Main).map(|s| s.to_vec())
    })()
    .map_err(|error| SqlErrorPayload::from(&error, None))
}

/// Opens the database and applies the same pragmas the browser driver uses.
///
/// One difference, stated because it matters: WAL IS available here. The browser
/// cannot use it - the OPFS SAH-pool VFS implements no shared-memory methods -
/// but a native file has no such limitation, and WAL means a writer no longer
/// blocks readers.
pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let connection = Connection::open(path)?;
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous  = FULL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;
         PRAGMA temp_store   = MEMORY;",
    )?;
    Ok(connection)
}
