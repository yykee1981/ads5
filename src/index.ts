import 'dotenv/config';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const TOPICS = [
  '健康饮食与营养',
  '日常运动与健身',
  '良好的睡眠习惯',
  '马来西亚文化与历史',
  '心理健康与情绪管理',
];

const QUESTIONS_PER_TOPIC = 1;

type AnswerLetter = 'A' | 'B' | 'C';

type GeneratedQuestion = {
  desc_zh: string;
  desc_en: string;
  desc_ms: string;
  question_zh: string;
  question_en: string;
  question_ms: string;
  answer: AnswerLetter;
  explanation_zh: string;
  explanation_en: string;
  explanation_ms: string;
  optionzhA: string;
  optionzhB: string;
  optionzhC: string;
  optionenA: string;
  optionenB: string;
  optionenC: string;
  optionmsA: string;
  optionmsB: string;
  optionmsC: string;
};

type Ads5Row = Omit<GeneratedQuestion, 'answer'> & {
  answer_zh: AnswerLetter;
  answer_en: AnswerLetter;
  answer_ms: AnswerLetter;
  img: string | null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable: ${name}`);
  return value;
}

const deepseek = new OpenAI({
  apiKey: requireEnv('DEEPSEEK_API_KEY'),
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
});
const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const REQUIRED_FIELDS: ReadonlyArray<keyof GeneratedQuestion> = [
  'desc_zh', 'desc_en', 'desc_ms',
  'question_zh', 'question_en', 'question_ms',
  'answer',
  'explanation_zh', 'explanation_en', 'explanation_ms',
  'optionzhA', 'optionzhB', 'optionzhC',
  'optionenA', 'optionenB', 'optionenC',
  'optionmsA', 'optionmsB', 'optionmsC',
];

const SCHEMA_HINT = `Return ONLY a single JSON object with EXACTLY these keys (no extras, no markdown, no comments):
{
  "desc_zh": string, "desc_en": string, "desc_ms": string,
  "question_zh": string, "question_en": string, "question_ms": string,
  "answer": "A" | "B" | "C",
  "explanation_zh": string, "explanation_en": string, "explanation_ms": string,
  "optionzhA": string, "optionzhB": string, "optionzhC": string,
  "optionenA": string, "optionenB": string, "optionenC": string,
  "optionmsA": string, "optionmsB": string, "optionmsC": string
}`;

function validateQuestion(value: unknown): GeneratedQuestion {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Model output is not a JSON object.');
  }
  const obj = value as Record<string, unknown>;
  for (const key of REQUIRED_FIELDS) {
    if (typeof obj[key] !== 'string') {
      throw new Error(`Model output missing string field "${key}".`);
    }
  }
  if (obj.answer !== 'A' && obj.answer !== 'B' && obj.answer !== 'C') {
    throw new Error(`Model output "answer" must be A/B/C, got ${String(obj.answer)}.`);
  }
  return obj as unknown as GeneratedQuestion;
}

async function generateQuestion(topic: string): Promise<GeneratedQuestion> {
  const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

  const completion = await deepseek.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You write friendly, concise multiple-choice trivia questions in three languages: Chinese (zh), English (en), and Malay (ms). Each question must have exactly three options labelled A, B and C, with one correct answer. The "desc" field is a short upbeat one-sentence caption. The "explanation" briefly justifies why the correct option is correct. Options A, B and C must line up across all three languages (option A in Chinese, English and Malay all describe the same answer).\n\n' +
          SCHEMA_HINT,
      },
      {
        role: 'user',
        content:
          `Topic: ${topic}\n\n` +
          'Generate one new multiple-choice question with three options (A, B, C). ' +
          'Provide every text field in Chinese (zh), English (en) and Malay (ms). ' +
          'The "answer" field must be one of "A", "B", or "C" and refer to the correct option in all three languages. ' +
          'Output the JSON object only.',
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned an empty completion.');
  return validateQuestion(JSON.parse(content));
}

function toRow(q: GeneratedQuestion): Ads5Row {
  return {
    desc_zh: q.desc_zh,
    desc_en: q.desc_en,
    desc_ms: q.desc_ms,
    question_zh: q.question_zh,
    question_en: q.question_en,
    question_ms: q.question_ms,
    answer_zh: q.answer,
    answer_en: q.answer,
    answer_ms: q.answer,
    explanation_zh: q.explanation_zh,
    explanation_en: q.explanation_en,
    explanation_ms: q.explanation_ms,
    img: null,
    optionenA: q.optionenA,
    optionenB: q.optionenB,
    optionenC: q.optionenC,
    optionzhA: q.optionzhA,
    optionzhB: q.optionzhB,
    optionzhC: q.optionzhC,
    optionmsA: q.optionmsA,
    optionmsB: q.optionmsB,
    optionmsC: q.optionmsC,
  };
}

async function main(): Promise<void> {
  const rows: Ads5Row[] = [];
  for (const topic of TOPICS) {
    for (let i = 0; i < QUESTIONS_PER_TOPIC; i++) {
      console.log(`[generate] topic="${topic}" (${i + 1}/${QUESTIONS_PER_TOPIC})`);
      const q = await generateQuestion(topic);
      console.log(`           -> ${q.question_en} [answer=${q.answer}]`);
      rows.push(toRow(q));
    }
  }

  console.log(`[insert] inserting ${rows.length} rows into ads5...`);
  const { data, error } = await supabase.from('ads5').insert(rows).select('id');
  if (error) {
    console.error('[insert] supabase error:', error);
    process.exit(1);
  }
  console.log(`[insert] done. Inserted ${data?.length ?? 0} rows:`);
  for (const row of data ?? []) console.log(`         ${row.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
