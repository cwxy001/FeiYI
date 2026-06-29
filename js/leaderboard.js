/*
 * leaderboard.js - 阶段十：排行榜系统
 * 功能：
 *  - 4 个分类：通关速度 / 无尽波次 / 经营繁荣 / 图鉴收集
 *  - 100 个模拟 AI 玩家（10% 高分 / 30% 中分 / 60% 低分）
 *  - 每周一刷新（AI 分数 ±10% 波动，玩家分数保留）
 *  - 玩家成绩上报与排名计算
 * 依赖：game-state.js
 * 日期：2026-06-25
 */
(function () {
    'use strict';

    const AI_PLAYER_COUNT = 100;
    const AI_STORAGE_KEY = 'feiyi-leaderboard-ai';

    // 分类定义：key, 名称, 排序方向（asc=升序越小越好 / desc=降序越大越好）
    const CATEGORIES = {
        'level-speed':       { name: '通关速度', order: 'asc',  unit: '秒' },
        'endless-wave':      { name: '无尽波次', order: 'desc', unit: '波' },
        'management-score':  { name: '经营繁荣', order: 'desc', unit: '分' },
        'collection-rate':   { name: '图鉴收集', order: 'desc', unit: '‰' }
    };

    // AI 玩家名字素材（非遗相关词汇组合）
    const NAME_PREFIX = ['匠心坊主', '绣娘', '茶道', '窑工', '皮影师', '剪纸艺人', '武师', '郎中', '戏班主', '书法大家', '制扇匠', '漆器师', '糖画翁', '花灯匠', '玉雕师'];
    const NAME_SUFFIX = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十', '郑大', '王小', '刘二', '陈三', '杨四', '黄五', '林六'];
    const AVATARS = ['🔨', '🧵', '🍵', '🏺', '🎭', '✂️', '🥋', '🌿', '🎪', '🖌️', '🪭', '🎨', '🍬', '🏮', '💎'];

    /** 工具：获取某时间戳所在周周一 0 点 */
    function _weekStart(ts) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        const day = d.getDay();
        const diff = (day === 0 ? 6 : day - 1);
        d.setDate(d.getDate() - diff);
        return d.getTime();
    }

    /** 按 10%/30%/60% 分布生成一个 AI 分数 */
    function _genAIScore(category) {
        const r = Math.random();
        let tier; // 'high' / 'mid' / 'low'
        if (r < 0.10) tier = 'high';
        else if (r < 0.40) tier = 'mid';
        else tier = 'low';

        let score;
        switch (category) {
            case 'level-speed':
                // 越小越好：high=短时间
                score = tier === 'high' ? _rand(800, 1500) : tier === 'mid' ? _rand(1500, 3000) : _rand(3000, 6000);
                break;
            case 'endless-wave':
                // 无尽波次上限 200
                score = tier === 'high' ? _rand(80, 150) : tier === 'mid' ? _rand(30, 80) : _rand(5, 30);
                break;
            case 'management-score':
                score = tier === 'high' ? _rand(3000, 6000) : tier === 'mid' ? _rand(1500, 3000) : _rand(300, 1500);
                break;
            case 'collection-rate':
                // 千分制
                score = tier === 'high' ? _rand(800, 1000) : tier === 'mid' ? _rand(400, 800) : _rand(100, 400);
                break;
            default:
                score = 0;
        }
        return Math.round(score);
    }

    function _rand(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function _pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    const Leaderboard = {
        aiPlayers: [],   // AI 玩家数组：{ name, avatar, scores: { category: number } }

        /** 初始化 */
        init() {
            this._loadAIPlayers();
            if (this.aiPlayers.length === 0) {
                this.generateAIPlayers();
                this._saveAIPlayers();
            }
            this.refreshWeekly(true); // 启动时检查周刷新（静默）
            console.log('[Leaderboard] 初始化完成，AI 玩家数:', this.aiPlayers.length);
        },

        /** 生成 100 个 AI 玩家 */
        generateAIPlayers() {
            const usedNames = new Set();
            const players = [];
            for (let i = 0; i < AI_PLAYER_COUNT; i++) {
                let name;
                let attempts = 0;
                do {
                    name = `${_pick(NAME_PREFIX)}${_pick(NAME_SUFFIX)}`;
                    attempts++;
                } while (usedNames.has(name) && attempts < 20);
                if (usedNames.has(name)) name = `${name}${i}`; // 兜底去重
                usedNames.add(name);
                players.push({
                    name,
                    avatar: _pick(AVATARS),
                    scores: {
                        'level-speed':      _genAIScore('level-speed'),
                        'endless-wave':     _genAIScore('endless-wave'),
                        'management-score': _genAIScore('management-score'),
                        'collection-rate':  _genAIScore('collection-rate')
                    }
                });
            }
            this.aiPlayers = players;
        },

        /**
         * 每周刷新：AI 分数 ±10% 波动；玩家分数保留
         * @param {boolean} silent - 静默模式（初始化时）
         */
        refreshWeekly(silent) {
            const gs = window.GameState;
            const now = Date.now();
            const thisWeek = _weekStart(now);
            const lastWeek = gs.lastLeaderboardRefresh || 0;
            if (lastWeek && _weekStart(lastWeek) === thisWeek) {
                return; // 本周已刷新
            }
            // AI 分数 ±10% 波动
            for (const p of this.aiPlayers) {
                for (const cat in p.scores) {
                    const base = p.scores[cat];
                    const factor = 1 + (Math.random() * 0.2 - 0.1); // 0.9 ~ 1.1
                    let v = Math.round(base * factor);
                    // 钳制合理范围
                    if (cat === 'level-speed') v = Math.max(30, v);
                    else if (cat === 'endless-wave') v = Math.max(1, Math.min(200, v));
                    else v = Math.max(0, v);
                    p.scores[cat] = v;
                }
            }
            gs.lastLeaderboardRefresh = thisWeek;
            gs.save();
            this._saveAIPlayers();
            if (!silent) console.log('[Leaderboard] 每周排名已刷新');
        },

        /** 提交关卡通关时间（取最快） */
        submitLevelSpeed(levelId, timeSeconds) {
            const gs = window.GameState;
            if (!gs.leaderboardScores) gs.leaderboardScores = {};
            if (!gs.leaderboardScores['level-speed']) gs.leaderboardScores['level-speed'] = {};
            const prev = gs.leaderboardScores['level-speed'][levelId];
            if (prev == null || timeSeconds < prev) {
                gs.leaderboardScores['level-speed'][levelId] = timeSeconds;
                gs.save();
            }
        },

        /** 提交无尽模式波次 */
        submitEndlessScore(wave) {
            const gs = window.GameState;
            if (!gs.leaderboardScores) gs.leaderboardScores = {};
            const prev = gs.leaderboardScores['endless-wave'] || 0;
            if (wave > prev) {
                gs.leaderboardScores['endless-wave'] = wave;
                gs.save();
            }
        },

        /** 提交经营繁荣度 */
        submitManagementScore(score) {
            const gs = window.GameState;
            if (!gs.leaderboardScores) gs.leaderboardScores = {};
            const prev = gs.leaderboardScores['management-score'] || 0;
            if (score > prev) {
                gs.leaderboardScores['management-score'] = score;
                gs.save();
            }
        },

        /** 提交图鉴收集度（千分制） */
        submitCollectionRate(unlockedCount, totalCount) {
            const gs = window.GameState;
            if (!gs.leaderboardScores) gs.leaderboardScores = {};
            const rate = totalCount > 0 ? Math.round(unlockedCount / totalCount * 1000) : 0;
            const prev = gs.leaderboardScores['collection-rate'] || 0;
            if (rate > prev) {
                gs.leaderboardScores['collection-rate'] = rate;
                gs.save();
            }
        },

        /** 获取玩家在某分类的聚合分数 */
        _getPlayerScore(category) {
            const gs = window.GameState;
            const ls = gs.leaderboardScores || {};
            if (category === 'level-speed') {
                // 所有关卡时间之和（未通关的不计）
                const times = ls['level-speed'] || {};
                let sum = 0;
                for (const k in times) sum += times[k];
                return sum;
            }
            return ls[category] || 0;
        },

        /**
         * 获取指定分类的排行榜（合并 AI 与玩家，排序，返回前 100）
         * @returns {Array} 排序后的数组 { name, avatar, score, isPlayer }
         */
        getRanking(category) {
            const conf = CATEGORIES[category];
            const playerScore = this._getPlayerScore(category);
            const entries = [];
            for (const p of this.aiPlayers) {
                entries.push({ name: p.name, avatar: p.avatar, score: p.scores[category] || 0, isPlayer: false });
            }
            // 玩家有分数才加入（level-speed 需至少通关一关）
            if (category === 'level-speed') {
                if (playerScore > 0) entries.push({ name: '我的古镇', avatar: '🏯', score: playerScore, isPlayer: true });
            } else {
                if (playerScore > 0) entries.push({ name: '我的古镇', avatar: '🏯', score: playerScore, isPlayer: true });
            }
            // 排序
            if (conf.order === 'asc') {
                entries.sort((a, b) => a.score - b.score);
            } else {
                entries.sort((a, b) => b.score - a.score);
            }
            return entries.slice(0, 100);
        },

        /** 获取玩家在指定分类的排名（1-based，未上榜返回 -1） */
        getPlayerRank(category) {
            const ranking = this.getRanking(category);
            const idx = ranking.findIndex(e => e.isPlayer);
            return idx >= 0 ? (idx + 1) : -1;
        },

        /** 判断玩家是否在前 100 名 */
        isPlayerInTop100(category) {
            return this.getPlayerRank(category) > 0;
        },

        /**
         * 获取排行榜展示数据（含 rank 字段）
         * @returns {Object} { entries: [...], playerRank, playerScore }
         */
        getRankingDisplayData(category) {
            const entries = this.getRanking(category);
            const ranked = entries.map((e, i) => ({ ...e, rank: i + 1 }));
            const playerRank = this.getPlayerRank(category);
            const playerScore = this._getPlayerScore(category);
            return { entries: ranked, playerRank, playerScore };
        },

        /** 获取分类配置 */
        getCategoryConfig(category) {
            return CATEGORIES[category] || { name: category, order: 'desc', unit: '' };
        },

        /** 获取所有分类 key */
        getCategories() {
            return Object.keys(CATEGORIES);
        },

        // ===== AI 玩家数据持久化（独立 localStorage 键，避免污染主存档） =====
        _saveAIPlayers() {
            try {
                localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(this.aiPlayers));
            } catch (e) {
                console.warn('[Leaderboard] 保存 AI 玩家数据失败:', e);
            }
        },

        _loadAIPlayers() {
            try {
                const raw = localStorage.getItem(AI_STORAGE_KEY);
                if (raw) {
                    this.aiPlayers = JSON.parse(raw) || [];
                }
            } catch (e) {
                console.warn('[Leaderboard] 加载 AI 玩家数据失败:', e);
                this.aiPlayers = [];
            }
        }
    };

    window.Leaderboard = Leaderboard;
    console.log('[leaderboard.js] 已加载：Leaderboard');
})();
