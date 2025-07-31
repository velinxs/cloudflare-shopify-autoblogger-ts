
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

  async getUsedKeywords(): Promise<Keyword[]> {
    return this.agent.sql<Keyword[]>`
      SELECT * FROM keywords
      WHERE status = 'used'
      ORDER BY created_date DESC;
    `;
  }

  async getAllKeywords(): Promise<Keyword[]> {
    return this.agent.sql<Keyword[]>`
      SELECT * FROM keywords
      ORDER BY created_date DESC;
    `;
  }

  async researchComplementaryKeywords(topic: string, count: number, niche: string, existingKeywords: string[]): Promise<Keyword[]> {
    const existingList = existingKeywords.slice(0, 50).join(', '); // Limit to prevent prompt overflow
    
    const prompt = `Research ${count} COMPLEMENTARY keywords for the topic "${topic}" in the "${niche}" niche. 
    
Here are existing keywords/topics we already have content for:
${existingList}

Generate NEW keywords that:
1. COMPLEMENT existing content (can naturally link to it)
2. Cover RELATED but UNCOVERED angles and subtopics
3. Build content clusters around existing topics
4. Explore adjacent topics that would benefit from internal linking

Focus on HIGH SEARCH VOLUME keywords that:
- Adjacent topics that can link to existing content
- More specific/niche variations of broad existing topics  
- Different stages of customer journey (awareness → consideration → purchase)
- Comparison topics that can reference existing content
- Problem-solution keywords that can link to existing solutions
- Seasonal/trending variations of existing topics

CRITICAL: Prioritize keywords that people actually search for:
- Use real search behavior patterns (what people type in Google)
- Include buying intent keywords (best, reviews, how to, vs, top, guide)
- Consider search volume potential - prefer broader appeal over ultra-niche
- Include question-based keywords (how, what, why, when, where)
- Mix of head terms (higher volume) and long-tail (easier to rank)

Avoid exact duplicates but DO create content that can naturally reference and link to existing articles.

For each keyword, provide a priority score (1-10 where 10 = high search volume + low competition), user intent, difficulty, and a content angle. Return as a JSON array of objects with keys: keyword, priority_score, intent, difficulty, content_angle.`;

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
