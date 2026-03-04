/**
 * 数据集转换脚本 — 从 HuggingFace API 下载 MATH 和 OlympiadBench 数据集并转为 JSON
 * 带速率限制和断点续传。用法: node scripts/convert-datasets.mjs
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== HuggingFace API 分页下载（带速率控制） =====
async function fetchAllRows(dataset, config, split = 'train') {
    const rows = [];
    let offset = 0;
    const limit = 100;
    let retries = 0;
    while (true) {
        const url = `https://datasets-server.huggingface.co/rows?dataset=${dataset}&config=${config}&split=${split}&offset=${offset}&length=${limit}`;
        try {
            const res = await fetch(url);
            if (res.status === 429) {
                retries++;
                const wait = Math.min(retries * 5000, 30000);
                console.log(`  ⏳ 速率限制，等待 ${wait / 1000}s ...`);
                await sleep(wait);
                continue;
            }
            if (!res.ok) { console.error(`  ❌ HTTP ${res.status}`); break; }
            retries = 0;
            const data = await res.json();
            if (!data.rows || data.rows.length === 0) break;
            rows.push(...data.rows.map(r => r.row));
            if (rows.length % 500 === 0) console.log(`  已获取 ${rows.length} 条...`);
            if (data.rows.length < limit) break;
            offset += limit;
            await sleep(300); // 每次请求间隔 300ms
        } catch (e) {
            retries++;
            console.error(`  ❌ 网络错误: ${e.message}, 重试 ${retries}...`);
            await sleep(5000);
            if (retries > 10) break;
        }
    }
    return rows;
}

// ===== 从 \boxed{...} 中提取答案 =====
function extractBoxedAnswer(solution) {
    if (!solution) return '';
    const idx = solution.lastIndexOf('\\boxed{');
    if (idx === -1) return '';
    let depth = 0;
    let start = idx + 7;
    for (let i = start; i < solution.length; i++) {
        if (solution[i] === '{') depth++;
        else if (solution[i] === '}') {
            if (depth === 0) return solution.substring(start, i);
            depth--;
        }
    }
    return '';
}

// ===== 标签翻译 =====
const MATH_TYPE_ZH = {
    'Algebra': '代数', 'Counting & Probability': '计数与概率',
    'Geometry': '几何', 'Intermediate Algebra': '中级代数',
    'Number Theory': '数论', 'Prealgebra': '预备代数', 'Precalculus': '预备微积分',
};

const OB_SUBFIELD_ZH = {
    'Algebra': '代数', 'Geometry': '几何', 'Combinatorics': '组合',
    'Number Theory': '数论', 'Sequence': '数列', 'Trigonometric Functions': '三角函数',
    'Elementary Functions': '初等函数', 'Probability and Statistics': '概率统计',
    'Inequality': '不等式', 'Plane Geometry': '平面几何', 'Solid Geometry': '立体几何',
    'Polar Coordinates and Parametric Equations': '极坐标与参数方程',
    'Vector': '向量', 'Derivative': '导数', 'Complex Number': '复数',
    'Logic': '逻辑', 'Set': '集合', 'Analytic Geometry': '解析几何',
};

// ===== 转换 MATH =====
async function convertMATH() {
    const outFile = join(DATA_DIR, 'math.json');
    if (existsSync(outFile)) {
        const existing = JSON.parse(readFileSync(outFile, 'utf8'));
        if (existing.length >= 7000) {
            console.log(`✅ MATH 已有 ${existing.length} 道题，跳过下载`);
            return existing.length;
        }
    }
    console.log('\n📚 下载 MATH 数据集...');
    const rows = await fetchAllRows('qwedsacf/competition_math', 'default');
    console.log(`  共获取 ${rows.length} 道题`);

    const problems = rows.map((row, i) => ({
        id: `math_${i}`,
        problem: row.problem,
        answer: extractBoxedAnswer(row.solution),
        solution: row.solution,
        tags: [MATH_TYPE_ZH[row.type] || row.type],
        difficulty: row.level,
        source: 'math',
    }));

    writeFileSync(outFile, JSON.stringify(problems));
    console.log(`✅ MATH: ${problems.length} 道题`);
    return problems.length;
}

// ===== 转换 OlympiadBench =====
async function convertOlympiadBench() {
    const outFile = join(DATA_DIR, 'olympiad.json');
    console.log('\n📚 重新下载 OlympiadBench 数据集 (含证明题)...');
    const configs = [
        'OE_TO_maths_zh_CEE', 'OE_TO_maths_zh_COMP',
        'TP_TO_maths_zh_CEE', 'TP_TO_maths_zh_COMP'
    ];

    const allProblems = [];
    for (const config of configs) {
        console.log(`  正在下载 ${config}...`);
        const rows = await fetchAllRows('Hothan/OlympiadBench', config);
        console.log(`  ${config}: ${rows.length} 道题`);

        const diffLabel = config.includes('CEE') ? '高考' : '竞赛';
        const lang = config.includes('_en_') ? 'en' : 'zh';

        for (const row of rows) {
            allProblems.push({
                id: `ob_${row.id}`,
                problem: row.question,
                answer: Array.isArray(row.final_answer) ? row.final_answer.join(', ') : (row.final_answer || ''),
                solution: Array.isArray(row.solution) ? row.solution.join('\n\n') : (row.solution || ''),
                tags: [OB_SUBFIELD_ZH[row.subfield] || row.subfield],
                difficulty: diffLabel,
                source: 'olympiad',
                language: lang,
                answerType: row.answer_type,
            });
        }
        await sleep(2000); // 子集间等待2秒
    }

    writeFileSync(outFile, JSON.stringify(allProblems));
    console.log(`✅ OlympiadBench: ${allProblems.length} 道题`);
    return allProblems.length;
}

// ===== 主流程 =====
async function main() {
    console.log('🚀 开始转换数据集...\n');
    const mathCount = await convertMATH();
    const obCount = await convertOlympiadBench();
    console.log(`\n🎉 转换完成！共 ${mathCount + obCount} 道题`);
    console.log(`   MATH: ${mathCount} | OlympiadBench: ${obCount}`);
}

main().catch(e => { console.error('❌ 转换失败:', e); process.exit(1); });
