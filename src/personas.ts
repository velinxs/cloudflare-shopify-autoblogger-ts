
import { z } from 'zod';
import { OpenAI } from 'openai';

const personaSchema = z.object({
  id: z.string(),
  name: z.string(),
  background: z.string(),
  expertise: z.array(z.string()),
  experience_years: z.string(),
  education: z.string(),
  achievements: z.array(z.string()),
  writing_voice: z.string(),
  signature_style: z.string(),
  created_at: z.string(),
  topic_area: z.string(),
  style: z.string(),
});

export type AuthorPersona = z.infer<typeof personaSchema>;

export class PersonaManager {
  private personas: AuthorPersona[] = [];
  private openai: OpenAI;

  constructor(openai: OpenAI, initialPersonas: AuthorPersona[] = []) {
    this.openai = openai;
    this.personas = initialPersonas;
  }

  async createPersona(topicArea: string, writingStyle: string): Promise<AuthorPersona> {
    const systemPrompt = `You are a persona creation specialist. Create a realistic author profile for blog writing.
    
    Generate a detailed author persona that includes:
    - Full name (realistic, professional)
    - Professional background and expertise
    - Writing style characteristics
    - Years of experience
    - Educational background
    - Key achievements or credentials
    - Writing voice and tone preferences
    - Signature phrases or approaches
    
    Make the persona feel authentic and specialized for the given topic area and writing style.
    Return as JSON with these exact keys: name, background, expertise, experience_years, education, achievements, writing_voice, signature_style`;

    const userPrompt = `Create an author persona for:
    Topic Area: ${topicArea}
    Writing Style: ${writingStyle}
    
    This author should be credible and knowledgeable in this field.`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      response_format: { type: 'json_object' },
    });

    const personaData = JSON.parse(response.choices[0].message.content || '{}');

    const newPersona: AuthorPersona = {
      ...personaData,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      topic_area: topicArea,
      style: writingStyle,
    };

    this.personas.push(newPersona);
    return newPersona;
  }

  findMatchingPersona(topicArea: string, writingStyle: string): AuthorPersona | undefined {
    return this.personas.find(
      (p) =>
        p.topic_area.toLowerCase() === topicArea.toLowerCase() &&
        p.style.toLowerCase() === writingStyle.toLowerCase()
    );
  }

  async getOrCreatePersona(topicArea: string, writingStyle: string): Promise<AuthorPersona> {
    const existingPersona = this.findMatchingPersona(topicArea, writingStyle);
    if (existingPersona) {
      return existingPersona;
    }
    return this.createPersona(topicArea, writingStyle);
  }

  listPersonas(): AuthorPersona[] {
    return this.personas;
  }

  getPersonas(): AuthorPersona[] {
    return this.personas;
  }
}
