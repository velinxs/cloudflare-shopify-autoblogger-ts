
import { z } from 'zod';
import { OpenAI } from 'openai';
import { ShopifyAutobloggerAgent } from './index';

const keywordSchema = z.object({
  id: z.string(),
  keyword: z.string(),
  priority_score: z.number(),
  intent: z.string(),
  difficulty: z.string(),
  content_angle: z.string(),
  status: z.enum(['new', 'used', 'ready']),
  created_date: z.string(),
  article_id: z.string().optional(),
  article_url: z.string().optional(),
});

export type Keyword = z.infer<typeof keywordSchema>;

export class KeywordManager {
  private openai: OpenAI;
  private agent: ShopifyAutobloggerAgent;

  constructor(openai: OpenAI, agent: ShopifyAutobloggerAgent) {
    this.openai = openai;
    this.agent = agent;
  }

  async initSchema(): Promise<void> {
    await this.agent.sql`
      CREATE TABLE IF NOT EXISTS keywords (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        priority_score REAL,
        intent TEXT,
        difficulty TEXT,
        content_angle TEXT,
        status TEXT,
        created_date TEXT,
        article_id TEXT,
        article_url TEXT
      );
    `;
  }

  async researchKeywords(topic: string, count: number, niche: string): Promise<Keyword[]> {
    const prompt = `Research ${count} keywords for the topic "${topic}" in the "${niche}" niche. For each keyword, provide a priority score (1-10), user intent, difficulty, and a content angle. Return as a JSON array of objects with keys: keyword, priority_score, intent, difficulty, content_angle.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const keywordsData = JSON.parse(response.choices[0].message.content || '[]').keywords;

    const keywords: Keyword[] = keywordsData.map((kw: any) => ({
      ...kw,
      id: crypto.randomUUID(),
      status: 'new',
      created_date: new Date().toISOString(),
    }));

    return keywords;
  }

  async addKeywords(keywords: Keyword[]): Promise<void> {
    for (const kw of keywords) {
      await this.agent.sql`
        INSERT INTO keywords (id, keyword, priority_score, intent, difficulty, content_angle, status, created_date)
        VALUES (${kw.id}, ${kw.keyword}, ${kw.priority_score}, ${kw.intent}, ${kw.difficulty}, ${kw.content_angle}, ${kw.status}, ${kw.created_date});
      `;
    }
  }

  async getNextKeywords(count: number, minPriority: number): Promise<Keyword[]> {
    return this.agent.sql<Keyword[]>`
      SELECT * FROM keywords
      WHERE status = 'new' AND priority_score >= ${minPriority}
      ORDER BY priority_score DESC
      LIMIT ${count};
    `;
  }

  async markKeywordUsed(keyword: string, articleId: string, articleUrl: string): Promise<void> {
    await this.agent.sql`
      UPDATE keywords
      SET status = 'used', article_id = ${articleId}, article_url = ${articleUrl}
      WHERE keyword = ${keyword};
    `;
  }

  async getKeywordStats(): Promise<any> {
    const total = await this.agent.sql`SELECT COUNT(*) as count FROM keywords;`;
    const newKeywords = await this.agent.sql`SELECT COUNT(*) as count FROM keywords WHERE status = 'new';`;
    const usedKeywords = await this.agent.sql`SELECT COUNT(*) as count FROM keywords WHERE status = 'used';`;
    const highPriority = await this.agent.sql`SELECT COUNT(*) as count FROM keywords WHERE priority_score >= 7;`;
    const avgPriority = await this.agent.sql`SELECT AVG(priority_score) as avg FROM keywords;`;

    return {
      total: total[0].count,
      new: newKeywords[0].count,
      used: usedKeywords[0].count,
      high_priority: highPriority[0].count,
      avg_priority: avgPriority[0].avg,
    };
  }
}
