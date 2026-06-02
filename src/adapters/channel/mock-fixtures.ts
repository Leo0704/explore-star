/**
 * MOCK_CHANNEL 固定 fixtures（Phase 3 #5 多渠道架构准备）
 *
 * 设计原则：
 *   - 用真实中文（避免 LLM 拒绝处理）
 *   - 3 个视频 + 每个 3 条评论 = 9 评论总数
 *   - 1 条高意向（"想试试你们的服务"）+ 1 条中性 + 1 条 emoji-only
 *     → emoji-only 会被 comment_filters 过滤掉，验证 e2e 完整性
 *
 * 启用方式：MOCK_CHANNEL=1（CLI 注入）/ injectChannel（测试注入）
 */

import type { UserVideo, Video } from '../../core/types.js';

const FIXTURE_SEC_UID = 'MOCK_SEC_UID_DEMO';

export const MOCK_VIDEO_FIXTURES: Video[] = [
  {
    rank: 1,
    desc: 'AI 客服系统 1 个月落地实战分享，3 人小团队也能做',
    author: 'AI 落地老王',
    url: 'https://www.douyin.com/video/mock-v-001',
    plays: 12500,
    likes: 832,
    comments: 64,
    shares: 21,
    aweme_id: 'mock-v-001',
  },
  {
    rank: 2,
    desc: '用 AI 自动化帮自媒体团队省下 80% 剪辑时间',
    author: '自媒体老司机',
    url: 'https://www.douyin.com/video/mock-v-002',
    plays: 8800,
    likes: 412,
    comments: 38,
    shares: 15,
    aweme_id: 'mock-v-002',
  },
  {
    rank: 3,
    desc: '小企业该不该上 AI 工具？我的真实踩坑经验',
    author: '小企业主笔记',
    url: 'https://www.douyin.com/video/mock-v-003',
    plays: 5200,
    likes: 256,
    comments: 22,
    shares: 8,
    aweme_id: 'mock-v-003',
  },
];

export const MOCK_USER_VIDEOS: UserVideo[] = [
  {
    index: 1,
    aweme_id: 'mock-v-001',
    title: 'AI 客服系统 1 个月落地实战分享，3 人小团队也能做',
    duration: 95,
    digg_count: 832,
    play_url: 'https://www.douyin.com/video/mock-v-001',
    top_comments: [
      {
        cid: 'mock-c-001-1',
        text: '想试试你们的服务，我们电商团队 5 个人，每天 200 单咨询',
        user: {
          nickname: '电商张老板',
          uid: 'mock-uid-001',
          follower_count: 1280,
          signature: '5 人小团队，专注家居',
        },
        digg_count: 12,
        create_time: 1717000000,
        reply_count: 1,
      },
      {
        cid: 'mock-c-001-2',
        text: '做得不错，思路清晰',
        user: {
          nickname: 'AI 观察员',
          uid: 'mock-uid-002',
          follower_count: 320,
          signature: '',
        },
        digg_count: 3,
        create_time: 1717100000,
        reply_count: 0,
      },
      {
        cid: 'mock-c-001-3',
        text: '👍👍👍',
        user: {
          nickname: '路人甲',
          uid: 'mock-uid-003',
          follower_count: 12,
          signature: '',
        },
        digg_count: 1,
        create_time: 1717200000,
        reply_count: 0,
      },
    ],
  },
  {
    index: 2,
    aweme_id: 'mock-v-002',
    title: '用 AI 自动化帮自媒体团队省下 80% 剪辑时间',
    duration: 120,
    digg_count: 412,
    play_url: 'https://www.douyin.com/video/mock-v-002',
    top_comments: [
      {
        cid: 'mock-c-002-1',
        text: '我们 3 个人的小团队天天加班剪到凌晨，太需要了！',
        user: {
          nickname: '剪辑小白',
          uid: 'mock-uid-004',
          follower_count: 56,
          signature: '做美食短视频',
        },
        digg_count: 8,
        create_time: 1717300000,
        reply_count: 0,
      },
      {
        cid: 'mock-c-002-2',
        text: '学习到了',
        user: {
          nickname: '小李',
          uid: 'mock-uid-005',
          follower_count: 20,
          signature: '',
        },
        digg_count: 0,
        create_time: 1717400000,
        reply_count: 0,
      },
      {
        cid: 'mock-c-002-3',
        text: '🔥🔥',
        user: {
          nickname: '热心观众',
          uid: 'mock-uid-006',
          follower_count: 3,
          signature: '',
        },
        digg_count: 0,
        create_time: 1717500000,
        reply_count: 0,
      },
    ],
  },
  {
    index: 3,
    aweme_id: 'mock-v-003',
    title: '小企业该不该上 AI 工具？我的真实踩坑经验',
    duration: 80,
    digg_count: 256,
    play_url: 'https://www.douyin.com/video/mock-v-003',
    top_comments: [
      {
        cid: 'mock-c-003-1',
        text: '请问你们是怎么评估 ROI 的？',
        user: {
          nickname: '咨询顾问老陈',
          uid: 'mock-uid-007',
          follower_count: 8500,
          signature: '管理咨询 10 年',
        },
        digg_count: 24,
        create_time: 1717600000,
        reply_count: 2,
      },
      {
        cid: 'mock-c-003-2',
        text: '值得参考',
        user: {
          nickname: '创业中',
          uid: 'mock-uid-008',
          follower_count: 100,
          signature: '',
        },
        digg_count: 2,
        create_time: 1717700000,
        reply_count: 0,
      },
      {
        cid: 'mock-c-003-3',
        text: '❤️',
        user: {
          nickname: '小粉丝',
          uid: 'mock-uid-009',
          follower_count: 1,
          signature: '',
        },
        digg_count: 0,
        create_time: 1717800000,
        reply_count: 0,
      },
    ],
  },
];

export const MOCK_DEMO_SEC_UID = FIXTURE_SEC_UID;
