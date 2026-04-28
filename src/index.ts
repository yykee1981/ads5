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

const openai = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } },
);

const QUESTION_JSON_SCHEMA = {
  name: 'multilingual_quiz_question',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      desc_zh: { type: 'string' },
      desc_en: { type: 'string' },
      desc_ms: { type: 'string' },
      question_zh: { type: 'string' },
      question_en: { type: 'string' },
      question_ms: { type: 'string' },
      answer: { type: 'string', enum: ['A', 'B', 'C'] },
      explanation_zh: { type: 'string' },
      explanation_en: { type: 'string' },
      explanation_ms: { type: 'string' },
      optionzhA: { type: 'string' },
      optionzhB: { type: 'string' },
      optionzhC: { type: 'string' },
      optionenA: { type: 'string' },
      optionenB: { type: 'string' },
      optionenC: { type: 'string' },
      optionmsA: { type: 'string' },
      optionmsB: { type: 'string' },
      optionmsC: { type: 'string' },
    },
    required: [
      'desc_zh', 'desc_en', 'desc_ms',
      'question_zh', 'question_en', 'question_ms',
      'answer',
      'explanation_zh', 'explanation_en', 'explanation_ms',
      'optionzhA', 'optionzhB', 'optionzhC',
      'optionenA', 'optionenB', 'optionenC',
      'optionmsA', 'optionmsB', 'optionmsC',
    ],
  },
} as const;

async function generateQuestion(topic: string): Promise<GeneratedQuestion> {
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You write friendly, concise multiple-choice trivia questions in three languages: Chinese (zh), English (en), and Malay (ms). Each question must have exactly three options labelled A, B and C, with one correct answer. The "desc" field is a short upbeat one-sentence caption. The "explanation" briefly justifies why the correct option is correct. Options A, B and C must line up across all three languages (option A in Chinese, English and Malay all describe the same answer).',
      },
      {
        role: 'user',
        content:
          `Topic: ${topic}\n\n` +
          'Generate one new multiple-choice question with three options (A, B, C). ' +
          'Provide every text field in Chinese (zh), English (en) and Malay (ms). ' +
          'The "answer" field must be one of "A", "B", or "C" and refer to the correct option in all three languages.',
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: QUESTION_JSON_SCHEMA,
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty completion.');
  return JSON.parse(content) as GeneratedQuestion;
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
