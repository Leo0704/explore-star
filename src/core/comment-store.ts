import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { logger } from './logger.js';

const log = logger.child({ module: 'comment-store' });

export interface StoredComment {
  id?: number;
  aweme_id: string;
  comment_text: string;
  nickname: string;
  video_url: string;
  video_desc: string;
  keyword: string;
  collected_at?: string;
  analyzed_at?: string;
  analysis_status?: 'pending' | 'success' | 'failed';
}

export class CommentStore {
  private db: DatabaseType;

  constructor(dbPath: string = './data/comments.db') {
    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aweme_id TEXT NOT NULL,
        comment_text TEXT NOT NULL,
        nickname TEXT,
        video_url TEXT,
        video_desc TEXT,
        keyword TEXT,
        collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        analyzed_at DATETIME,
        analysis_status TEXT DEFAULT 'pending',
        UNIQUE(aweme_id, comment_text)
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_comments_analysis_status ON comments(analysis_status);
      CREATE INDEX IF NOT EXISTS idx_comments_collected_at ON comments(collected_at);
      CREATE INDEX IF NOT EXISTS idx_comments_aweme_id ON comments(aweme_id);
    `);

    log.info('CommentStore 初始化完成');
  }

  // 保存评论，返回是否为新评论
  saveComment(comment: StoredComment): boolean {
    try {
      this.db.prepare(`
        INSERT INTO comments (aweme_id, comment_text, nickname, video_url, video_desc, keyword)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        comment.aweme_id,
        comment.comment_text,
        comment.nickname,
        comment.video_url,
        comment.video_desc,
        comment.keyword,
      );
      return true;  // 新评论
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        return false;  // 已存在，跳过
      }
      throw e;
    }
  }

  // 批量保存评论，返回新评论数量
  saveComments(comments: StoredComment[]): number {
    let newCount = 0;
    const insert = this.db.prepare(`
      INSERT INTO comments (aweme_id, comment_text, nickname, video_url, video_desc, keyword)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: StoredComment[]) => {
      for (const comment of items) {
        try {
          insert.run(
            comment.aweme_id,
            comment.comment_text,
            comment.nickname,
            comment.video_url,
            comment.video_desc,
            comment.keyword,
          );
          newCount++;
        } catch (e: any) {
          if (!e.message?.includes('UNIQUE constraint failed')) {
            throw e;
          }
        }
      }
    });

    insertMany(comments);
    return newCount;
  }

  // 获取未分析的评论
  getUnanalyzedComments(limit: number = 100): StoredComment[] {
    return this.db.prepare(`
      SELECT * FROM comments
      WHERE analysis_status = 'pending'
      ORDER BY collected_at DESC
      LIMIT ?
    `).all(limit) as StoredComment[];
  }

  // 标记评论为已分析
  markAnalyzed(commentId: number, status: 'success' | 'failed'): void {
    this.db.prepare(`
      UPDATE comments
      SET analyzed_at = CURRENT_TIMESTAMP, analysis_status = ?
      WHERE id = ?
    `).run(status, commentId);
  }

  // 批量标记评论为已分析
  markManyAnalyzed(commentIds: number[], status: 'success' | 'failed'): void {
    const update = this.db.prepare(`
      UPDATE comments
      SET analyzed_at = CURRENT_TIMESTAMP, analysis_status = ?
      WHERE id = ?
    `);

    const updateMany = this.db.transaction((ids: number[]) => {
      for (const id of ids) {
        update.run(status, id);
      }
    });

    updateMany(commentIds);
  }

  // 获取统计信息
  getStats(): {
    total: number;
    pending: number;
    success: number;
    failed: number;
  } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN analysis_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN analysis_status = 'success' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN analysis_status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM comments
    `).get() as any;

    return {
      total: stats.total || 0,
      pending: stats.pending || 0,
      success: stats.success || 0,
      failed: stats.failed || 0,
    };
  }

  // 清理旧数据
  cleanOldData(days: number = 90): number {
    const result = this.db.prepare(`
      DELETE FROM comments
      WHERE collected_at < datetime('now', '-${days} days')
    `).run();
    return result.changes;
  }

  // 关闭数据库
  close(): void {
    this.db.close();
  }
}

// 单例模式
let instance: CommentStore | null = null;

export function getCommentStore(dbPath?: string): CommentStore {
  if (!instance) {
    instance = new CommentStore(dbPath);
  }
  return instance;
}
