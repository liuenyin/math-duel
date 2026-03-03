import fs from 'fs';
import path from 'path';
import { generateSingleProblem } from './ai.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POOL_PATH = path.join(__dirname, 'problems.json');

// All standard tags for variety
const ALL_TAGS = [
    "代数", "几何", "数论", "组合", "不等式", "函数", "平面几何", "解析几何",
    "立体几何", "复数", "向量", "多项式", "数列", "排列组合", "离散数学",
    "初等数论", "取整函数", "同余", "不定方程", "概率", "期望", "三角函数"
];

const DIFFICULTIES = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2800, 3500];

async function generatePool() {
    console.log("=== Math Duel Problem Pool Generator ===");

    let pool = { "800": [], "1000": [], "1200": [], "1400": [], "1600": [], "1800": [], "2000": [], "2200": [], "2800": [], "3500": [] };
    if (fs.existsSync(POOL_PATH)) {
        pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8'));
    }

    const targetPerDiff = 5; // Default generate 5 per difficulty for initial batch
    const model = "deepseek-reasoner"; // Force reasoner for high quality

    for (const diff of DIFFICULTIES) {
        const currentCount = pool[diff.toString()]?.length || 0;
        const needed = targetPerDiff - currentCount;

        if (needed <= 0) {
            console.log(`[Pool] Difficulty ${diff} already has ${currentCount} problems. Skipping.`);
            continue;
        }

        console.log(`\n[Pool] Difficulty ${diff}: Generating ${needed} new problems...`);

        for (let i = 0; i < needed; i++) {
            const randomTag = ALL_TAGS[Math.floor(Math.random() * ALL_TAGS.length)];
            const config = {
                minDifficulty: diff - 50,
                maxDifficulty: diff + 50,
                includeTags: [randomTag],
                excludeTags: []
            };
            const aiConfig = { modelName: model };

            try {
                process.stdout.write(`  (${i + 1}/${needed}) Generating with ${model} (Tag: ${randomTag})... `);
                const startTime = Date.now();

                // We pass existing problems of this difficulty to help the AI avoid direct duplicates
                const prob = await generateSingleProblem(config, aiConfig, pool[diff.toString()]);

                // Ensure difficulty matches the bucket
                prob.difficulty = diff;

                if (!pool[diff.toString()]) pool[diff.toString()] = [];
                pool[diff.toString()].push(prob);

                // Save incrementally so we don't lose progress on crash
                fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2));

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`Done! (${elapsed}s)`);
            } catch (err) {
                console.error(`\n  FAILED: ${err.message}`);
                // Continue to next
            }
        }
    }

    console.log("\n=== Generation Complete! ===");
    const total = Object.values(pool).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`Total problems in pool: ${total}`);
}

generatePool().catch(console.error);
