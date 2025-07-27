import { Agent, AgentNamespace, getAgentByName } from 'agents';
import { OpenAI } from 'openai';

// Import all component classes
import { ShopifyClient } from './shopify';
import { PersonaManager, AuthorPersona } from './personas';
import { WebResearcher } from './researcher';
import { KeywordManager, Keyword } from './keywords';
import { ProductIntegrator } from './integrator';

// --- Type Definitions ---

interface Env {
  ShopifyAutobloggerAgent: AgentNamespace<ShopifyAutobloggerAgent>;
  OPENAI_API_KEY: string;
  SHOPIFY_ACCESS_TOKEN: string;
  SHOPIFY_SHOP_URL: string;
  API_KEY: string; // Secret for securing the worker
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
                const { blogId, topic, style, words, research, draft } = await request.json();
                const result = await this.enhancedAutoBlog(blogId, topic, style, words, research, !draft);
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

    async enhancedAutoBlog(blogId: number, topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive', publish: boolean) {
        const contentData = await this.generateBlogContent(topic, style, wordCount, researchDepth);
        contentData.keyword = topic;
        return this.createBlogPost(blogId, contentData, publish, topic);
    }

    async generateBlogContent(topic: string, style: string, wordCount: number, researchDepth: 'quick' | 'comprehensive' | 'competitive') {
        const researchData = await this.researcher.researchTopic(topic, researchDepth);
        const persona = await this.personaManager.getOrCreatePersona(topic, style);
        this.setState({ ...this.state, personas: this.personaManager.getPersonas() });

        const systemPrompt = `
You are a ghostwriter, fully embodying the persona of ${persona.name}. Your task is to write a comprehensive, SEO-optimized, 1500-word blog post for the Royal Pheromones blog on the topic of "${topic}".

**Brand Context:**
The blog is for Royal Pheromones, a company that sells pheromone colognes. The content should be informative, engaging, and build trust with the reader, while naturally aligning with the company's mission to help people improve their confidence and social lives. The tone should be natural, realistic, and human.

**Your Persona:**
- **Name:** ${persona.name}
- **Background:** ${persona.background}
- **Expertise:** ${persona.expertise}
- **Writing Voice & Style:** ${persona.writing_voice}. ${persona.signature_style}

**Primary Source Material:**
You MUST use the following web research as the primary source for your article. Ground your writing in the facts, data, and insights from this research to create an authoritative and well-supported piece.
<research>
${JSON.stringify(researchData.research_content)}
</research>

**Content Requirements:**
1.  **Length:** The article must be approximately 1500 words.
2.  **SEO Optimization:**
    - The primary keyword "${topic}" should appear naturally throughout the article.
    - Include related secondary keywords and long-tail variations found in the research.
    - Structure the article with a main H1 title, followed by H2 and H3 subheadings.
    - Write a compelling, SEO-friendly meta description of 150-160 characters.
3.  **Formatting:**
    - The entire output must be a single JSON object.
    - The 'content' field should be a single Markdown string.
4.  **Tone and Style:**
    - Write from the first-person perspective of your persona ("I", "my").
    - Infuse the writing with your persona's unique voice and expertise.

**JSON Output Structure:**
Return a single JSON object with the following keys:
- "title": A compelling, SEO-friendly title.
- "meta_description": A 150-160 character meta description.
- "content": The full 1500-word blog post as a single Markdown string.
- "tags": An array of 5-7 relevant SEO tags.
`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: `Write the blog post about ${topic}, ensuring it is at least 1500 words and follows all instructions.` }],
            response_format: { type: 'json_object' },
        });
        const content = JSON.parse(response.choices[0].message.content || '{}');
        return { ...content, author_persona: persona };
    }

    /**
     * Converts a Markdown string into a basic HTML string.
     * @param markdown The Markdown content from OpenAI.
     * @returns An HTML string.
     */
    private markdownToHtml(markdown: string): string {
        if (typeof markdown !== 'string') {
            return JSON.stringify(markdown); // Fallback for unexpected types
        }
        return markdown
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*)\*/gim, '<em>$1</em>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2">$1</a>')
            .replace(/\n/gim, '<br>');
    }

    async createBlogPost(blogId: number, contentData: any, published: boolean, topic: string) {
        console.log('Content received from OpenAI:', JSON.stringify(contentData, null, 2));
        
        // Convert the markdown content to an HTML string
        const htmlContent = this.markdownToHtml(contentData.content);
        let enhancedContent = htmlContent;

        // Always find at least one product to integrate.
        const products = await this.productIntegrator.findRelevantProducts(contentData.keyword, htmlContent.substring(0, 500), 1);
        if (products.length > 0) {
            enhancedContent = await this.productIntegrator.generateContextualProductPlacement(enhancedContent, products);
        } else {
            console.warn(`No relevant products found for keyword: ${contentData.keyword}. A generic product link may be added.`);
            // Optional: Add a fallback to a generic best-seller or category page if no specific product is found.
        }
        
        const articlePayload = {
            ...contentData,
            title: contentData.title || topic, // Fallback to topic if title is missing
            body_html: enhancedContent,
            published
        };
        const article = await this.shopify.createBlogPost(blogId, articlePayload);
        if (article && article.id && contentData.keyword) {
            await this.keywordManager.markKeywordUsed(contentData.keyword, article.id.toString(), article.handle);
        }
        return article;
    }
}

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

    try {
      const agent = await getAgentByName<Env, ShopifyAutobloggerAgent>(env.ShopifyAutobloggerAgent, 'singleton');
      return await agent.fetch(request);
    } catch (e: any) {
      console.error("Error in main fetch handler:", e);
      return new Response(e.stack, { status: 500 });
    }
  },
};