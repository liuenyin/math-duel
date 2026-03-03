import dotenv from 'dotenv';
dotenv.config();

const defaultApiKey = process.env.GEMINI_API_KEY || "";
const defaultBaseUrl = process.env.GEMINI_BASE_URL || "https://api.apimart.ai/v1";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview-thinking-apimart";

// ===== Unified OpenAI-compatible API call =====
// Works with: apimart, DeepSeek, OpenAI, 通义千问, 智谱, and any OpenAI-compatible endpoint
async function callChatCompletion(apiKey, baseUrl, modelName, prompt, systemPrompt) {
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const body = {
        model: modelName,
        messages: [
            { role: 'system', content: systemPrompt || '你是一位数学竞赛出题与批改专家。' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.9,
        stream: false,
    };

    console.log(`[AI] Calling ${modelName} at ${url}`);

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error ${res.status}: ${errText.substring(0, 300)}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';

    // Parse JSON from the response (handle ```json ... ``` wrapping)
    let cleaned = text.trim();
    // Remove markdown code block wrappers if present
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```$/i, '').trim();
    }

    return JSON.parse(cleaned);
}

// ===== Generate a SINGLE problem =====
export async function generateSingleProblem(config, aiConfig, existingProblems) {
    const { minDifficulty, maxDifficulty, includeTags, excludeTags } = config;

    const includeStr = includeTags && includeTags.length > 0
        ? `题目应涵盖以下标签/知识点之一：${includeTags.join('、')}。` : '';
    const excludeStr = excludeTags && excludeTags.length > 0
        ? `严格禁止出现以下知识点：${excludeTags.join('、')}。` : '';

    // Avoid duplicates
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
        const apiKey = aiConfig?.apiKey || defaultApiKey;
        const baseUrl = aiConfig?.baseUrl || defaultBaseUrl;
        const modelName = aiConfig?.modelName || DEFAULT_MODEL;
        if (!apiKey) throw new Error("No API key configured");

        const result = await callChatCompletion(apiKey, baseUrl, modelName, prompt,
            '你是数学竞赛出题专家。返回单个 JSON 对象，不要数组，不要代码块。');

        // Handle if AI returns array anyway
        if (Array.isArray(result)) return result[0];
        return result;
    } catch (e) {
        console.error("[AI] Error generating single problem:", e.message);
        const r = Math.floor(Math.random() * 5) + 3;
        return {
            problem: `求 $x$ 的值，已知 $${r}^x = ${Math.pow(r, 2)}$。这道该死的题目只会在调不出来AI时出现。`,
            answer: `2`,
            solution: `因为 $${r}^x = ${r}^{2}$，所以 $x = 2$。`,
            tags: ["对数与指数"],
            difficulty: 1000
        };
    }
}

// ===== Judge Answer =====
export async function judgeAnswerSteps(expectedAnswer, solution, userAnswer, userSteps, aiConfig) {
    const prompt = `请批改以下学生答题：

标准答案：${expectedAnswer}
官方解法：${solution}

学生答案：${userAnswer}
学生步骤：${userSteps || "未提交"}

评分规则（满分 100%，推导过程占 80%，最终答案占 20%）：
1. 推导过程完整且正确 → 过程分 60-80%；部分正确 → 按比例给分
2. 最终答案正确 → 答案分 20%；答案错误 → 答案分 0%
3. 只有最终答案正确但无推导过程 → 仅 20%
4. 推导过程完整正确 + 答案正确 → 100%
5. 推导过程正确但最后一步计算失误导致答案错 → 60-80%
6. 过程和答案都错或胡写 → 0%

请直接返回 JSON 对象：{"scorePercent": 0到100的整数, "feedback": "简短中文反馈"}
不要包含任何额外文字。`;

    try {
        const apiKey = aiConfig?.apiKey || defaultApiKey;
        const baseUrl = aiConfig?.baseUrl || defaultBaseUrl;
        const modelName = aiConfig?.modelName || DEFAULT_MODEL;

        if (!apiKey) throw new Error("No API key configured");

        const result = await callChatCompletion(apiKey, baseUrl, modelName, prompt,
            '你是自动数学阅卷老师。请严格按照要求返回 JSON 对象，不要添加额外文字。');

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
