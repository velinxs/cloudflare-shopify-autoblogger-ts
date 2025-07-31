import { Agent, AgentNamespace, getAgentByName } from 'agents';
import { OpenAI } from 'openai';

// Import all component classes
import { ShopifyClient } from './shopify';
import { PersonaManager, AuthorPersona } from './personas';
import { WebResearcher } from './researcher';
import { KeywordManager, Keyword } from './keywords';
import { ProductIntegrator } from './integrator';
import { syncPosts } from './content-sync';
import { fetchAllSiteUrls } from './sitemap';


// --- Type Definitions ---

interface Env {
  ShopifyAutobloggerAgent: AgentNamespace<ShopifyAutobloggerAgent>;
  OPENAI_API_KEY: string;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOPIFY_SHOP_URL: string;
  API_KEY: string; // Secret for securing the worker
  VECTORIZE_INDEX: VectorizeIndex;
  BROWSER: Fetcher;
  AI: any;
}

interface AgentState {
  personas: AuthorPersona[];
}

// --- Agent Class ---

export class ShopifyAutobloggerAgent extends Agent<Env, AgentState> {
    initialState: AgentState = {
        personas: [],
    };

    // Component instances
    private openai: OpenAI;
    private shopify: ShopifyClient;
    private researcher: WebResearcher;
    private personaManager!: PersonaManager;
    private keywordManager!: KeywordManager;
    private productIntegrator: ProductIntegrator;

    constructor(ctx: any, env: Env) {
        super(ctx, env);
        this.openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
        this.shopify = new ShopifyClient(env.SHOPIFY_ACCESS_TOKEN, env.SHOPIFY_SHOP_URL);
        this.researcher = new WebResearcher(this.openai);
        this.productIntegrator = new ProductIntegrator(this.shopify, this.openai);
    }

    async onStart() {
        this.personaManager = new PersonaManager(this.openai, this.state.personas);
        this.keywordManager = new KeywordManager(this.openai, this);
        await this.keywordManager.initSchema();
    }

    onStateUpdate(state: AgentState) {
        this.personaManager = new PersonaManager(this.openai, state.personas);
    }
    
    onError(error: any) {
        console.error('Agent error:', error);
        // Ensure we throw a real error object
        throw new Error(error.stack || error.message || 'An unknown error occurred in the agent.');
    }

    async onRequest(request: Request): Promise<Response> {
        const url = new URL(request.url);
        console.log(`Agent received request: ${request.method} ${url.pathname}`);

        try {
            // Router for agent methods
            const path = url.pathname;

            if ((path === '/blogs' || path === '/blog') && request.method === 'GET') {
                const blogs = await this.getBlogs();
                return new Response(JSON.stringify(blogs), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/post' && request.method === 'POST') {
                const { blogId, topic, style, words, research, draft, userPrompt } = await request.json();
                const result = await this.enhancedAutoBlog(blogId, topic, style, words, research, !draft, userPrompt);
                return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/keywords/research' && request.method === 'POST') {
                const { topic, count, niche } = await request.json();
                const keywords = await this.keywordManager.researchKeywords(topic, count, niche);
                await this.keywordManager.addKeywords(keywords);
                return new Response(JSON.stringify(keywords), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/keywords/next' && request.method === 'GET') {
                const keywords = await this.keywordManager.getNextKeywords(10, 5);
                return new Response(JSON.stringify(keywords), { headers: { 'Content-Type': 'application/json' } });
            }

            if (path === '/generate-keywords' && request.method === 'POST') {
                const { topics, keywordsPerTopic, niche } = await request.json();
                const csvContent = await this.generateKeywordsCsv(topics || ['pheromones', 'attraction', 'dating', 'confidence'], keywordsPerTopic || 25, niche || 'pheromones');
                return new Response(csvContent, { 
                    headers: { 
                        'Content-Type': 'text/csv',
                        'Content-Disposition': 'attachment; filename="keyword-research.csv"'
                    } 
                });
            }

            return new Response('Not found in agent', { status: 404 });
        } catch (e: any) {
            console.error("Error in agent onRequest:", e);
            return new Response(e.stack, { status: 500 });
        }
    }

    // --- Core Agent Logic ---

    async getBlogs() {
        return this.shopify.getBlogs();
    }

    /**
     * Creates and returns the static "Alexa Velinxs" persona.
     * This ensures a consistent and strong brand voice for the blog.
     * @returns The Alexa Velinxs persona object.
     */
    private getAlexaVelinxsPersona(): AuthorPersona {
        return {
            id: "static-alexa-velinxs",
            name: "Alexa Velinxs",
            background: "A 15-year veteran pheromone researcher and passionate advocate who has witnessed the transformative power of pheromone science firsthand. As a relationship and attraction expert, she helps people understand how pheromones can naturally enhance their appeal and confidence. Alexa Velinxs is pro-pheromones and works for royalpheromones.com which sells Liquid Alchemy Labs products - the gold standard in pheromone technology.",
            expertise: ["pheromone research", "relationship psychology", "attraction science", "social confidence", "Liquid Alchemy Labs formulations", "dating enhancement"],
            experience_years: "15+",
            education: "Ph.D. in Pheromone Research & Human Behavior",
            achievements: ["15 years of pheromone research breakthroughs", "Helped thousands improve their dating success with pheromone strategies", "Pioneer in practical pheromone applications for everyday confidence"],
            writing_voice: "Passionate, confident, and genuinely helpful. She writes in accessible, straightforward language about the power of pheromones, combining scientific knowledge with practical advice. Enthusiastically promotes the effectiveness of quality pheromone products while being relatable and encouraging.",
            signature_style: "Enthusiastic advocate who addresses pheromone questions with evidence and real results. Combines practical relationship advice with cutting-edge pheromone science to help readers build genuine confidence and natural attraction.",
            created_at: new Date().toISOString(),
            topic_area: "all",
            style: "informative-edgy"
        };
    }

    async enhancedAutoBlog(blogId: number, topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', publish: boolean, userPrompt?: string) {
        const persona = this.getAlexaVelinxsPersona();
        const contentData = await this.generateBlogContent(topic, style, wordCount, researchDepth, persona, userPrompt);
        contentData.keyword = topic;
        return this.createBlogPost(blogId, contentData, publish, topic);
    }

    async generateBlogContent(topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', persona: AuthorPersona, userPrompt?: string) {
        const researchData = await this.researcher.researchTopic(topic, researchDepth);
        
        // Generate an embedding for the new topic to find similar articles
        const embeddingResponse = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
          text: [topic]
        });
        const topicEmbedding = embeddingResponse.data[0];

        // Query Vectorize for the most similar content (blogs, products, collections)
        const similarContent = await this.env.VECTORIZE_INDEX.query(topicEmbedding, { 
            topK: 20,
            filter: { contentType: { $in: ['blog', 'product', 'collection'] } }
        });
        
        // Validate and filter results
        const validLinks = similarContent.matches
            .filter(match => {
                const url = match.vector.metadata?.url;
                const contentType = match.vector.metadata?.contentType;
                // Basic URL validation and ensure we have required metadata
                return url && 
                       url.startsWith('https://royalpheromones.com') && 
                       contentType &&
                       match.vector.metadata?.title &&
                       match.vector.metadata?.primaryKeyword;
            })
            .map(match => ({
                url: match.vector.metadata.url,
                title: match.vector.metadata.title,
                primaryKeyword: match.vector.metadata.primaryKeyword,
                contentType: match.vector.metadata.contentType,
                score: match.score,
            }))
            .slice(0, 10); // Take top 10 after filtering
        
        // Add fallback links if vectorize is empty or has few results
        const fallbackLinks = [];
        if (validLinks.length < 5) {
            fallbackLinks.push(
                {
                    url: 'https://royalpheromones.com/collections/mens-pheromone-colognes',
                    title: 'Men\'s Pheromone Colognes',
                    primaryKeyword: 'pheromone colognes for men',
                    contentType: 'collection',
                    score: 0.7
                },
                {
                    url: 'https://royalpheromones.com/collections/womens-pheromone-perfumes', 
                    title: 'Women\'s Pheromone Perfumes',
                    primaryKeyword: 'pheromone perfumes for women',
                    contentType: 'collection',
                    score: 0.6
                }
            );
        }
        
        const internalLinks = [...validLinks, ...fallbackLinks].slice(0, 10);

        const systemPrompt = `
You are a ghostwriter, fully embodying the persona of ${persona.name}. Your task is to write a comprehensive, SEO-optimized, 1500-word blog post for the Royal Pheromones blog on the topic of "${topic}".

**Brand Context:**
The blog is for Royal Pheromones, the premier destination for Liquid Alchemy Labs pheromone products. Your content must be strongly PRO-PHEROMONE and enthusiastically promote the effectiveness of quality pheromone products. You are a passionate advocate, not a skeptic. Present pheromones as powerful, scientifically-backed tools for attraction and social success. Build excitement and confidence in pheromone technology.

**Your Persona: Alexa Velinxs**
- **Background:** ${persona.background}
- **Expertise:** ${persona.expertise.join(', ')}
- **Writing Voice & Style:** ${persona.writing_voice} ${persona.signature_style}

${userPrompt ? `**Additional User Guidance:**
${userPrompt}

Please incorporate this guidance throughout your writing while maintaining your persona and the brand voice.` : ''}

**Primary Source Material:**
You MUST use the following web research as the primary source for your article.
<research>
${JSON.stringify(researchData.research_content)}
</research>

**Internal Linking Strategy - CRITICAL:**
You MUST include multiple contextual internal links throughout your article. Here are contextually relevant pages from the Royal Pheromones site identified by semantic similarity:

- **Homepage** (ALWAYS AVAILABLE) - Link to https://royalpheromones.com when introducing the site, mentioning "Royal Pheromones," or discussing the brand generally. Use anchor text like "Royal Pheromones," "our site," "we offer," etc.
- **Collection pages** (HIGH PRIORITY) - Link when discussing product categories, types of pheromones, or shopping recommendations
- **Product pages** (HIGH PRIORITY) - Link when mentioning specific products, ingredients, or making recommendations  
- **Blog articles** - Link when referencing topics, research, or providing additional reading

Each link includes a 'primaryKeyword' and 'contentType'. Use the primaryKeyword to create natural, context-aware anchor text that fits the flow. You should include at least 8-12 contextual internal links throughout the article, including at least one homepage link. Be very aggressive about linking - every relevant mention should have a link. Include links in every major section of your article. NEVER use the same URL more than once in a single article.

CRITICAL: ONLY use URLs from the provided links list below, plus https://royalpheromones.com for homepage links. Do NOT create or guess URLs. All links have been validated and are guaranteed to work. If you need more variety, be creative with different anchor text for the same categories.

<links>
${JSON.stringify(internalLinks)}
</links>

**Content Requirements:**
1.  **Length:** ~1500 words.
2.  **SEO OPTIMIZATION (CRITICAL):** 
   - Use "${topic}" as the primary keyword throughout the article (aim for 1-2% density)
   - Include the primary keyword in: H1 title, first paragraph, at least 2 H2 headings, and conclusion
   - Sprinkle related secondary keywords naturally throughout: variations of the main topic, synonyms, and LSI keywords from your research
   - Use semantic keyword variations (e.g., "pheromone cologne" → "pheromone fragrance", "attraction scent", "magnetic cologne")
   - Include long-tail keyword variations in subheadings and body text
   - Use a clear heading structure (H1, H2, H3) with keywords in headings where natural
3.  **Formatting:** The 'content' field must be a single HTML string with proper tags (h1, h2, h3, p, strong, em, a, img).
4.  **Tone:** Write from your persona's first-person perspective ("I", "my").
5.  **Images:** Include 2-3 relevant images using this format: <img src="https://images.unsplash.com/photo-PHOTOID?w=800&h=400&fit=crop" alt="Alt text" style="width: 100%; max-width: 800px; height: auto; margin: 20px 0; border-radius: 8px;">. Use search terms like "cologne", "perfume", "attraction", "confidence", "dating" to find appropriate photo IDs from Unsplash.
6.  **Stance:** Be enthusiastically PRO-PHEROMONE. Present pheromones as effective, scientifically-backed tools. Counter skepticism with confidence and results.

**JSON Output Structure:**
- "title": SEO-friendly title.
- "meta_description": 150-160 character meta description.
- "summary": 2-3 sentence compelling summary/excerpt of the article.
- "handle": Short, clean URL slug based on primary keyword (e.g., "best-pheromone-cologne" for "best pheromone cologne for men").
- "content": The full 1500-word blog post as a single HTML string (no markdown, pure HTML).
- "tags": An array of 5-7 relevant SEO tags.
`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4.1',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Write the blog post about ${topic}, ensuring it is at least 1500 words and follows all instructions.` }],
            response_format: { type: 'json_object' },
        });
        const content = JSON.parse(response.choices[0].message.content || '{}');
        return { ...content, author_persona: persona };
    }

    /**
     * Creates a clean URL handle from a topic/keyword.
     * @param topic The topic/keyword to convert to a handle.
     * @returns Clean URL handle.
     */
    private createHandle(topic: string): string {
        return topic
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single
            .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
            .substring(0, 50); // Limit length
    }

    /**
     * Sanitizes HTML content to remove unnecessary elements and keep only blog post content.
     * @param html The HTML content from OpenAI.
     * @returns Clean HTML string suitable for Shopify blog posts.
     */
    private sanitizeHtml(html: string): string {
        if (typeof html !== 'string') {
            return JSON.stringify(html); // Fallback for unexpected types
        }
        
        let cleanHtml = html
            // Remove doctype, html, head, body tags if present
            .replace(/<!DOCTYPE[^>]*>/gi, '')
            .replace(/<\/?html[^>]*>/gi, '')
            .replace(/<\/?head[^>]*>/gi, '')
            .replace(/<\/?body[^>]*>/gi, '')
            .replace(/<\/?meta[^>]*>/gi, '')
            .replace(/<\/?title[^>]*>/gi, '')
            .replace(/<\/?link[^>]*>/gi, '')
            .replace(/<\/?script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<\/?style[^>]*>[\s\S]*?<\/style>/gi, '')
            // Remove markdown code block wrappers if they exist
            .replace(/^```[\s\S]*?\n/, '')
            .replace(/\n```$/, '')
            .replace(/^```html\s*/, '')
            .replace(/^```markdown\s*/, '')
            .replace(/^```\s*/, '')
            // Clean up extra whitespace
            .trim();
            
        return cleanHtml;
    }

    async createBlogPost(blogId: number, contentData: any, published: boolean, topic: string) {
        const postStart = Date.now();
        console.log(`\n📝 BLOG POST CREATION STARTED`);
        console.log(`🎯 Topic: "${topic}"`);
        console.log(`📰 Title: "${contentData.title || topic}"`);
        console.log(`🔢 Blog ID: ${blogId}`);
        console.log(`📢 Published: ${published}`);
        
        // 1. Sanitize HTML content to remove unnecessary elements
        console.log(`🧹 Sanitizing HTML content...`);
        const sanitizeStart = Date.now();
        let htmlContent = this.sanitizeHtml(contentData.content);
        const contentLength = htmlContent.length;
        console.log(`✅ HTML sanitized: ${contentLength} characters (${Date.now() - sanitizeStart}ms)`);

        // 2. Add product ad contextually using AI
        console.log(`🛍️ Finding relevant products...`);
        const productStart = Date.now();
        const products = await this.productIntegrator.findRelevantProducts(contentData.keyword, htmlContent.substring(0, 500), 1);
        if (products.length > 0) {
            console.log(`✅ Found ${products.length} relevant products (${Date.now() - productStart}ms)`);
            console.log(`🔗 Integrating product placements...`);
            const integrationStart = Date.now();
            htmlContent = await this.productIntegrator.generateContextualProductPlacement(htmlContent, products);
            console.log(`✅ Products integrated (${Date.now() - integrationStart}ms)`);
        } else {
            console.warn(`⚠️ No relevant products found for keyword: ${contentData.keyword} (${Date.now() - productStart}ms)`);
        }

        // 3. Generate and upload featured image
        let featuredImageUrl: string | undefined;
        try {
            const imageStart = Date.now();
            const imageData = await this.generateFeaturedImage(topic, contentData.title || topic);
            const filename = `blog-${contentData.handle || this.createHandle(topic)}-${Date.now()}.png`;
            featuredImageUrl = await this.shopify.uploadImage(imageData, filename);
            console.log(`✅ Featured image complete: ${featuredImageUrl} (${Date.now() - imageStart}ms)`);
        } catch (error) {
            console.error(`⚠️ Featured image failed, continuing without image:`, error.message);
            // Continue without image rather than failing the whole post
        }

        // 4. Prepare article payload
        console.log(`📦 Preparing article payload...`);
        const articlePayload = {
            title: contentData.title || topic, // Fallback to topic if title is missing
            body_html: htmlContent,
            summary_html: contentData.summary || contentData.meta_description || 'Discover the power of pheromones with Royal Pheromones.',
            handle: contentData.handle || this.createHandle(topic), // Clean URL slug
            tags: Array.isArray(contentData.tags) ? contentData.tags.join(', ') : (contentData.tags || ''),
            published
        };
        console.log(`📋 Article details:`);
        console.log(`   • Handle: ${articlePayload.handle}`);
        console.log(`   • Content length: ${htmlContent.length} chars`);
        console.log(`   • Tags: ${articlePayload.tags}`);
        console.log(`   • Has featured image: ${!!featuredImageUrl}`);

        // 5. Create blog post with featured image
        console.log(`🚀 Creating Shopify blog post...`);
        const shopifyStart = Date.now();
        const article = await this.shopify.createBlogPostWithImage(blogId, articlePayload, featuredImageUrl);
        console.log(`✅ Blog post created in Shopify (${Date.now() - shopifyStart}ms)`);
        console.log(`🔗 Article ID: ${article?.id}`);
        console.log(`🌐 Article URL: https://royalpheromones.com/blogs/articles/${articlePayload.handle}`);
        
        // 6. Mark keyword as used with the new article URL
        if (article && article.id && contentData.keyword) {
            console.log(`📊 Marking keyword as used...`);
            const keywordStart = Date.now();
            const articleUrl = `https://royalpheromones.com/blogs/articles/${article.handle}`;
            await this.keywordManager.markKeywordUsed(contentData.keyword, article.id.toString(), articleUrl);
            console.log(`✅ Keyword marked as used (${Date.now() - keywordStart}ms)`);
        }
        
        const totalTime = Date.now() - postStart;
        console.log(`\n🎉 BLOG POST CREATION COMPLETE!`);
        console.log(`⏱️ Total time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
        console.log(`📄 Final article: ${article?.id ? 'SUCCESS' : 'FAILED'}`);
        
        return article;
    }

    /**
     * Generates a comprehensive keyword research CSV with user prompts for automation
     */
    async generateKeywordsCsv(topics: string[], keywordsPerTopic: number, niche: string): Promise<string> {
        const startTime = Date.now();
        console.log(`🔍 KEYWORD GENERATION STARTED`);
        console.log(`📋 Topics: ${topics.join(', ')}`);
        console.log(`🎯 Keywords per topic: ${keywordsPerTopic}`);
        console.log(`🏷️ Niche: ${niche}`);
        
        // First, get all existing content keywords to avoid duplicates
        console.log(`📊 Fetching existing content from vectorize...`);
        const existingStart = Date.now();
        const existingKeywords = await this.getExistingContentKeywords();
        console.log(`✅ Found ${existingKeywords.length} existing keywords (${Date.now() - existingStart}ms)`);
        console.log(`📝 Sample existing keywords: ${existingKeywords.slice(0, 5).join(', ')}...`);
        
        let allKeywordData: Array<{keyword: string, topic: string, userPrompt: string}> = [];
        
        // Research keywords for each topic, informing the AI about what already exists
        for (let i = 0; i < topics.length; i++) {
            const topic = topics[i];
            console.log(`\n🔍 Processing topic ${i + 1}/${topics.length}: "${topic}"`);
            
            const topicStart = Date.now();
            console.log(`🤖 Generating ${keywordsPerTopic} complementary keywords...`);
            const keywords = await this.keywordManager.researchComplementaryKeywords(
                topic, 
                keywordsPerTopic, 
                niche, 
                existingKeywords
            );
            console.log(`✅ Generated ${keywords.length} initial keywords (${Date.now() - topicStart}ms)`);
            
            // Double-check filtering (shouldn't be needed but safety net)
            console.log(`🔍 Filtering against existing content...`);
            const filterStart = Date.now();
            const unusedKeywords = await this.filterUnusedKeywords(keywords);
            console.log(`✅ ${unusedKeywords.length}/${keywords.length} keywords passed filtering (${Date.now() - filterStart}ms)`);
            
            console.log(`💡 Generating user prompts for ${unusedKeywords.length} keywords...`);
            const promptStart = Date.now();
            for (let j = 0; j < unusedKeywords.length; j++) {
                const keywordObj = unusedKeywords[j];
                console.log(`  📝 ${j + 1}/${unusedKeywords.length}: "${keywordObj.keyword}"`);
                const userPrompt = await this.generateUserPromptForKeyword(keywordObj.keyword, topic, niche);
                allKeywordData.push({
                    keyword: keywordObj.keyword,
                    topic: topic,
                    userPrompt: userPrompt
                });
            }
            console.log(`✅ User prompts generated (${Date.now() - promptStart}ms)`);
        }
        
        // Sort by topic for organization
        allKeywordData.sort((a, b) => {
            if (a.topic !== b.topic) return a.topic.localeCompare(b.topic);
            return a.keyword.localeCompare(b.keyword);
        });
        
        // Generate CSV content
        let csvContent = 'keyword,user_prompt,topic\n';
        
        let currentTopic = '';
        for (const item of allKeywordData) {
            // Add topic separator comment
            if (item.topic !== currentTopic) {
                csvContent += `\n# --- ${item.topic.toUpperCase()} KEYWORDS ---\n`;
                currentTopic = item.topic;
            }
            
            // Escape quotes and commas in CSV
            const escapedKeyword = `"${item.keyword.replace(/"/g, '""')}"`;
            const escapedPrompt = `"${item.userPrompt.replace(/"/g, '""')}"`;
            const escapedTopic = `"${item.topic.replace(/"/g, '""')}"`;
            
            csvContent += `${escapedKeyword},${escapedPrompt},${escapedTopic}\n`;
        }
        
        const totalTime = Date.now() - startTime;
        console.log(`\n🎉 KEYWORD GENERATION COMPLETE!`);
        console.log(`📊 Final Results:`);
        console.log(`   • Total keywords: ${allKeywordData.length}`);
        console.log(`   • Topics processed: ${topics.length}`);
        console.log(`   • Total time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
        console.log(`   • Avg per keyword: ${(totalTime/allKeywordData.length).toFixed(0)}ms`);
        
        // Show breakdown by topic
        const topicCounts = allKeywordData.reduce((acc, item) => {
            acc[item.topic] = (acc[item.topic] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log(`📋 Topic breakdown:`, topicCounts);
        
        return csvContent;
    }
    
    /**
     * Generates a contextual user prompt for a specific keyword
     */
    private async generateUserPromptForKeyword(keyword: string, topic: string, niche: string): Promise<string> {
        const systemPrompt = `You are a content strategy expert for Royal Pheromones. Generate a concise, specific user prompt (1-2 sentences) that will guide the AI writer to create the most effective blog post for this keyword.

Focus on:
- What angle/approach to take
- What to emphasize or highlight
- Any specific product categories to mention
- Tone adjustments (scientific, practical, beginner-friendly, etc.)
- Target audience considerations

Keep prompts under 150 characters to be practical for CSV processing.`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Generate a user prompt for keyword: "${keyword}" in topic: "${topic}" for ${niche} niche` }
            ],
            max_tokens: 100,
            temperature: 0.7
        });
        
        return response.choices[0].message.content?.trim() || `Focus on practical advice and product recommendations for ${keyword}`;
    }
    
    /**
     * Filters out keywords that are already covered by existing content in vectorize
     */
    private async filterUnusedKeywords(keywords: any[]): Promise<any[]> {
        const unusedKeywords = [];
        const similarityThreshold = 0.95; // Very high similarity means exact duplicate (lowered from 0.8)
        
        for (const keywordObj of keywords) {
            const keyword = keywordObj.keyword;
            
            // Generate embedding for the keyword
            const embeddingResponse = await this.env.AI.run('@cf/baai/bge-base-en-v1.5', {
                text: [keyword]
            });
            const keywordEmbedding = embeddingResponse.data[0];
            
            // Query vectorize for similar content
            const similarContent = await this.env.VECTORIZE_INDEX.query(keywordEmbedding, { 
                topK: 5,
                filter: { contentType: { $in: ['blog'] } } // Only check against existing blog posts
            });
            
            // Check if any existing content is very similar to this keyword
            const hasVerySimilarContent = similarContent.matches.some(match => 
                match.score > similarityThreshold
            );
            
            // Also check exact keyword match in titles and primary keywords
            const hasExactMatch = similarContent.matches.some(match => {
                const title = match.vector.metadata?.title?.toLowerCase() || '';
                const primaryKeyword = match.vector.metadata?.primaryKeyword?.toLowerCase() || '';
                const keywordLower = keyword.toLowerCase();
                
                return title.includes(keywordLower) || 
                       primaryKeyword.includes(keywordLower) ||
                       keywordLower.includes(primaryKeyword);
            });
            
            // Keep keyword if it's not covered by existing content
            if (!hasVerySimilarContent && !hasExactMatch) {
                unusedKeywords.push(keywordObj);
            } else {
                console.log(`Filtered out keyword "${keyword}" - already covered by existing content`);
            }
        }
        
        return unusedKeywords;
    }
    
    /**
     * Gets all existing content keywords from vectorize to avoid regenerating similar content
     */
    private async getExistingContentKeywords(): Promise<string[]> {
        // Query vectorize to get a sample of existing content
        const sampleQuery = await this.env.VECTORIZE_INDEX.query(
            new Array(1536).fill(0), // Dummy embedding to get random results
            { 
                topK: 500, // Get a large sample of existing content
                filter: { contentType: { $in: ['blog'] } }
            }
        );
        
        const existingKeywords: string[] = [];
        
        for (const match of sampleQuery.matches) {
            const metadata = match.vector.metadata;
            if (metadata?.title) {
                existingKeywords.push(metadata.title);
            }
            if (metadata?.primaryKeyword) {
                existingKeywords.push(metadata.primaryKeyword);
            }
        }
        
        // Also get from our SQL database if any keywords were tracked there
        try {
            const dbKeywords = await this.keywordManager.getAllKeywords();
            existingKeywords.push(...dbKeywords.map(k => k.keyword));
        } catch (e) {
            console.log('No existing keywords in database yet');
        }
        
        // Remove duplicates and return
        return [...new Set(existingKeywords.map(k => k.toLowerCase()))];
    }

    /**
     * Generates a featured image using DALL-E 3 for the blog post
     */
    private async generateFeaturedImage(topic: string, title: string): Promise<ArrayBuffer> {
        console.log(`🎨 DALL-E 3 IMAGE GENERATION STARTED`);
        console.log(`📷 Topic: "${topic}"`);
        console.log(`📝 Title: "${title}"`);
        
        const imagePrompt = `Create a professional, modern featured image for a blog post about "${topic}". 

Style: Clean, sophisticated design with:
- Professional background (gradient, subtle texture, or solid color)
- Bold, readable text overlay with the title: "${title}"
- Relevant visual elements (bottles, scientific imagery, or abstract graphics related to pheromones/attraction)
- Brand colors: deep blues, purples, or elegant neutrals
- High-quality, blog-worthy aesthetic
- 16:9 aspect ratio, suitable for social media sharing

The image should look professional and trustworthy, suitable for a science-based blog about pheromones and attraction.`;

        console.log(`🤖 Sending request to DALL-E 3...`);
        console.log(`📏 Size: 1792x1024 (16:9 ratio)`);
        console.log(`⚡ Quality: standard`);

        try {
            const generateStart = Date.now();
            const response = await this.openai.images.generate({
                model: "dall-e-3",
                prompt: imagePrompt,
                n: 1,
                size: "1792x1024", // 16:9 aspect ratio
                quality: "standard"
            });
            console.log(`✅ DALL-E 3 generation complete (${Date.now() - generateStart}ms)`);

            const imageUrl = response.data[0].url;
            if (!imageUrl) {
                throw new Error('No image URL returned from DALL-E 3');
            }
            console.log(`🔗 Generated image URL: ${imageUrl.substring(0, 50)}...`);

            // Download the image
            console.log(`⬇️ Downloading generated image...`);
            const downloadStart = Date.now();
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
                throw new Error(`Failed to download generated image: ${imageResponse.status} ${imageResponse.statusText}`);
            }
            
            const imageBuffer = await imageResponse.arrayBuffer();
            const imageSizeKB = Math.round(imageBuffer.byteLength / 1024);
            console.log(`✅ Image downloaded: ${imageSizeKB}KB (${Date.now() - downloadStart}ms)`);

            return imageBuffer;
        } catch (error) {
            console.error(`❌ IMAGE GENERATION FAILED:`, error);
            console.error(`   • Topic: "${topic}"`);
            console.error(`   • Title: "${title}"`);
            console.error(`   • Error type: ${error.constructor.name}`);
            console.error(`   • Error message: ${error.message}`);
            throw error;
        }
    }
}

import { syncPosts } from './content-sync';

// --- Worker Entrypoint ---

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    console.log(`Main worker received request: ${request.method} ${request.url}`);

    // --- Authentication Check ---
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response('Missing or invalid Authorization header', { status: 401 });
    }
    const providedKey = authHeader.substring(7); // Remove "Bearer " prefix
    if (providedKey !== env.API_KEY) {
      return new Response('Invalid API Key', { status: 403 });
    }
    // --- End Authentication Check ---

    const url = new URL(request.url);
    if (url.pathname === '/sync-posts' && request.method === 'POST') {
        // Pass the request to be handled in the background
        ctx.waitUntil(syncPosts(env));
        return new Response(JSON.stringify({ success: true, message: 'Content sync process started in the background.' }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
      const agent = await getAgentByName<Env, ShopifyAutobloggerAgent>(env.ShopifyAutobloggerAgent, 'singleton');
      return await agent.fetch(request);
    } catch (e: any) {
      console.error("Error in main fetch handler:", e);
      return new Response(e.stack, { status: 500 });
    }
  },
};