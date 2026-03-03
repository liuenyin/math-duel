import dotenv from 'dotenv';
dotenv.config();

// ===== DeepSeek API Configuration =====
const DEEPSEEK_API_KEY = "sk-3d68364cb8fb4e7ba5962940796343a2";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const GEN_MODEL = "deepseek-chat";       // Fast model for problem generation
const JUDGE_MODEL = "deepseek-reasoner"; // Reasoning model for accurate judging

// ===== Unified OpenAI-compatible API call =====
async function callChatCompletion(modelName, prompt, systemPrompt) {
    const url = `${DEEPSEEK_BASE_URL}/chat/completions`;
    const isReasoner = modelName.includes('reasoner');

    // deepseek-reasoner does not support temperature or system role
    const messages = isReasoner
        ? [{ role: 'user', content: prompt }]
        : [
            { role: 'system', content: systemPrompt || '你是一位数学竞赛出题与批改专家。' },
            { role: 'user', content: prompt }
        ];

    const body = {
        model: modelName,
        messages,
        stream: false,
    };
    if (!isReasoner) {
        body.temperature = 0.5;
    }

    console.log(`[AI] Calling ${modelName} at ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120s timeout

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error ${res.status}: ${errText.substring(0, 300)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Parse JSON from the response
    let cleaned = text.trim();
    // Remove markdown code block wrappers
    cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

    // Find first { or [ and last } or ]
    const startObj = cleaned.indexOf('{');
    const startArr = cleaned.indexOf('[');
    let start = -1;
    if (startObj !== -1 && startArr !== -1) start = Math.min(startObj, startArr);
    else if (startObj !== -1) start = startObj;
    else if (startArr !== -1) start = startArr;

    const endObj = cleaned.lastIndexOf('}');
    const endArr = cleaned.lastIndexOf(']');
    let end = -1;
    if (endObj !== -1 && endArr !== -1) end = Math.max(endObj, endArr);
    else if (endObj !== -1) end = endObj;
    else if (endArr !== -1) end = endArr;

    if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.substring(start, end + 1);
    }

    return JSON.parse(cleaned);
}

// ===== Generate a BATCH of problems (one API call, uses deepseek-chat) =====
export async function generateBatchProblems(config) {
    const { numQuestions, minDifficulty, maxDifficulty, includeTags, excludeTags } = config;
    const count = numQuestions || 3;

    const includeStr = includeTags && includeTags.length > 0
        ? `题目应涵盖以下标签/知识点之一：${includeTags.join('、')}。` : '';
    const excludeStr = excludeTags && excludeTags.length > 0
        ? `严格禁止出现以下知识点：${excludeTags.join('、')}。` : '';

    const prompt = `请生成恰好 ${count} 道数学题目，题目之间不可重复，知识点尽量多样。
难度范围（Codeforces 等效）：${minDifficulty || 1200} 到 ${maxDifficulty || 1900}。
${includeStr}
${excludeStr}

所有内容中文，公式用 LaTeX（$...$ 行内，$$...$$ 行间）。

返回一个 JSON 数组，每个元素格式为：
{"problem":"题干", "answer":"答案", "solution":"详细解法", "tags":["标签"], "difficulty":数字}
不要包含额外文字。`;

    try {
        const result = await callChatCompletion(GEN_MODEL, prompt,
            '你是数学竞赛出题专家。返回 JSON 数组，不要代码块。');

        if (Array.isArray(result)) return result;
        return [result];
    } catch (e) {
        console.error("[AI] Error generating batch problems:", e.message);
        return Array.from({ length: count }, (_, i) => {
            const r = Math.floor(Math.random() * 5) + 3;
            return {
                problem: `求 $x$ 的值，已知 $${r}^x = ${Math.pow(r, i + 2)}$。（AI 暂时不可用）`,
                answer: `${i + 2}`,
                solution: `因为 $${r}^x = ${r}^{${i + 2}}$，所以 $x = ${i + 2}$。`,
                tags: ["对数与指数"],
                difficulty: 1000
            };
        });
    }
}

// ===== Generate a SINGLE problem (for replaceProblem, uses deepseek-chat) =====
export async function generateSingleProblem(config, _aiConfig, existingProblems) {
    const { minDifficulty, maxDifficulty, includeTags, excludeTags } = config;

    const includeStr = includeTags && includeTags.length > 0
        ? `题目应涵盖以下标签/知识点之一：${includeTags.join('、')}。` : '';
    const excludeStr = excludeTags && excludeTags.length > 0
        ? `严格禁止出现以下知识点：${excludeTags.join('、')}。` : '';

    const existingDesc = existingProblems && existingProblems.length > 0
        ? `\n以下题目已经存在，请确保新题目不重复：\n${existingProblems.map((p, i) => `${i + 1}. ${p.problem?.substring(0, 60)}`).join('\n')}` : '';

    const prompt = `请生成恰好 1 道数学题目。
难度范围（Codeforces 等效）：${minDifficulty || 1200} 到 ${maxDifficulty || 1900}。
${includeStr}
${excludeStr}
${existingDesc}

所有内容中文，公式用 LaTeX（$...$  行内，$$...$$ 行间）。

返回一个 JSON 对象（不是数组）：
{"problem":"题干", "answer":"答案", "solution":"解法", "tags":["标签"], "difficulty":1500}
不要包含额外文字。`;

    try {
        const result = await callChatCompletion(GEN_MODEL, prompt,
            '你是数学竞赛出题专家。返回单个 JSON 对象，不要数组，不要代码块。');
        if (Array.isArray(result)) return result[0];
        return result;
    } catch (e) {
        console.error("[AI] Error generating single problem:", e.message);
        const r = Math.floor(Math.random() * 5) + 3;
        return {
            problem: `求 $x$ 的值，已知 $${r}^x = ${Math.pow(r, 2)}$。（AI 暂时不可用）`,
            answer: `2`,
            solution: `因为 $${r}^x = ${r}^{2}$，所以 $x = 2$。`,
            tags: ["对数与指数"],
            difficulty: 1000
        };
    }
}

// ===== Judge Answer (uses deepseek-reasoner for accuracy) =====
export async function judgeAnswerSteps(expectedAnswer, solution, userAnswer, userSteps) {
    const prompt = `请批改以下学生答题：

标准答案：${expectedAnswer}
官方解法：${solution}

学生答案：${userAnswer}
学生步骤：${userSteps || "未提交"}

评分规则（满分 100%，推导过程占 80%，最终答案占 20%）：
1. 推导过程完整且正确 → 过程分 60-80%；部分正确 → 按比例给分
2. 最终答案正确 → 答案分 20%；答案错误 → 答案分 0%
3. 只有最终答案正确但无推导过程 → 最多只能给 20%，绝对不能更高
4. 推导过程完整正确 + 答案正确 → 100%
5. 推导过程正确但最后一步计算失误导致答案错 → 60-80%
6. 过程和答案都错或胡写 → 0%

【严格要求】：
- 如果"学生步骤"为"未提交"或者为空或者只有寥寥几个字没有实质推导，即使答案完全正确，过程分必须为 0，总分最多 20%。
- 你必须严格按照"过程 80% + 答案 20%"的权重评分，禁止因为答案正确就直接给高分。
- 只写了一个最终答案没有任何推导的情况，scorePercent 最多为 20。

请直接返回 JSON 对象：{"scorePercent": 0到100的整数, "feedback": "简短中文反馈"}
不要包含任何额外文字。`;

    try {
        const result = await callChatCompletion(JUDGE_MODEL, prompt);

        return {
            scorePercent: result.scorePercent ?? 0,
            feedback: result.feedback || "解析判卷结果出错"
        };
    } catch (e) {
        console.error("[AI] Error judging:", e.message);
        const correct = expectedAnswer.toString().trim() === userAnswer.toString().trim();
        return {
            scorePercent: correct ? 100 : 0,
            feedback: correct ? "回答正确！" : "回答错误。"
        };
    }
}
