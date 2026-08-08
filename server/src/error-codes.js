// ============================================================================
// error-codes.js — catálogo de códigos de error de la API (skill api-stack).
//
// Convención RECURSO_ESTADO. El `code` es ESTABLE y machine-readable: el
// frontend traduce por código (fase 2). `message` en español es solo fallback
// para logs y clientes sin i18n. Lista completa documentada en CONVENTIONS.md.
// ============================================================================

export const ERROR_CODES = {
  // Genéricos
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED', // 422, details.issues de zod
  INVALID_CURSOR: 'INVALID_CURSOR', // 400, cursor keyset malformado
  NOT_FOUND: 'NOT_FOUND', // 404 genérico (ruta inexistente)
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE', // 413, content-length excedido
  UNIQUE_VIOLATION: 'UNIQUE_VIOLATION', // 409, red de seguridad SQLITE_CONSTRAINT_UNIQUE
  RATE_LIMITED: 'RATE_LIMITED', // 429 genérico
  INTERNAL_ERROR: 'INTERNAL_ERROR', // 500, sin stack al cliente

  // Auth y sesión
  AUTH_REQUIRED: 'AUTH_REQUIRED', // 401, sin sesión válida
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS', // 401, login fallido
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED', // 429, bloqueo de login por intentos
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN', // 403, requiere rol admin
  AUTH_WRONG_CURRENT_PASSWORD: 'AUTH_WRONG_CURRENT_PASSWORD', // 400
  AUTH_DEMO_DISABLED: 'AUTH_DEMO_DISABLED', // 403, modo demo desactivado
  CSRF_INVALID: 'CSRF_INVALID', // 403, token CSRF ausente o no coincide
  DEMO_UNAVAILABLE: 'DEMO_UNAVAILABLE', // 503, BD demo sin usuario demo
  DEMO_READ_ONLY: 'DEMO_READ_ONLY', // 403, la BD demo es de solo lectura

  // Usuarios (admin)
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_EXISTS: 'USER_ALREADY_EXISTS', // 409, username UNIQUE
  USER_LAST_ADMIN: 'USER_LAST_ADMIN', // 400, debe quedar ≥1 admin
  USER_SELF_ROLE: 'USER_SELF_ROLE', // 400, no puedes cambiar tu propio rol
  USER_SELF_DELETE: 'USER_SELF_DELETE', // 400, no puedes eliminarte a ti mismo

  // Dominio
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  LABEL_NOT_FOUND: 'LABEL_NOT_FOUND',
  LABEL_NAME_TAKEN: 'LABEL_NAME_TAKEN', // 409, labels.name UNIQUE
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  ASSIGNEE_NOT_FOUND: 'ASSIGNEE_NOT_FOUND',
  ATTACHMENT_NOT_FOUND: 'ATTACHMENT_NOT_FOUND',
  ATTACHMENT_FILE_MISSING: 'ATTACHMENT_FILE_MISSING', // 404, fichero no está en disco
  UPLOAD_FILE_REQUIRED: 'UPLOAD_FILE_REQUIRED', // 400, falta campo "file"
  UPLOAD_TOO_LARGE: 'UPLOAD_TOO_LARGE', // 413, fichero > MAX_UPLOAD_MB
  UPLOAD_INVALID_MIME: 'UPLOAD_INVALID_MIME', // 415, tipo de fichero no permitido

  // Ajustes
  SETTINGS_PROD_ONLY: 'SETTINGS_PROD_ONLY', // 403, ajuste solo desde sesión prod
  SETTINGS_BACKUP_FAILED: 'SETTINGS_BACKUP_FAILED', // 500, error al hacer backup
  ATTACHMENTS_LIMIT_EXCEEDED: 'ATTACHMENTS_LIMIT_EXCEEDED', // 409, límite adjuntos por tarea

  // SSE / Push
  SSE_TOO_MANY_CLIENTS: 'SSE_TOO_MANY_CLIENTS', // 429, hub lleno
  PUSH_NOT_CONFIGURED: 'PUSH_NOT_CONFIGURED', // 503, sin claves VAPID
  PUSH_DEMO_UNAVAILABLE: 'PUSH_DEMO_UNAVAILABLE', // 501, sin push real en demo
}

// Fallback en español por código (la fuente de verdad para el usuario es el
// `code`: el frontend lo traduce en la fase 2).
export const ERROR_MESSAGES_ES = {
  [ERROR_CODES.BAD_REQUEST]: 'La petición es incorrecta',
  [ERROR_CODES.VALIDATION_FAILED]: 'Los datos enviados no son válidos',
  [ERROR_CODES.INVALID_CURSOR]: 'El cursor de paginación es inválido',
  [ERROR_CODES.NOT_FOUND]: 'Recurso no encontrado',
  [ERROR_CODES.PAYLOAD_TOO_LARGE]: 'La petición es demasiado grande',
  [ERROR_CODES.UNIQUE_VIOLATION]: 'Ya existe un recurso con esos datos',
  [ERROR_CODES.RATE_LIMITED]: 'Demasiadas peticiones, inténtalo más tarde',
  [ERROR_CODES.INTERNAL_ERROR]: 'Error interno del servidor',

  [ERROR_CODES.AUTH_REQUIRED]: 'No autenticado',
  [ERROR_CODES.AUTH_INVALID_CREDENTIALS]: 'Credenciales incorrectas',
  [ERROR_CODES.AUTH_RATE_LIMITED]: 'Demasiados intentos, espera 5 minutos',
  [ERROR_CODES.AUTH_FORBIDDEN]: 'Se requiere rol de administrador',
  [ERROR_CODES.AUTH_WRONG_CURRENT_PASSWORD]: 'La contraseña actual es incorrecta',
  [ERROR_CODES.AUTH_DEMO_DISABLED]: 'El modo demo está desactivado',
  [ERROR_CODES.CSRF_INVALID]: 'Token de seguridad no válido. Recarga la página.',
  [ERROR_CODES.DEMO_UNAVAILABLE]: 'Modo demo no disponible',
  [ERROR_CODES.DEMO_READ_ONLY]: 'La demostración es de solo lectura: sal de la demo para hacer cambios',

  [ERROR_CODES.USER_NOT_FOUND]: 'Usuario no encontrado',
  [ERROR_CODES.USER_ALREADY_EXISTS]: 'El usuario ya existe',
  [ERROR_CODES.USER_LAST_ADMIN]: 'Debe quedar al menos un administrador',
  [ERROR_CODES.USER_SELF_ROLE]: 'No puedes cambiar tu propio rol',
  [ERROR_CODES.USER_SELF_DELETE]: 'No puedes eliminarte a ti mismo',

  [ERROR_CODES.PROJECT_NOT_FOUND]: 'Proyecto no encontrado',
  [ERROR_CODES.LABEL_NOT_FOUND]: 'Etiqueta no encontrada',
  [ERROR_CODES.LABEL_NAME_TAKEN]: 'Ya existe una etiqueta con ese nombre',
  [ERROR_CODES.TASK_NOT_FOUND]: 'Tarea no encontrada',
  [ERROR_CODES.ASSIGNEE_NOT_FOUND]: 'Usuario asignado no encontrado',
  [ERROR_CODES.ATTACHMENT_NOT_FOUND]: 'Adjunto no encontrado',
  [ERROR_CODES.ATTACHMENT_FILE_MISSING]: 'Fichero no disponible en disco',
  [ERROR_CODES.UPLOAD_FILE_REQUIRED]: 'Falta el fichero (campo "file" en multipart)',
  [ERROR_CODES.UPLOAD_TOO_LARGE]: 'El fichero supera el límite de subida',
  [ERROR_CODES.UPLOAD_INVALID_MIME]: 'El tipo de fichero no está permitido',

  [ERROR_CODES.SETTINGS_PROD_ONLY]: 'Ajuste solo disponible desde la sesión de producción',
  [ERROR_CODES.SETTINGS_BACKUP_FAILED]: 'Error al realizar la copia de seguridad',
  [ERROR_CODES.ATTACHMENTS_LIMIT_EXCEEDED]: 'Se ha alcanzado el límite de adjuntos para esta tarea',

  [ERROR_CODES.SSE_TOO_MANY_CLIENTS]: 'Demasiados clientes conectados',
  [ERROR_CODES.PUSH_NOT_CONFIGURED]: 'Push no configurado en el servidor',
  [ERROR_CODES.PUSH_DEMO_UNAVAILABLE]: 'Sin push real en modo demo',
}
