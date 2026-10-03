/** Tipos del dominio Deltos — snake_case, igual que la API (ver server/README.md). */

export type ColumnId = 'nuevo' | 'encurso' | 'hecho';
export type ExpenseStep = 'nuevo' | 'en-curso' | 'hecho';
export type PaymentMethod = 'bizum' | 'transfer' | 'efectivo';
export type Priority = 'alta' | 'media' | 'baja';
export type Language = 'auto' | 'es' | 'en';
export type Role = 'admin' | 'user';

export interface SessionUser {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  color: string;
  language: Language;
  role: Role;
  expenses_enabled?: boolean;
  /** 0 = desactivado; nº de aplazamientos antes de marcar la tarea (#255). */
  anti_slip_threshold?: number;
  created_at: number;
}

/** Usuario tal y como llega en el bootstrap (lista reducida). */
export interface BoardUser {
  id: string;
  username: string;
  color: string;
}

export type ProjectRole = 'owner' | 'member';

export interface ProjectMember {
  id: string;
  username: string;
  color: string;
  role: ProjectRole;
}

export interface Project {
  id: string;
  name: string;
  emoji: string;
  color: string;
  position: number;
  owner_id: string | null;
  /** true = proyecto "Sin proyecto" (bandeja de tareas sin proyecto; no editable). */
  is_inbox: boolean;
  members: ProjectMember[];
  counts: Record<ColumnId, number>;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface TaskAssignee {
  id: string;
  username: string;
  color: string;
}

export interface TaskRecurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  weekdays: number[] | null;
  mode: 'due' | 'completion';
}

export interface Task {
  id: string;
  project_id: string;
  short_id: string | null;
  title: string;
  description: string;
  column: ColumnId;
  position: number;
  priority: Priority | null;
  due_date: string | null; // YYYY-MM-DD
  recurrence: TaskRecurrence | null;
  recurrence_group_id: string | null;
  recurrence_paused: boolean;
  assignee_id: string | null;
  assignee: TaskAssignee | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  /** epoch ms de la última entrada en 'hecho'; null si nunca se completó. */
  done_at: number | null;
  archived_at: number | null; // epoch ms; null = activa en el tablero
  labels: Label[];
  counts: { comments: number; attachments: number };
  /** Cambios de vencimiento desde la última finalización/reinicio (issue #255). */
  slips: number;
}

export interface Bootstrap {
  users: BoardUser[];
  projects: Project[];
  labels: Label[];
  tasks: Task[];
}

export interface Attachment {
  id: string;
  filename: string;
  size: number;
  mime: string;
  created_at: number;
  uploaded_by: string;
  uploaded_by_username: string | null;
}

export interface Comment {
  id: string;
  body: string;
  created_at: number;
  user_id: string;
  username: string | null;
  user_color: string | null;
}

export type ActivityEventType =
  | 'created'
  | 'title'
  | 'description'
  | 'priority'
  | 'due'
  | 'assigned'
  | 'moved'
  | 'attachment'
  | 'project';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  data: Record<string, unknown>;
  created_at: number;
  user_id: string;
  username: string | null;
}

export interface Subtask {
  id: string;
  parent_id: string | null;
  title: string;
  done: boolean;
  position: number;
}

export interface TaskDetail {
  task: Task;
  labels: Label[];
  attachments: Attachment[];
  comments: Comment[];
  activity: ActivityEvent[];
  subtasks: Subtask[];
}

export interface ActivityFeedItem {
  id: string;
  type: ActivityEventType;
  data: Record<string, unknown>;
  created_at: number;
  task_id: string;
  task_title: string;
  project_id: string;
  project_name: string;
  username: string | null;
  user_color: string | null;
}

/** GET /api/activity: paginación keyset (?cursor=), sin page/total. */
export interface ActivityFeed {
  items: ActivityFeedItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface MeResponse {
  user: SessionUser;
  demo: boolean;
  csrfToken?: string | null;
}

export interface TaskPatch {
  title?: string;
  description?: string;
  priority?: Priority | null;
  due_date?: string | null;
  assignee_id?: string | null;
  labels?: string[];
  project_id?: string;
  recurrence?: TaskRecurrence | null;
}

export interface ExpenseShare {
  user_id: string;
  username: string;
  user_color: string;
  share_cents: number;
  paid: boolean;
}

export interface Expense {
  id: string;
  title: string;
  amount_cents: number;
  label_id: string | null;
  label_name: string | null;
  label_color: string | null;
  project_id: string | null;
  project_name: string | null;
  notes: string;
  payer_id: string;
  payer_username: string;
  payer_color: string;
  payment_method: PaymentMethod | null;
  spent_at: number;
  shares: ExpenseShare[];
  step: ExpenseStep;
  position: number;
  created_by: string;
  created_by_username: string;
  created_by_color: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null; // epoch ms; null = activo en el tablero
  counts: { comments: number; attachments: number };
}

export interface ExpenseShareInput {
  user_id: string;
  share_cents: number;
}

export interface ExpenseInput {
  title: string;
  amount_cents: number;
  label_id?: string | null;
  project_id?: string | null;
  notes?: string;
  payer_id?: string;
  spent_at?: number;
  shares?: ExpenseShareInput[];
  payment_method?: PaymentMethod | null;
  step?: ExpenseStep;
}

export interface ExpensePatch {
  title?: string;
  amount_cents?: number;
  label_id?: string | null;
  project_id?: string | null;
  notes?: string;
  payer_id?: string;
  spent_at?: number;
  shares?: ExpenseShareInput[];
  payment_method?: PaymentMethod | null;
  step?: ExpenseStep;
}

export interface ExpenseDetail {
  expense: Expense;
  attachments: Attachment[];
  comments: Comment[];
  activity: ActivityEvent[];
}

/* --- Decisiones (server/src/routes-decisions.js) --- */

export type DecisionStatus = 'open' | 'decided';

export interface Decision {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: DecisionStatus;
  chosen_solution_id: string | null;
  created_by: string;
  created_by_username: string;
  created_by_color: string;
  created_at: number;
  updated_at: number;
  decided_at: number | null;
}

/** Fila de la lista (GET /api/decisions): decisión + contadores. */
export interface DecisionListItem extends Decision {
  chosen_solution_title: string | null;
  counts: { solutions: number; votes: number; comments: number };
}

export interface DecisionSolution {
  id: string;
  decision_id: string;
  title: string;
  description: string;
  proposer_id: string;
  proposer_username: string;
  proposer_color: string;
  votes: number;
  my_vote: boolean;
  created_at: number;
  updated_at: number;
}

export interface DecisionComment {
  id: string;
  decision_id: string;
  user_id: string | null;
  username: string | null;
  user_color: string | null;
  body: string;
  created_at: number;
}

export interface DecisionActivityEvent {
  id: string;
  decision_id: string | null;
  user_id: string | null;
  username: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: number;
}

/** Adjunto de decisión: solution_id null = adjunto de la descripción. */
export interface DecisionAttachment {
  id: string;
  decision_id: string;
  solution_id: string | null;
  filename: string;
  size: number;
  mime: string;
  created_at: number;
  uploaded_by: string;
  uploaded_by_username: string | null;
  uploaded_by_color: string | null;
}

export interface DecisionDetail {
  decision: Decision;
  solutions: DecisionSolution[];
  comments: DecisionComment[];
  activity: DecisionActivityEvent[];
  attachments: DecisionAttachment[];
}

export interface DecisionInput {
  project_id: string;
  title: string;
  description?: string;
}

export interface DecisionPatch {
  title?: string;
  description?: string;
}

/* --- Gamificación (server/src/routes-gamification.js) --- */

/** Resumen por usuario: saldo, puntos de la semana, racha y total completadas. */
export interface GamUserSummary {
  user_id: string;
  display_name: string | null;
  username: string;
  color: string;
  balance: number;
  week_points: number;
  streak_days: number;
  tasks_done_total: number;
}

/** Entrada reciente del ledger de puntos (una concesión por tarea completada). */
export interface GamLedgerEntry {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  task_id: string;
  task_title: string | null;
  points: number;
  reason: string;
  created_at: number;
  reverted_at?: number | null;
}

/** Canje reciente de una recompensa. */
export interface GamRedemptionEntry {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  reward_id: string;
  reward_title: string;
  reward_emoji: string;
  cost: number;
  created_at: number;
}

/** GET /api/gamification/summary. */
export interface GamificationSummary {
  users: GamUserSummary[];
  recent: GamLedgerEntry[];
  redemptions: GamRedemptionEntry[];
}

/** Recompensa canjeable activa (GET /api/rewards). */
export interface Reward {
  id: string;
  title: string;
  emoji: string;
  cost: number;
  created_by: string;
  created_at: number;
}

export interface RewardInput {
  title: string;
  emoji?: string;
  cost: number;
}

/** Resultado del canje (POST /api/rewards/:id/redeem → 201). */
export interface Redemption {
  id: string;
  reward_id: string;
  user_id: string;
  cost: number;
  created_at: number;
}
