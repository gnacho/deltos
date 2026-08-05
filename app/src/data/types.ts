/** Tipos del dominio Deltos — snake_case, igual que la API (ver server/README.md). */

export type ColumnId = 'nuevo' | 'encurso' | 'hecho';
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
  created_at: number;
}

/** Usuario tal y como llega en el bootstrap (lista reducida). */
export interface BoardUser {
  id: string;
  username: string;
  color: string;
}

export interface Project {
  id: string;
  name: string;
  emoji: string;
  color: string;
  position: number;
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

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  column: ColumnId;
  position: number;
  priority: Priority | null;
  due_date: string | null; // YYYY-MM-DD
  assignee_id: string | null;
  assignee: TaskAssignee | null;
  created_by: string;
  created_at: number;
  updated_at: number;
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

export interface TaskDetail {
  task: Task;
  attachments: Attachment[];
  comments: Comment[];
  activity: ActivityEvent[];
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
}
