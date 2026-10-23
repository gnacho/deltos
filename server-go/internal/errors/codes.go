// Package errors mirrors server/src/error-codes.ts and errors.ts: a stable,
// machine-readable error catalog (the frontend translates by code) and a
// single response envelope for every 4xx/5xx:
//
//	{"error":{"code":"...","message":"...","details":...}}
package errors

// Code is an error code (RECURSO_ESTADO convention, stable).
type Code string

// The catalog, identical to ERROR_CODES in error-codes.ts.
const (
	BadRequest          Code = "BAD_REQUEST"
	ValidationFailed    Code = "VALIDATION_FAILED"
	InvalidCursor       Code = "INVALID_CURSOR"
	NotFound            Code = "NOT_FOUND"
	PayloadTooLarge     Code = "PAYLOAD_TOO_LARGE"
	UniqueViolation     Code = "UNIQUE_VIOLATION"
	RateLimited         Code = "RATE_LIMITED"
	InternalError       Code = "INTERNAL_ERROR"
	AuthRequired        Code = "AUTH_REQUIRED"
	AuthInvalidCreds    Code = "AUTH_INVALID_CREDENTIALS"
	AuthRateLimited     Code = "AUTH_RATE_LIMITED"
	AuthForbidden       Code = "AUTH_FORBIDDEN"
	AuthWrongPassword   Code = "AUTH_WRONG_CURRENT_PASSWORD"
	AuthDemoDisabled    Code = "AUTH_DEMO_DISABLED"
	CSRFInvalid         Code = "CSRF_INVALID"
	DemoUnavailable     Code = "DEMO_UNAVAILABLE"
	DemoReadOnly        Code = "DEMO_READ_ONLY"
	UserNotFound        Code = "USER_NOT_FOUND"
	UserAlreadyExists   Code = "USER_ALREADY_EXISTS"
	UserLastAdmin       Code = "USER_LAST_ADMIN"
	UserSelfRole        Code = "USER_SELF_ROLE"
	UserSelfDelete      Code = "USER_SELF_DELETE"
	ProjectNotFound     Code = "PROJECT_NOT_FOUND"
	ProjectNotMember    Code = "PROJECT_NOT_MEMBER"
	ProjectNotOwner     Code = "PROJECT_NOT_OWNER"
	ProjectInbox        Code = "PROJECT_INBOX"
	AssigneeNotMember   Code = "ASSIGNEE_NOT_MEMBER"
	LabelNotFound       Code = "LABEL_NOT_FOUND"
	LabelNameTaken      Code = "LABEL_NAME_TAKEN"
	TaskNotFound        Code = "TASK_NOT_FOUND"
	TaskNotDone         Code = "TASK_NOT_DONE"
	SubtaskNotFound     Code = "SUBTASK_NOT_FOUND"
	ExpenseNotFound     Code = "EXPENSE_NOT_FOUND"
	ExpenseNotDone      Code = "EXPENSE_NOT_DONE"
	DecisionNotFound    Code = "DECISION_NOT_FOUND"
	DecisionNotOpen     Code = "DECISION_NOT_OPEN"
	SolutionNotFound    Code = "SOLUTION_NOT_FOUND"
	AssigneeNotFound    Code = "ASSIGNEE_NOT_FOUND"
	AttachmentNotFound  Code = "ATTACHMENT_NOT_FOUND"
	AttachmentFileMiss  Code = "ATTACHMENT_FILE_MISSING"
	UploadFileRequired  Code = "UPLOAD_FILE_REQUIRED"
	UploadTooLarge      Code = "UPLOAD_TOO_LARGE"
	UploadInvalidMIME   Code = "UPLOAD_INVALID_MIME"
	RewardNotFound      Code = "REWARD_NOT_FOUND"
	InsufficientPoints  Code = "INSUFFICIENT_POINTS"
	SettingsProdOnly    Code = "SETTINGS_PROD_ONLY"
	SettingsBackupFail  Code = "SETTINGS_BACKUP_FAILED"
	AttachmentsLimitExc Code = "ATTACHMENTS_LIMIT_EXCEEDED"
	SSETooManyClients   Code = "SSE_TOO_MANY_CLIENTS"
	PushNotConfigured   Code = "PUSH_NOT_CONFIGURED"
	PushDemoUnavailable Code = "PUSH_DEMO_UNAVAILABLE"
)

// MessagesES is the Spanish fallback per code (source of truth for users is
// the code; identical to ERROR_MESSAGES_ES).
var MessagesES = map[Code]string{
	BadRequest:          "La petición es incorrecta",
	ValidationFailed:    "Los datos enviados no son válidos",
	InvalidCursor:       "El cursor de paginación es inválido",
	NotFound:            "Recurso no encontrado",
	PayloadTooLarge:     "La petición es demasiado grande",
	UniqueViolation:     "Ya existe un recurso con esos datos",
	RateLimited:         "Demasiadas peticiones, inténtalo más tarde",
	InternalError:       "Error interno del servidor",
	AuthRequired:        "No autenticado",
	AuthInvalidCreds:    "Credenciales incorrectas",
	AuthRateLimited:     "Demasiados intentos, espera 5 minutos",
	AuthForbidden:       "Se requiere rol de administrador",
	AuthWrongPassword:   "La contraseña actual es incorrecta",
	AuthDemoDisabled:    "El modo demo está desactivado",
	CSRFInvalid:         "Token de seguridad no válido. Recarga la página.",
	DemoUnavailable:     "Modo demo no disponible",
	DemoReadOnly:        "La demostración es de solo lectura: sal de la demo para hacer cambios",
	UserNotFound:        "Usuario no encontrado",
	UserAlreadyExists:   "El usuario ya existe",
	UserLastAdmin:       "Debe quedar al menos un administrador",
	UserSelfRole:        "No puedes cambiar tu propio rol",
	UserSelfDelete:      "No puedes eliminarte a ti mismo",
	ProjectNotFound:     "Proyecto no encontrado",
	ProjectNotMember:    "No eres miembro de este proyecto",
	ProjectNotOwner:     "Solo el responsable del proyecto puede hacer esto",
	ProjectInbox:        "El proyecto \"Sin proyecto\" no se puede modificar",
	AssigneeNotMember:   "El asignado debe ser miembro del proyecto",
	LabelNotFound:       "Etiqueta no encontrada",
	LabelNameTaken:      "Ya existe una etiqueta con ese nombre",
	TaskNotFound:        "Tarea no encontrada",
	TaskNotDone:         "Solo se pueden archivar tareas hechas",
	SubtaskNotFound:     "Subtarea no encontrada",
	ExpenseNotFound:     "Gasto no encontrado",
	ExpenseNotDone:      "Solo se pueden archivar gastos pagados",
	DecisionNotFound:    "Decisión no encontrada",
	DecisionNotOpen:     "La decisión ya está cerrada",
	SolutionNotFound:    "Solución no encontrada",
	AssigneeNotFound:    "Usuario asignado no encontrado",
	AttachmentNotFound:  "Adjunto no encontrado",
	AttachmentFileMiss:  "Fichero no disponible en disco",
	UploadFileRequired:  "Falta el fichero (campo \"file\" en multipart)",
	UploadTooLarge:      "El fichero supera el límite de subida",
	UploadInvalidMIME:   "El tipo de fichero no está permitido",
	RewardNotFound:      "Recompensa no encontrada",
	InsufficientPoints:  "No tienes puntos suficientes para canjear esta recompensa",
	SettingsProdOnly:    "Ajuste solo disponible desde la sesión de producción",
	SettingsBackupFail:  "Error al realizar la copia de seguridad",
	AttachmentsLimitExc: "Se ha alcanzado el límite de adjuntos para esta tarea",
	SSETooManyClients:   "Demasiados clientes conectados",
	PushNotConfigured:   "Push no configurado en el servidor",
	PushDemoUnavailable: "Sin push real en modo demo",
}

// Message returns the Spanish fallback for a code.
func Message(code Code) string {
	if m, ok := MessagesES[code]; ok {
		return m
	}
	return MessagesES[InternalError]
}

// DefaultCodeFor maps an HTTP status without a domain code (errors.ts).
func DefaultCodeFor(status int) Code {
	switch status {
	case 400:
		return BadRequest
	case 401:
		return AuthRequired
	case 403:
		return AuthForbidden
	case 404:
		return NotFound
	case 409:
		return UniqueViolation
	case 413:
		return PayloadTooLarge
	case 429:
		return RateLimited
	default:
		return InternalError
	}
}
