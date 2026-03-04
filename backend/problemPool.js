import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ProblemPool {
    constructor() {
        this.mathData = [];
        this.olympiadData = [];
        this.loaded = false;
    }

    // 加载 JSON 数据
    loadData() {
        if (this.loaded) return;
        try {
            const mathPath = path.join(__dirname, 'data', 'math.json');
            if (fs.existsSync(mathPath)) {
                this.mathData = JSON.parse(fs.readFileSync(mathPath, 'utf8'));
                console.log(`[ProblemPool] Loaded ${this.mathData.length} MATH problems.`);
            }

            const olympiadPath = path.join(__dirname, 'data', 'olympiad.json');
            if (fs.existsSync(olympiadPath)) {
                this.olympiadData = JSON.parse(fs.readFileSync(olympiadPath, 'utf8'));
                console.log(`[ProblemPool] Loaded ${this.olympiadData.length} OlympiadBench problems.`);
            }
            this.loaded = true;
        } catch (err) {
            console.error('[ProblemPool] Error loading datasets:', err);
        }
    }

    /**
     * 抽取指定数量的随机题目
     * @param {number} count 需抽取的题目数
     * @param {object} config 筛选配置
     * @param {string[]} usedIds 已抽取的题目ID，避免重复
     */
    getRandomProblems(count, config, usedIds = new Set()) {
        if (!this.loaded) this.loadData();

        // 根据选择合并数据源
        let pool = [];
        if (config.dataset === 'math') {
            pool = this.mathData;
        } else if (config.dataset === 'olympiad') {
            pool = this.olympiadData;
        } else {
            pool = [...this.mathData, ...this.olympiadData]; // 全部
        }

        // 按难度筛选 (允许多选)
        if (config.difficulties && config.difficulties.length > 0) {
            pool = pool.filter(p => config.difficulties.includes(p.difficulty));
        }

        // 按标签筛选 (包含任意一个 selected tags)
        if (config.includeTags && config.includeTags.length > 0) {
            pool = pool.filter(p => p.tags.some(tag => config.includeTags.includes(tag)));
        }

        // 排除特定标签
        if (config.excludeTags && config.excludeTags.length > 0) {
            pool = pool.filter(p => !p.tags.some(tag => config.excludeTags.includes(tag)));
        }

        // 过滤掉当前房间已缓存的题，防止重复
        const availablePool = pool.filter(p => !usedIds.has(p.id));

        if (availablePool.length === 0) {
            console.log('[ProblemPool] Not enough unique problems matching criteria. Falling back to pool with repeats.');
            // 如果去重后不够了，就直接从筛选池里随机抓（可能会有重复）
            if (pool.length === 0) {
                throw new Error("No problems match the selected criteria.");
            }
            const shuffled = [...pool].sort(() => 0.5 - Math.random());
            return shuffled.slice(0, count);
        }

        // 打乱顺序选取
        const shuffled = [...availablePool].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }
}

export const problemPool = new ProblemPool();
