/**
 * Media Studio Types
 * Types for the 新媒体团队工作台 feature
 */

// -- Navigation --
export type MediaStudioView =
  | 'dashboard'
  | 'workflow'
  | 'chat'
  | 'content'
  | 'studio'
  | 'crm'
  | 'cost'
  | 'reports';

// -- Platforms --
export type Platform = 'xhs' | 'douyin' | 'wechat';

// -- Team --
export type TeamMemberStatus = 'online' | 'busy' | 'idle' | 'offline';

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  avatar: string;
  avatarColor: string;
  status: TeamMemberStatus;
  currentTask?: string;
}

// -- Dashboard --
export interface DashboardStats {
  contentOutput: number;
  pendingApproval: number;
  publishedToday: number;
  newFollowers: number;
  trends: { contentOutput: number; published: number; followers: number };
}

export interface PlatformMetrics {
  platform: Platform;
  icon: string;
  posts: number;
  views: number;
  viewsLabel: string;
  engagement: number;
  followers: number;
  fillPercent: number;
}

export interface TimelineEvent {
  id: string;
  time: string;
  actor: string;
  action: string;
  icon: string;
}

export interface ApprovalItem {
  id: string;
  title: string;
  platform: Platform;
  author: string;
  type: ContentType;
  createdAt: string;
  thumbnail?: string;
}

// -- Content --
export type ContentStatus = 'draft' | 'review' | 'approved' | 'published';
export type ContentType = 'graphic' | 'video' | 'article';

export interface ContentItem {
  id: string;
  title: string;
  platform: Platform;
  type: ContentType;
  status: ContentStatus;
  author: string;
  tags: string[];
  gradientFrom: string;
  gradientTo: string;
  createdAt: string;
  stats?: { views: number; likes: number; comments: number; shares: number };
}

// -- Workflow / Kanban --
export type KanbanColumn = 'topic' | 'creating' | 'reviewing' | 'scheduled' | 'published';

export interface WorkflowTask {
  id: string;
  title: string;
  platform: Platform;
  column: KanbanColumn;
  assignee: string;
  priority: 'high' | 'medium' | 'low';
  dueDate?: string;
}

// -- Studio Pipeline --
export type StudioStep = 0 | 1 | 2 | 3 | 4;
export type StepStatus = 'pending' | 'running' | 'done';

export interface ApiLogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'request' | 'response' | 'success' | 'error' | 'tool';
  message: string;
}

export interface BrandAnalysisResult {
  competitors: Array<{
    name: string;
    platform: string;
    followers: string;
    style: string;
    strengths: string[];
  }>;
  strategy: {
    positioning: string;
    toneOfVoice: string;
    contentPillars: string[];
    postFrequency: string;
  };
  calendar: Array<{ day: string; platform: Platform; topic: string; type: string }>;
}

export interface TextGenerationResult {
  title: string;
  body: string;
  tags: string[];
  wordCount: number;
  platform: Platform;
}

export interface ImageGenerationResult {
  images: Array<{ id: string; label: string; gradientFrom: string; gradientTo: string }>;
}

export interface VideoGenerationResult {
  title: string;
  duration: string;
  prompt: string;
  params: Record<string, string>;
}

// -- CRM --
export interface DmConversation {
  id: string;
  userName: string;
  platform: Platform;
  lastMessage: string;
  unread: boolean;
  time: string;
  avatar: string;
}

export interface CommentItem {
  id: string;
  userName: string;
  content: string;
  platform: Platform;
  postTitle: string;
  replied: boolean;
  aiSuggestion?: string;
  time: string;
}

export interface LeadItem {
  id: string;
  name: string;
  platform: Platform;
  source: string;
  tags: string[];
  interactions: number;
  intent: 'high' | 'medium' | 'low';
  lastActive: string;
}

// -- Reports --
export interface DailyReport {
  date: string;
  contentProduced: number;
  contentPublished: number;
  totalViews: number;
  totalEngagement: number;
  newFollowers: number;
  topContent: string;
  apiCost: number;
  highlights: string[];
}
