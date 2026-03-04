import dotenv from 'dotenv';
dotenv.config();

// ===== DeepSeek API Configuration =====
const DEEPSEEK_API_KEY = "sk-3d68364cb8fb4e7ba5962940796343a2";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const GEN_MODEL = "deepseek-chat";       // Fast model for problem generation
const JUDGE_MODEL = "deepseek-reasoner"; // Reasoning model for accurate judging

// ===== Global concurrency limiter (DeepSeek free tier ~2-3 concurrent) =====
const MAX_CONCURRENT = 2;
let activeRequests = 0;
const requestQueue = [];

function acquireSlot() {
    return new Promise(resolve => {
        if (activeRequests < MAX_CONCURRENT) {
            activeRequests++;
            resolve();
        } else {
            requestQueue.push(resolve);
        }
    });
}

function releaseSlot() {
    if (requestQueue.length > 0) {
        const next = requestQueue.shift();
        next(); // don't decrement, the slot transfers
    } else {
        activeRequests--;
    }
}

// ===== Unified OpenAI-compatible API call with retry =====
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
        max_tokens: 8192,
    };
    if (!isReasoner) {
        body.temperature = 0.5;
    }

    const MAX_RETRIES = 3;
    await acquireSlot();
    try {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`[AI] Calling ${modelName} (attempt ${attempt}/${MAX_RETRIES}, active=${activeRequests}/${MAX_CONCURRENT})`);

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 120000);

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

                let cleaned = text.trim();
                cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

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
            } catch (e) {
                console.error(`[AI] Attempt ${attempt} failed: ${e.message}`);
                if (attempt === MAX_RETRIES) throw e;
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`[AI] Retrying in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    } finally {
        releaseSlot();
    }
}



// ===== Judge Answer (uses deepseek-reasoner for accuracy) =====
export async function judgeAnswerSteps(expectedAnswer, solution, userAnswer, userSteps) {
    const prompt = `请批改以下学生答题：

标准答案：${expectedAnswer}
官方解法：${solution}

学生答案：${userAnswer}
学生步骤：${userSteps || "未提交"}

【评分规则】：
1. 如果该题是典型的“计算/求解题”（有明确的最终数值或表达式结果）：
   - 满分 100%，推导过程占 80%，最终答案占 20%。
   - 推导过程完整正确 + 答案正确 → 100%
   - 只有最终答案正确但无推导过程（或寥寥数字无实质） → 最多只给 20%
   - 推导正确但最后计算失误 → 60-80%
   - 过程和答案都错 → 0%

2. 如果该题是“证明题”（答案形如“见解析”、“证明略”或题目要求“证明...”）：
   - 满分 100%，【全部分数 100% 压在推导步骤上】。
   - 完全不需要死查“最终答案”栏的内容。
   - 根据学生步骤前后逻辑严密性、与标准证明的契合度给分。
   - 如果学生步骤为空或无实质内容，直接给 0%。

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
