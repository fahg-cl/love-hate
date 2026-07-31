const ALLOWED_ORIGIN = "https://fahg-cl.github.io";
const BACKUP_ID = "owner-primary";
const MAX_BACKUP_BYTES = 2_000_000;

function createHeaders(request) {
  const requestOrigin = request.headers.get("Origin");

  return {
    "Access-Control-Allow-Origin":
      requestOrigin === ALLOWED_ORIGIN
        ? requestOrigin
        : ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function jsonResponse(request, data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: createHeaders(request)
    }
  );
}

function validateBackupStructure(backup) {
  if (!backup || typeof backup !== "object") {
    return false;
  }

  if (!Array.isArray(backup.items)) {
    return false;
  }

  if (!Array.isArray(backup.records)) {
    return false;
  }

  return true;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: createHeaders(request)
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "METHOD_NOT_ALLOWED",
          message: "Método no permitido"
        },
        405
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "INVALID_REQUEST",
          message: "La solicitud no contiene un JSON válido"
        },
        400
      );
    }

    const enteredCode = String(body.code ?? "").trim();
    const configuredCode =
      String(env.APP_BOOTSTRAP_CODE ?? "").trim();

    if (!/^\d{6}$/.test(configuredCode)) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "SECRET_NOT_CONFIGURED",
          message:
            "APP_BOOTSTRAP_CODE no está configurado correctamente"
        },
        500
      );
    }

    if (!/^\d{6}$/.test(enteredCode)) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "INVALID_CODE_FORMAT",
          message: "La clave debe contener seis dígitos"
        },
        400
      );
    }

    if (enteredCode !== configuredCode) {
      return jsonResponse(
        request,
        {
          ok: false,
          error: "INVALID_CODE",
          message: "La clave ingresada no es correcta"
        },
        401
      );
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    /*
     * Validación inicial de la aplicación.
     * Se conserva la ruta raíz para no romper el index.html actual.
     */
    if (path === "/" || path === "/auth") {
      return jsonResponse(request, {
        ok: true,
        message: "Código correcto"
      });
    }

    /*
     * Guardar respaldo completo.
     */
    if (path === "/backup") {
      if (!env.DB) {
        return jsonResponse(
          request,
          {
            ok: false,
            error: "DB_NOT_CONFIGURED",
            message: "La base D1 no está vinculada al Worker"
          },
          500
        );
      }

      const backup = body.backup;

      if (!validateBackupStructure(backup)) {
        return jsonResponse(
          request,
          {
            ok: false,
            error: "INVALID_BACKUP",
            message:
              "El respaldo no contiene ítems y registros válidos"
          },
          400
        );
      }

      const updatedAt = new Date().toISOString();

      const payload = JSON.stringify({
        schemaVersion: backup.schemaVersion ?? 1,
        appVersion: backup.appVersion ?? null,
        backedUpAt: updatedAt,
        items: backup.items,
        records: backup.records,
        settings: backup.settings ?? {}
      });

      const payloadSize =
        new TextEncoder().encode(payload).byteLength;

      if (payloadSize > MAX_BACKUP_BYTES) {
        return jsonResponse(
          request,
          {
            ok: false,
            error: "BACKUP_TOO_LARGE",
            message: "El respaldo supera el tamaño permitido"
          },
          413
        );
      }

      await env.DB
        .prepare(`
          INSERT INTO app_backups (
            id,
            payload,
            updated_at
          )
          VALUES (?1, ?2, ?3)
          ON CONFLICT(id)
          DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `)
        .bind(
          BACKUP_ID,
          payload,
          updatedAt
        )
        .run();

      return jsonResponse(request, {
        ok: true,
        message: "Respaldo guardado correctamente",
        updatedAt,
        itemCount: backup.items.length,
        recordCount: backup.records.length
      });
    }

    /*
     * Recuperar el último respaldo.
     */
    if (path === "/restore") {
      if (!env.DB) {
        return jsonResponse(
          request,
          {
            ok: false,
            error: "DB_NOT_CONFIGURED",
            message: "La base D1 no está vinculada al Worker"
          },
          500
        );
      }

      const row = await env.DB
        .prepare(`
          SELECT
            payload,
            updated_at
          FROM app_backups
          WHERE id = ?1
          LIMIT 1
        `)
        .bind(BACKUP_ID)
        .first();

      if (!row) {
        return jsonResponse(
          request,
          {
            ok: false,
            error: "BACKUP_NOT_FOUND",
            message: "Todavía no existe un respaldo en Cloudflare"
          },
          404
        );
      }

      let backup;

      try {
        backup = JSON.parse(row.payload);
      } catch {
        return jsonResponse(
          request,
          {
            ok: false,
            error: "CORRUPTED_BACKUP",
            message: "El respaldo almacenado no es válido"
          },
          500
        );
      }

      return jsonResponse(request, {
        ok: true,
        message: "Respaldo recuperado correctamente",
        updatedAt: row.updated_at,
        backup
      });
    }

    return jsonResponse(
      request,
      {
        ok: false,
        error: "ROUTE_NOT_FOUND",
        message: "Ruta no encontrada"
      },
      404
    );
  }
};