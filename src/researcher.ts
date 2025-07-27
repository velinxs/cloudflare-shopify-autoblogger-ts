import { OpenAI } from 'openai';

export class WebResearcher {
  private openai: OpenAI;

  constructor(openai: OpenAI) {
    this.openai = openai;
  }

  async researchTopic(topic: string, researchDepth: 'quick' | 'comprehensive' | 'competitive' = 'comprehensive'): Promise<any> {
    const researchPrompts = {
      quick: `Find 3-5 key insights about ${topic} for blog writing`,
      comprehensive: `Research ${topic} thoroughly including current trends, statistics, best practices, and expert opinions`,
      competitive: `Find top-ranking articles about ${topic} and analyze their approach, structure, and key points`,
    };

    const prompt = researchPrompts[researchDepth];

    const systemMessage = `You are a professional content researcher. Your job is to gather comprehensive, accurate information from web sources to inform high-quality blog content creation.

    When researching:
    1. Look for recent, authoritative sources
    2. Identify key trends and statistics
    3. Find expert opinions and quotes
    4. Note successful content patterns
    5. Gather actionable insights
    6. Identify content gaps and opportunities
    7. Search Reddit discussions for real user experiences and opinions
    8. Look for niche forum discussions and community insights

    Organize your findings into a clear, structured summary.`;

    try {
      // Use the new OpenAI Responses API with web search
      const response = await this.openai.responses.create({
        model: "gpt-4.1-mini", // Or a model that supports the new API
        input: `${systemMessage}\n\nUser request: ${prompt}`,
        tools: [{ type: "web_search" }]
      });

      // Extract the message content and annotations from the new response structure
      const messageOutput = response.output.find(o => o.type === 'message');
      let research_content = 'No content found.';
      let citations: any[] = [];

      if (messageOutput && messageOutput.type === 'message' && messageOutput.content[0].type === 'output_text') {
        research_content = messageOutput.content[0].text;
        citations = messageOutput.content[0].annotations || [];
      }

      return {
        research_content,
        sources_used: "Web search via OpenAI Responses API",
        research_depth: researchDepth,
        timestamp: new Date().toISOString(),
        citations,
      };

    } catch (e: any) {
      console.error(`Web search with Responses API failed, falling back to AI knowledge base: ${e.message}`);
      // Fallback research without web search using the standard chat completions
      const fallbackResponse = await this.openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: "You are a knowledgeable content researcher. Provide insights about the given topic based on your training data.",
          },
          { role: "user", content: `Provide comprehensive research insights about ${topic} for blog content creation` },
        ],
        temperature: 0.3,
      });

      return {
        research_content: fallbackResponse.choices[0].message.content,
        sources_used: "AI knowledge base (fallback)",
        research_depth: researchDepth,
        timestamp: new Date().toISOString(),
        note: `Web search unavailable (${e.message}), used AI knowledge base`,
        citations: [],
      };
    }
  }
}