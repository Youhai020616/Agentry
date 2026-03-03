/**
 * Media Studio State Store
 * Manages all state for the 新媒体团队工作台 feature
 *
 * Pipeline Steps 0-4 use real IPC calls to the main process StudioService.
 * Dashboard/CRM/Reports/Content Library/Workflow remain mock data.
 */
import { create } from 'zustand';
import { useSettingsStore } from '@/stores/settings';
import type {
  MediaStudioView,
  Platform,
  TeamMember,
  DashboardStats,
  PlatformMetrics,
  TimelineEvent,
  ApprovalItem,
  ContentItem,
  ContentStatus,
  WorkflowTask,
  StudioStep,
  StepStatus,
  ApiLogEntry,
  BrandAnalysisInput,
  BrandAnalysisResult,
  TextGenerationResult,
  ImageGenerationResult,
  VideoGenerationResult,
  StudioLogEvent,
  DmConversation,
  CommentItem,
  LeadItem,
  DailyReport,
} from '@/types/media-studio';

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const MOCK_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'tm-1',
    name: '琪琪',
    role: '内容主管',
    avatar: '📋',
    avatarColor: 'amber',
    status: 'online',
  },
  {
    id: 'tm-2',
    name: '小美',
    role: '文案创作员',
    avatar: '✍️',
    avatarColor: 'pink',
    status: 'busy',
    currentTask: '正在写小红书文案',
  },
  {
    id: 'tm-3',
    name: '阿杰',
    role: '视觉设计师',
    avatar: '🎨',
    avatarColor: 'purple',
    status: 'busy',
    currentTask: '制作配图中',
  },
  {
    id: 'tm-4',
    name: '小林',
    role: '视频剪辑师',
    avatar: '🎬',
    avatarColor: 'blue',
    status: 'online',
  },
  {
    id: 'tm-5',
    name: '婷婷',
    role: '数据分析员',
    avatar: '📊',
    avatarColor: 'green',
    status: 'online',
  },
  {
    id: 'tm-6',
    name: '小王',
    role: '社群运营',
    avatar: '💬',
    avatarColor: 'orange',
    status: 'busy',
    currentTask: '回复私信中',
  },
  {
    id: 'tm-7',
    name: '阿浩',
    role: '投放专员',
    avatar: '📱',
    avatarColor: 'cyan',
    status: 'idle',
  },
  {
    id: 'tm-8',
    name: '晓雯',
    role: '客服专员',
    avatar: '🎧',
    avatarColor: 'gray',
    status: 'offline',
  },
];

const MOCK_DASHBOARD_STATS: DashboardStats = {
  contentOutput: 8,
  pendingApproval: 3,
  publishedToday: 5,
  newFollowers: 127,
  trends: { contentOutput: 33, published: 25, followers: 18 },
};

const MOCK_PLATFORM_METRICS: PlatformMetrics[] = [
  {
    platform: 'xhs',
    icon: '📕',
    posts: 3,
    views: 2300,
    viewsLabel: '浏览',
    engagement: 156,
    followers: 43,
    fillPercent: 72,
  },
  {
    platform: 'douyin',
    icon: '🎵',
    posts: 2,
    views: 5100,
    viewsLabel: '播放',
    engagement: 312,
    followers: 61,
    fillPercent: 85,
  },
  {
    platform: 'wechat',
    icon: '💚',
    posts: 1,
    views: 892,
    viewsLabel: '阅读',
    engagement: 45,
    followers: 23,
    fillPercent: 56,
  },
];

const MOCK_TIMELINE: TimelineEvent[] = [
  {
    id: 'tl-1',
    time: '09:15',
    actor: '琪琪',
    action: '分配了 3 篇小红书选题给小美',
    icon: '📋',
  },
  {
    id: 'tl-2',
    time: '09:42',
    actor: '小美',
    action: '完成文案《夏日清透妆教程》初稿',
    icon: '✍️',
  },
  {
    id: 'tl-3',
    time: '10:05',
    actor: '阿杰',
    action: '上传了 5 张配图到素材库',
    icon: '🎨',
  },
  {
    id: 'tl-4',
    time: '11:30',
    actor: '婷婷',
    action: '生成了本周数据报告，抖音播放量增长 25%',
    icon: '📊',
  },
  {
    id: 'tl-5',
    time: '13:00',
    actor: '小林',
    action: '完成抖音短视频剪辑《3 步打造日系穿搭》',
    icon: '🎬',
  },
  {
    id: 'tl-6',
    time: '14:20',
    actor: '小王',
    action: '回复了 28 条小红书评论',
    icon: '💬',
  },
  {
    id: 'tl-7',
    time: '15:45',
    actor: '琪琪',
    action: '审核通过 2 篇图文笔记，安排今晚发布',
    icon: '✅',
  },
  {
    id: 'tl-8',
    time: '16:30',
    actor: '阿浩',
    action: '调整了抖音信息流投放预算，日预算 +200 元',
    icon: '📱',
  },
];

const MOCK_APPROVALS: ApprovalItem[] = [
  {
    id: 'ap-1',
    title: '夏日清透妆教程 | 学生党平价好物推荐',
    platform: 'xhs',
    author: '小美',
    type: 'graphic',
    createdAt: '2026-02-28 10:30',
  },
  {
    id: 'ap-2',
    title: '3 步打造日系穿搭 | 春装搭配指南',
    platform: 'douyin',
    author: '小林',
    type: 'video',
    createdAt: '2026-02-28 13:15',
  },
  {
    id: 'ap-3',
    title: '护肤成分避坑指南：烟酰胺真的万能吗？',
    platform: 'wechat',
    author: '小美',
    type: 'article',
    createdAt: '2026-02-28 09:00',
  },
];

const MOCK_CONTENT_ITEMS: ContentItem[] = [
  // 4 drafts
  {
    id: 'ct-1',
    title: '开箱测评：这款平价粉底液绝了！',
    platform: 'xhs',
    type: 'graphic',
    status: 'draft',
    author: '小美',
    tags: ['测评', '粉底液', '平价好物'],
    gradientFrom: '#fbc2eb',
    gradientTo: '#a6c1ee',
    createdAt: '2026-02-28 08:30',
  },
  {
    id: 'ct-2',
    title: '周末 vlog：逛了三里屯最火的咖啡店',
    platform: 'douyin',
    type: 'video',
    status: 'draft',
    author: '小林',
    tags: ['vlog', '咖啡', '三里屯'],
    gradientFrom: '#667eea',
    gradientTo: '#764ba2',
    createdAt: '2026-02-28 09:00',
  },
  {
    id: 'ct-3',
    title: '敏感肌换季护理全攻略',
    platform: 'wechat',
    type: 'article',
    status: 'draft',
    author: '小美',
    tags: ['护肤', '敏感肌', '换季'],
    gradientFrom: '#89f7fe',
    gradientTo: '#66a6ff',
    createdAt: '2026-02-28 07:45',
  },
  {
    id: 'ct-4',
    title: '每日穿搭打卡 Day 15',
    platform: 'xhs',
    type: 'graphic',
    status: 'draft',
    author: '阿杰',
    tags: ['穿搭', 'OOTD', '日常'],
    gradientFrom: '#f093fb',
    gradientTo: '#f5576c',
    createdAt: '2026-02-28 10:00',
  },
  // 3 reviews
  {
    id: 'ct-5',
    title: '夏日清透妆教程 | 学生党平价好物推荐',
    platform: 'xhs',
    type: 'graphic',
    status: 'review',
    author: '小美',
    tags: ['妆教', '学生党', '平价', '夏日'],
    gradientFrom: '#ffecd2',
    gradientTo: '#fcb69f',
    createdAt: '2026-02-28 10:30',
  },
  {
    id: 'ct-6',
    title: '3 步打造日系穿搭 | 春装搭配指南',
    platform: 'douyin',
    type: 'video',
    status: 'review',
    author: '小林',
    tags: ['穿搭', '日系', '春装'],
    gradientFrom: '#a1c4fd',
    gradientTo: '#c2e9fb',
    createdAt: '2026-02-28 13:15',
  },
  {
    id: 'ct-7',
    title: '护肤成分避坑指南：烟酰胺真的万能吗？',
    platform: 'wechat',
    type: 'article',
    status: 'review',
    author: '小美',
    tags: ['护肤', '成分', '科普'],
    gradientFrom: '#d4fc79',
    gradientTo: '#96e6a1',
    createdAt: '2026-02-28 09:00',
  },
  // 5 approved
  {
    id: 'ct-8',
    title: '这 5 支口红颜色也太绝了吧！',
    platform: 'xhs',
    type: 'graphic',
    status: 'approved',
    author: '小美',
    tags: ['口红', '试色', '美妆'],
    gradientFrom: '#ff9a9e',
    gradientTo: '#fecfef',
    createdAt: '2026-02-27 16:00',
  },
  {
    id: 'ct-9',
    title: '健身小白的一周蜕变记录',
    platform: 'douyin',
    type: 'video',
    status: 'approved',
    author: '小林',
    tags: ['健身', '记录', '蜕变'],
    gradientFrom: '#a18cd1',
    gradientTo: '#fbc2eb',
    createdAt: '2026-02-27 14:20',
  },
  {
    id: 'ct-10',
    title: '2026 春季限定色号合集',
    platform: 'xhs',
    type: 'graphic',
    status: 'approved',
    author: '阿杰',
    tags: ['春季', '限定', '色号'],
    gradientFrom: '#fad0c4',
    gradientTo: '#ffd1ff',
    createdAt: '2026-02-27 11:30',
  },
  {
    id: 'ct-11',
    title: '如何用 50 元打造高级感妆容',
    platform: 'douyin',
    type: 'video',
    status: 'approved',
    author: '小林',
    tags: ['平价', '高级感', '妆容'],
    gradientFrom: '#e0c3fc',
    gradientTo: '#8ec5fc',
    createdAt: '2026-02-27 09:45',
  },
  {
    id: 'ct-12',
    title: '品牌联名款包装设计赏析',
    platform: 'wechat',
    type: 'article',
    status: 'approved',
    author: '小美',
    tags: ['联名', '设计', '包装'],
    gradientFrom: '#f5576c',
    gradientTo: '#ff9a9e',
    createdAt: '2026-02-27 08:00',
  },
  // 6 published
  {
    id: 'ct-13',
    title: '早 C 晚 A 护肤法真的有效吗？亲测 30 天',
    platform: 'xhs',
    type: 'graphic',
    status: 'published',
    author: '小美',
    tags: ['护肤', '早C晚A', '测评'],
    gradientFrom: '#667eea',
    gradientTo: '#764ba2',
    createdAt: '2026-02-26 18:00',
    stats: { views: 3200, likes: 245, comments: 38, shares: 12 },
  },
  {
    id: 'ct-14',
    title: '一分钟学会韩式低马尾',
    platform: 'douyin',
    type: 'video',
    status: 'published',
    author: '小林',
    tags: ['发型', '韩式', '教程'],
    gradientFrom: '#f093fb',
    gradientTo: '#f5576c',
    createdAt: '2026-02-26 12:00',
    stats: { views: 8700, likes: 612, comments: 89, shares: 45 },
  },
  {
    id: 'ct-15',
    title: '新手化妆必看！底妆不卡粉的秘诀',
    platform: 'xhs',
    type: 'graphic',
    status: 'published',
    author: '小美',
    tags: ['底妆', '新手', '技巧'],
    gradientFrom: '#4facfe',
    gradientTo: '#00f2fe',
    createdAt: '2026-02-25 19:30',
    stats: { views: 4100, likes: 328, comments: 52, shares: 18 },
  },
  {
    id: 'ct-16',
    title: '探店｜藏在胡同里的宝藏面包店',
    platform: 'douyin',
    type: 'video',
    status: 'published',
    author: '小林',
    tags: ['探店', '面包', '美食'],
    gradientFrom: '#43e97b',
    gradientTo: '#38f9d7',
    createdAt: '2026-02-25 14:00',
    stats: { views: 12400, likes: 983, comments: 156, shares: 78 },
  },
  {
    id: 'ct-17',
    title: '春天到了，你的衣橱该更新了',
    platform: 'wechat',
    type: 'article',
    status: 'published',
    author: '小美',
    tags: ['穿搭', '春装', '衣橱'],
    gradientFrom: '#fa709a',
    gradientTo: '#fee140',
    createdAt: '2026-02-24 10:00',
    stats: { views: 1560, likes: 89, comments: 23, shares: 15 },
  },
  {
    id: 'ct-18',
    title: '学生党期末穿搭不重样 | 7 天穿搭灵感',
    platform: 'xhs',
    type: 'graphic',
    status: 'published',
    author: '阿杰',
    tags: ['学生党', '穿搭', '灵感'],
    gradientFrom: '#a18cd1',
    gradientTo: '#fbc2eb',
    createdAt: '2026-02-24 08:00',
    stats: { views: 5600, likes: 412, comments: 67, shares: 34 },
  },
];

const MOCK_WORKFLOW_TASKS: WorkflowTask[] = [
  // topic (3)
  {
    id: 'wf-1',
    title: '母亲节特别企划：感恩妈妈的美丽秘诀',
    platform: 'xhs',
    column: 'topic',
    assignee: '琪琪',
    priority: 'high',
    dueDate: '2026-03-05',
  },
  {
    id: 'wf-2',
    title: '春季过敏高发期护肤指南',
    platform: 'wechat',
    column: 'topic',
    assignee: '琪琪',
    priority: 'medium',
    dueDate: '2026-03-03',
  },
  {
    id: 'wf-3',
    title: '抖音热门挑战：变装卡点合拍',
    platform: 'douyin',
    column: 'topic',
    assignee: '小林',
    priority: 'low',
    dueDate: '2026-03-04',
  },
  // creating (3)
  {
    id: 'wf-4',
    title: '开箱测评：这款平价粉底液绝了！',
    platform: 'xhs',
    column: 'creating',
    assignee: '小美',
    priority: 'high',
    dueDate: '2026-03-01',
  },
  {
    id: 'wf-5',
    title: '周末 vlog：逛了三里屯最火的咖啡店',
    platform: 'douyin',
    column: 'creating',
    assignee: '小林',
    priority: 'medium',
    dueDate: '2026-03-02',
  },
  {
    id: 'wf-6',
    title: '敏感肌换季护理全攻略',
    platform: 'wechat',
    column: 'creating',
    assignee: '小美',
    priority: 'medium',
    dueDate: '2026-03-01',
  },
  // reviewing (2)
  {
    id: 'wf-7',
    title: '夏日清透妆教程 | 学生党平价好物推荐',
    platform: 'xhs',
    column: 'reviewing',
    assignee: '小美',
    priority: 'high',
    dueDate: '2026-02-28',
  },
  {
    id: 'wf-8',
    title: '3 步打造日系穿搭 | 春装搭配指南',
    platform: 'douyin',
    column: 'reviewing',
    assignee: '小林',
    priority: 'medium',
    dueDate: '2026-02-28',
  },
  // scheduled (2)
  {
    id: 'wf-9',
    title: '这 5 支口红颜色也太绝了吧！',
    platform: 'xhs',
    column: 'scheduled',
    assignee: '小美',
    priority: 'high',
    dueDate: '2026-02-28',
  },
  {
    id: 'wf-10',
    title: '健身小白的一周蜕变记录',
    platform: 'douyin',
    column: 'scheduled',
    assignee: '小林',
    priority: 'low',
    dueDate: '2026-02-28',
  },
  // published (2)
  {
    id: 'wf-11',
    title: '早 C 晚 A 护肤法真的有效吗？亲测 30 天',
    platform: 'xhs',
    column: 'published',
    assignee: '小美',
    priority: 'medium',
  },
  {
    id: 'wf-12',
    title: '一分钟学会韩式低马尾',
    platform: 'douyin',
    column: 'published',
    assignee: '小林',
    priority: 'medium',
  },
];

const MOCK_DM_CONVERSATIONS: DmConversation[] = [
  {
    id: 'dm-1',
    userName: '甜甜圈小姐',
    platform: 'xhs',
    lastMessage: '请问这个粉底液色号怎么选呀？',
    unread: true,
    time: '14:32',
    avatar: '🍩',
  },
  {
    id: 'dm-2',
    userName: '时尚达人Lucy',
    platform: 'xhs',
    lastMessage: '想合作推广，可以聊聊吗？',
    unread: true,
    time: '13:15',
    avatar: '👗',
  },
  {
    id: 'dm-3',
    userName: '护肤小白',
    platform: 'douyin',
    lastMessage: '你们推荐的那款水乳我买了，真的好用！',
    unread: false,
    time: '11:40',
    avatar: '🧴',
  },
  {
    id: 'dm-4',
    userName: '美妆博主阿花',
    platform: 'douyin',
    lastMessage: '下次可以一起拍合作视频吗',
    unread: true,
    time: '10:20',
    avatar: '🌸',
  },
  {
    id: 'dm-5',
    userName: '品牌方-花知晓',
    platform: 'wechat',
    lastMessage: '新品寄样已发出，预计明天到',
    unread: false,
    time: '09:05',
    avatar: '🏢',
  },
];

const MOCK_COMMENTS: CommentItem[] = [
  {
    id: 'cm-1',
    userName: '小仙女日记',
    content: '太好看了！求同款口红色号！',
    platform: 'xhs',
    postTitle: '这 5 支口红颜色也太绝了吧！',
    replied: false,
    aiSuggestion: '谢谢喜欢呀～第三支是 MAC Chili，超显白的！链接放在主页合集里啦 💄',
    time: '15:20',
  },
  {
    id: 'cm-2',
    userName: '爱美丽的猪',
    content: '请问敏感肌可以用吗？',
    platform: 'xhs',
    postTitle: '早 C 晚 A 护肤法真的有效吗？亲测 30 天',
    replied: true,
    time: '14:05',
  },
  {
    id: 'cm-3',
    userName: '穿搭灵感库',
    content: '第二套搭配好好看，外套在哪买的呀',
    platform: 'douyin',
    postTitle: '3 步打造日系穿搭',
    replied: false,
    aiSuggestion: '外套是优衣库今年春季新款～型号 UQ-2026S，门店和线上都有哦 🧥',
    time: '13:48',
  },
  {
    id: 'cm-4',
    userName: '化妆新手小白',
    content: '底妆总是卡粉怎么办😭',
    platform: 'douyin',
    postTitle: '一分钟学会韩式低马尾',
    replied: false,
    aiSuggestion: '卡粉主要是因为妆前保湿没做好！建议上妆前敷个补水面膜，然后用湿美妆蛋上粉底～',
    time: '12:30',
  },
  {
    id: 'cm-5',
    userName: '日系穿搭控',
    content: '收藏了！每天都来看你更新',
    platform: 'xhs',
    postTitle: '学生党期末穿搭不重样',
    replied: true,
    time: '11:15',
  },
  {
    id: 'cm-6',
    userName: '面包爱好者',
    content: '这家店在哪里呀？看着好好吃',
    platform: 'douyin',
    postTitle: '探店｜藏在胡同里的宝藏面包店',
    replied: false,
    aiSuggestion: '在东城区南锣鼓巷附近，具体地址：xx胡同12号～周末去的话建议早点，排队人很多！🍞',
    time: '10:00',
  },
];

const MOCK_LEADS: LeadItem[] = [
  {
    id: 'ld-1',
    name: '花知晓品牌方',
    platform: 'wechat',
    source: '私信咨询',
    tags: ['品牌合作', '美妆'],
    interactions: 12,
    intent: 'high',
    lastActive: '2026-02-28 14:00',
  },
  {
    id: 'ld-2',
    name: '时尚达人Lucy',
    platform: 'xhs',
    source: '评论互动',
    tags: ['博主互推', '穿搭'],
    interactions: 8,
    intent: 'high',
    lastActive: '2026-02-28 13:15',
  },
  {
    id: 'ld-3',
    name: '完美日记市场部',
    platform: 'wechat',
    source: '邮件联络',
    tags: ['品牌合作', '美妆', '大品牌'],
    interactions: 5,
    intent: 'high',
    lastActive: '2026-02-27 16:30',
  },
  {
    id: 'ld-4',
    name: '甜甜圈小姐',
    platform: 'xhs',
    source: '私信咨询',
    tags: ['粉丝', '潜在客户'],
    interactions: 3,
    intent: 'medium',
    lastActive: '2026-02-28 14:32',
  },
  {
    id: 'ld-5',
    name: '美妆博主阿花',
    platform: 'douyin',
    source: '私信咨询',
    tags: ['博主互推', '美妆'],
    interactions: 6,
    intent: 'medium',
    lastActive: '2026-02-28 10:20',
  },
  {
    id: 'ld-6',
    name: '某MCN机构',
    platform: 'wechat',
    source: '邮件联络',
    tags: ['MCN', '签约'],
    interactions: 2,
    intent: 'medium',
    lastActive: '2026-02-26 11:00',
  },
  {
    id: 'ld-7',
    name: '护肤小白',
    platform: 'douyin',
    source: '评论互动',
    tags: ['粉丝', '活跃用户'],
    interactions: 15,
    intent: 'low',
    lastActive: '2026-02-28 11:40',
  },
  {
    id: 'ld-8',
    name: '穿搭灵感库',
    platform: 'douyin',
    source: '评论互动',
    tags: ['粉丝', '穿搭'],
    interactions: 4,
    intent: 'low',
    lastActive: '2026-02-28 13:48',
  },
];

const MOCK_DAILY_REPORT: DailyReport = {
  date: '2026-02-28',
  contentProduced: 8,
  contentPublished: 5,
  totalViews: 8292,
  totalEngagement: 513,
  newFollowers: 127,
  topContent: '探店｜藏在胡同里的宝藏面包店',
  apiCost: 3.42,
  highlights: [
    '抖音短视频《探店面包店》播放量突破 1.2 万，互动率 7.9%',
    '小红书新增粉丝 43 人，主要来源为妆教类内容',
    '微信公众号文章打开率 56%，高于行业平均 42%',
    '本日 API 调用成本 ¥3.42，较昨日下降 12%',
  ],
};

// ---------------------------------------------------------------------------
// Pipeline cancellation counter
// ---------------------------------------------------------------------------

let _runId = 0;

// ---------------------------------------------------------------------------
// Helper: create a log entry
// ---------------------------------------------------------------------------

function logEntry(type: ApiLogEntry['type'], message: string): ApiLogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    type,
    message,
  };
}

// ---------------------------------------------------------------------------
// Store Interface
// ---------------------------------------------------------------------------

interface MediaStudioState {
  // Navigation
  activeView: MediaStudioView;
  setActiveView: (view: MediaStudioView) => void;

  // Dashboard
  stats: DashboardStats;
  platformMetrics: PlatformMetrics[];
  timeline: TimelineEvent[];
  approvals: ApprovalItem[];
  teamMembers: TeamMember[];

  // Content Library
  contentItems: ContentItem[];
  contentFilter: ContentStatus | 'all';
  contentPlatformFilter: Platform | 'all';
  setContentFilter: (f: ContentStatus | 'all') => void;
  setContentPlatformFilter: (f: Platform | 'all') => void;

  // Workflow
  workflowTasks: WorkflowTask[];
  workflowFilter: Platform | 'all';
  setWorkflowFilter: (f: Platform | 'all') => void;

  // Studio Pipeline
  studioStep: StudioStep;
  stepStatuses: Record<StudioStep, StepStatus>;
  setStudioStep: (step: StudioStep) => void;

  // Step 0: Brand Analysis
  brandAnalysisLog: ApiLogEntry[];
  brandAnalysisResult: BrandAnalysisResult | null;
  brandAnalysisRunning: boolean;
  startBrandAnalysis: (params: BrandAnalysisInput) => Promise<void>;

  // Step 1: Text Generation
  textGenLog: ApiLogEntry[];
  textGenResult: TextGenerationResult | null;
  textGenRunning: boolean;
  startTextGeneration: () => Promise<void>;

  // Step 2: Image Generation
  imageGenLog: ApiLogEntry[];
  imageGenResult: ImageGenerationResult | null;
  imageGenRunning: boolean;
  startImageGeneration: () => Promise<void>;

  // Step 3: Video Generation
  videoGenLog: ApiLogEntry[];
  videoGenResult: VideoGenerationResult | null;
  videoGenRunning: boolean;
  startVideoGeneration: () => Promise<void>;

  // Step 4: Publish
  publishLog: ApiLogEntry[];
  publishComplete: boolean;
  publishRunning: boolean;
  startPublish: () => Promise<void>;

  cancelStudio: () => Promise<void>;
  resetStudio: () => void;

  // CRM
  dmConversations: DmConversation[];
  comments: CommentItem[];
  leads: LeadItem[];
  crmTab: 'dm' | 'comments' | 'leads';
  setCrmTab: (tab: 'dm' | 'comments' | 'leads') => void;

  // Reports
  dailyReport: DailyReport;

  // Mode
  operationMode: 'auto' | 'manual';
  toggleOperationMode: () => void;

  // Internal
  _runId: number;
}

// ---------------------------------------------------------------------------
// Initial step statuses
// ---------------------------------------------------------------------------

const INITIAL_STEP_STATUSES: Record<StudioStep, StepStatus> = {
  0: 'pending',
  1: 'pending',
  2: 'pending',
  3: 'pending',
  4: 'pending',
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useMediaStudioStore = create<MediaStudioState>((set, get) => ({
  // -- Navigation --
  activeView: 'dashboard',
  setActiveView: (view) => set({ activeView: view }),

  // -- Dashboard --
  stats: MOCK_DASHBOARD_STATS,
  platformMetrics: MOCK_PLATFORM_METRICS,
  timeline: MOCK_TIMELINE,
  approvals: MOCK_APPROVALS,
  teamMembers: MOCK_TEAM_MEMBERS,

  // -- Content Library --
  contentItems: MOCK_CONTENT_ITEMS,
  contentFilter: 'all',
  contentPlatformFilter: 'all',
  setContentFilter: (f) => set({ contentFilter: f }),
  setContentPlatformFilter: (f) => set({ contentPlatformFilter: f }),

  // -- Workflow --
  workflowTasks: MOCK_WORKFLOW_TASKS,
  workflowFilter: 'all',
  setWorkflowFilter: (f) => set({ workflowFilter: f }),

  // -- Studio Pipeline --
  studioStep: 0 as StudioStep,
  stepStatuses: { ...INITIAL_STEP_STATUSES },
  setStudioStep: (step) => set({ studioStep: step }),

  // Step 0: Brand Analysis
  brandAnalysisLog: [],
  brandAnalysisResult: null,
  brandAnalysisRunning: false,

  startBrandAnalysis: async (params: BrandAnalysisInput) => {
    const runId = ++_runId;
    set({
      brandAnalysisRunning: true,
      brandAnalysisLog: [],
      brandAnalysisResult: null,
      _runId: runId,
      stepStatuses: { ...get().stepStatuses, 0: 'running' },
    });

    try {
      const resp = await window.electron.ipcRenderer.invoke('studio:brand-analysis', params);
      const { success, result, error } = resp as {
        success: boolean;
        result?: BrandAnalysisResult;
        error?: string;
      };

      if (get()._runId !== runId) return; // cancelled

      if (success && result) {
        set({
          brandAnalysisResult: result,
          brandAnalysisRunning: false,
          stepStatuses: { ...get().stepStatuses, 0: 'done' },
        });
      } else {
        set((s) => ({
          brandAnalysisRunning: false,
          stepStatuses: { ...s.stepStatuses, 0: 'pending' },
          brandAnalysisLog: [
            ...s.brandAnalysisLog,
            logEntry('error', error ?? 'Brand analysis failed'),
          ],
        }));
      }
    } catch (err) {
      if (get()._runId !== runId) return;
      set((s) => ({
        brandAnalysisRunning: false,
        stepStatuses: { ...s.stepStatuses, 0: 'pending' },
        brandAnalysisLog: [...s.brandAnalysisLog, logEntry('error', String(err))],
      }));
    }
  },

  // Step 1: Text Generation
  textGenLog: [],
  textGenResult: null,
  textGenRunning: false,

  startTextGeneration: async () => {
    const runId = ++_runId;
    const { brandAnalysisResult } = get();
    if (!brandAnalysisResult) return;

    set({
      textGenRunning: true,
      textGenLog: [],
      textGenResult: null,
      _runId: runId,
      stepStatuses: { ...get().stepStatuses, 1: 'running' },
    });

    try {
      // Derive platform from brand analysis calendar or default to first available
      const calendarPlatforms = brandAnalysisResult.calendar?.map((c) => c.platform) ?? [];
      const derivedPlatform: Platform = calendarPlatforms.length > 0 ? calendarPlatforms[0] : 'xhs';

      const resp = await window.electron.ipcRenderer.invoke('studio:text-generation', {
        brandAnalysis: brandAnalysisResult,
        platform: derivedPlatform,
        contentType: derivedPlatform === 'douyin' ? '短视频脚本' : '图文笔记',
      });
      const { success, result, error } = resp as {
        success: boolean;
        result?: TextGenerationResult;
        error?: string;
      };

      if (get()._runId !== runId) return;

      if (success && result) {
        set({
          textGenResult: result,
          textGenRunning: false,
          stepStatuses: { ...get().stepStatuses, 1: 'done' },
        });
      } else {
        set((s) => ({
          textGenRunning: false,
          stepStatuses: { ...s.stepStatuses, 1: 'pending' },
          textGenLog: [...s.textGenLog, logEntry('error', error ?? 'Text generation failed')],
        }));
      }
    } catch (err) {
      if (get()._runId !== runId) return;
      set((s) => ({
        textGenRunning: false,
        stepStatuses: { ...s.stepStatuses, 1: 'pending' },
        textGenLog: [...s.textGenLog, logEntry('error', String(err))],
      }));
    }
  },

  // Step 2: Image Generation
  imageGenLog: [],
  imageGenResult: null,
  imageGenRunning: false,

  startImageGeneration: async () => {
    const runId = ++_runId;
    const { textGenResult } = get();
    if (!textGenResult) return;

    set({
      imageGenRunning: true,
      imageGenLog: [],
      imageGenResult: null,
      _runId: runId,
      stepStatuses: { ...get().stepStatuses, 2: 'running' },
    });

    try {
      const { mediaStudio } = useSettingsStore.getState();
      const resp = await window.electron.ipcRenderer.invoke('studio:image-generation', {
        text: textGenResult,
        count: 5,
        ...(mediaStudio.imageApiKey ? { imageApiKey: mediaStudio.imageApiKey } : {}),
        ...(mediaStudio.imageModel ? { imageModel: mediaStudio.imageModel } : {}),
      });
      const { success, result, error } = resp as {
        success: boolean;
        result?: ImageGenerationResult;
        error?: string;
      };

      if (get()._runId !== runId) return;

      if (success && result) {
        set({
          imageGenResult: result,
          imageGenRunning: false,
          stepStatuses: { ...get().stepStatuses, 2: 'done' },
        });
      } else {
        set((s) => ({
          imageGenRunning: false,
          stepStatuses: { ...s.stepStatuses, 2: 'pending' },
          imageGenLog: [...s.imageGenLog, logEntry('error', error ?? 'Image generation failed')],
        }));
      }
    } catch (err) {
      if (get()._runId !== runId) return;
      set((s) => ({
        imageGenRunning: false,
        stepStatuses: { ...s.stepStatuses, 2: 'pending' },
        imageGenLog: [...s.imageGenLog, logEntry('error', String(err))],
      }));
    }
  },

  // Step 3: Video Generation
  videoGenLog: [],
  videoGenResult: null,
  videoGenRunning: false,

  startVideoGeneration: async () => {
    const runId = ++_runId;
    const { textGenResult, imageGenResult } = get();
    if (!textGenResult || !imageGenResult) return;

    set({
      videoGenRunning: true,
      videoGenLog: [],
      videoGenResult: null,
      _runId: runId,
      stepStatuses: { ...get().stepStatuses, 3: 'running' },
    });

    try {
      const { mediaStudio } = useSettingsStore.getState();
      const resp = await window.electron.ipcRenderer.invoke('studio:video-generation', {
        text: textGenResult,
        images: imageGenResult,
        ...(mediaStudio.videoApiKey ? { videoApiKey: mediaStudio.videoApiKey } : {}),
        ...(mediaStudio.videoModel ? { videoModel: mediaStudio.videoModel } : {}),
        ...(mediaStudio.videoApiUrl ? { videoApiUrl: mediaStudio.videoApiUrl } : {}),
      });
      const { success, result, error } = resp as {
        success: boolean;
        result?: VideoGenerationResult;
        error?: string;
      };

      if (get()._runId !== runId) return;

      if (success && result) {
        set({
          videoGenResult: result,
          videoGenRunning: false,
          stepStatuses: {
            ...get().stepStatuses,
            3: 'done',
          },
        });
      } else {
        set((s) => ({
          videoGenRunning: false,
          stepStatuses: { ...s.stepStatuses, 3: 'pending' },
          videoGenLog: [...s.videoGenLog, logEntry('error', error ?? 'Video generation failed')],
        }));
      }
    } catch (err) {
      if (get()._runId !== runId) return;
      set((s) => ({
        videoGenRunning: false,
        stepStatuses: { ...s.stepStatuses, 3: 'pending' },
        videoGenLog: [...s.videoGenLog, logEntry('error', String(err))],
      }));
    }
  },

  // Step 4: Publish
  publishLog: [],
  publishComplete: false,
  publishRunning: false,

  startPublish: async () => {
    const runId = ++_runId;
    const { textGenResult, imageGenResult, videoGenResult } = get();
    if (!textGenResult || !imageGenResult) return;

    set({
      publishRunning: true,
      publishLog: [],
      publishComplete: false,
      _runId: runId,
      stepStatuses: { ...get().stepStatuses, 4: 'running' },
    });

    try {
      const resp = await window.electron.ipcRenderer.invoke('studio:publish', {
        platform: textGenResult.platform || 'xhs',
        text: textGenResult,
        images: imageGenResult,
        video: videoGenResult?.status !== 'failed' ? videoGenResult : undefined,
      });
      const { success, result, error } = resp as {
        success: boolean;
        result?: { success: boolean; url?: string; error?: string };
        error?: string;
      };

      if (get()._runId !== runId) return;

      if (success && result?.success) {
        set({
          publishComplete: true,
          publishRunning: false,
          stepStatuses: { ...get().stepStatuses, 4: 'done' },
        });
      } else {
        const errMsg = result?.error || error || 'Publish failed';
        set((s) => ({
          publishRunning: false,
          stepStatuses: { ...s.stepStatuses, 4: 'pending' },
          publishLog: [...s.publishLog, logEntry('error', errMsg)],
        }));
      }
    } catch (err) {
      if (get()._runId !== runId) return;
      set((s) => ({
        publishRunning: false,
        stepStatuses: { ...s.stepStatuses, 4: 'pending' },
        publishLog: [...s.publishLog, logEntry('error', String(err))],
      }));
    }
  },

  cancelStudio: async () => {
    ++_runId;
    set({
      brandAnalysisRunning: false,
      textGenRunning: false,
      imageGenRunning: false,
      videoGenRunning: false,
      publishRunning: false,
    });
    try {
      await window.electron.ipcRenderer.invoke('studio:cancel');
    } catch {
      // best effort
    }
  },

  resetStudio: () => {
    ++_runId;
    set({
      studioStep: 0 as StudioStep,
      stepStatuses: { ...INITIAL_STEP_STATUSES },
      brandAnalysisLog: [],
      brandAnalysisResult: null,
      brandAnalysisRunning: false,
      textGenLog: [],
      textGenResult: null,
      textGenRunning: false,
      imageGenLog: [],
      imageGenResult: null,
      imageGenRunning: false,
      videoGenLog: [],
      videoGenResult: null,
      videoGenRunning: false,
      publishLog: [],
      publishComplete: false,
      publishRunning: false,
    });
    // Also cancel any in-flight backend work
    try {
      window.electron.ipcRenderer.invoke('studio:cancel');
    } catch {
      // best effort
    }
  },

  // -- CRM --
  dmConversations: MOCK_DM_CONVERSATIONS,
  comments: MOCK_COMMENTS,
  leads: MOCK_LEADS,
  crmTab: 'dm',
  setCrmTab: (tab) => set({ crmTab: tab }),

  // -- Reports --
  dailyReport: MOCK_DAILY_REPORT,

  // -- Mode --
  operationMode: 'auto',
  toggleOperationMode: () =>
    set((s) => ({ operationMode: s.operationMode === 'auto' ? 'manual' : 'auto' })),

  // -- Internal --
  _runId: 0,
}));

// ---------------------------------------------------------------------------
// studio:log IPC listener — appends real-time logs from main process
// ---------------------------------------------------------------------------

let _studioLogHandler: ((...args: unknown[]) => void) | null = null;

const STUDIO_LOG_KEYS: Record<
  number,
  keyof Pick<
    MediaStudioState,
    'brandAnalysisLog' | 'textGenLog' | 'imageGenLog' | 'videoGenLog' | 'publishLog'
  >
> = {
  0: 'brandAnalysisLog',
  1: 'textGenLog',
  2: 'imageGenLog',
  3: 'videoGenLog',
  4: 'publishLog',
};

/**
 * Call once (e.g. in a top-level useEffect in MediaStudio/index.tsx) to wire
 * the main-process log stream into the store.  Returns a cleanup function.
 *
 * Safe to call multiple times — always removes the previous listener before
 * registering a new one, preventing the MaxListenersExceededWarning that
 * occurred during HMR / React StrictMode double-mount cycles.
 */
export function setupStudioLogListener(): () => void {
  // Always remove previous listener first to prevent accumulation
  if (_studioLogHandler) {
    window.electron.ipcRenderer.off('studio:log', _studioLogHandler);
    _studioLogHandler = null;
  }

  const handler = (...args: unknown[]) => {
    const logEvent = args[1] as StudioLogEvent;
    if (!logEvent || typeof logEvent.step !== 'number') return;
    const key = STUDIO_LOG_KEYS[logEvent.step];
    if (!key) return;
    const state = useMediaStudioStore.getState();
    useMediaStudioStore.setState({
      [key]: [...(state[key] as ApiLogEntry[]), logEvent],
    });
  };

  _studioLogHandler = handler;
  window.electron.ipcRenderer.on('studio:log', handler);

  return () => {
    if (_studioLogHandler === handler) {
      window.electron.ipcRenderer.off('studio:log', handler);
      _studioLogHandler = null;
    }
  };
}
