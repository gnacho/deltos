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
  archived_at: number | null; // epoch ms; null = activa en el tablero
  labels: Label[];
  counts: { comments: number; attachments: number };
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
