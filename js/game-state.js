/* 
 * game-state.js - 游戏状态管理
 * 功能：管理游戏资源、工坊、关卡进度、图鉴等状态，并提供持久化功能
 * 日期：2026-06-22
 */

class GameState {
    constructor() {
        // 调试模式已关闭（正式发布）
        const DEBUG = false;
        this.coins = DEBUG ? 99999 : 5000;
        this.inspiration = DEBUG ? 9999 : 100;
        this.scrolls = DEBUG ? 999 : 10;
        this.popularity = 0;
        this.townLevel = 1; // 小镇等级（影响可建筑范围：1=10x10, 7=30x30）

        this.workshops = [];
        this.decorations = [];
        this.removedObstacles = []; // 已拆除的边缘障碍物位置

        this.unlockedLevels = [1];
        this.completedLevels = [];

        this.collection = {
            material: [],
            ich: [],
            monster: []
        };

        this.tutorialStep = 0;
        this.achievements = [];

        this.grid = this._createEmptyGrid();
        this.permanentRelics = []; // 阶段七：永久遗物 id 数组

        // 阶段九：存档版本 + 无尽模式 + 特殊关卡 + 星级
        this.saveVersion = 11;
        this.endlessRecord = 0;          // 无尽模式最高波次（即 endlessMaxWave）
        this.isEndlessMode = false;      // 是否正处于无尽模式（暂停经营产出）
        this.specialCompleted = {};      // 特殊关卡完成记录 { id: timestamp }
        this.levelStars = {};            // 关卡星级 { levelIndex: 0-3 }

        // ===== 阶段十：留存系统数据 =====
        // 日常任务
        this.dailyTasks = [];                 // 当前每日任务实例数组（3 个）
        this.lastDailyRefreshDate = 0;        // 上次每日刷新日期时间戳
        this.weeklyActivity = 0;              // 本周累计活跃度点数
        this.lastWeeklyRefreshDate = 0;       // 上次每周刷新日期时间戳
        this.weeklyRewardsClaimed = [];       // 已领取的周奖励等级数组
        // 成就
        this.unlockedAchievements = [];       // 已解锁成就 ID 数组
        this.claimedAchievements = [];        // 已领取奖励成就 ID 数组
        this.achievementProgress = {};        // 成就进度数据（如累计铜钱、合并次数等）
        // 排行榜
        this.leaderboardScores = {};          // 玩家各分类分数
        this.lastLeaderboardRefresh = 0;      // 上次排行榜刷新日期时间戳
        // 统计数据（用于成就检查）
        this.totalCoinsEarned = 0;            // 累计获得铜钱
        this.totalMergeCount = 0;             // 累计三合一次数
        this.totalLoginDays = 0;              // 累计登录天数
        this.consecutiveLoginDays = 0;        // 连续登录天数
        this.lastLoginDate = '';              // 上次登录日期（YYYY-MM-DD）

        // ===== 阶段十一：PVP系统数据 =====
        this.pvpAttackTokens = 5;             // 进攻令数量
        this.pvpLastTokenRecoverTime = 0;     // 上次进攻令恢复时间戳（0 表示稍后初始化为 now）
        this.pvpAttackDeck = [];              // 进攻卡组（工坊ID数组，5-8）
        this.pvpDefenseFormation = [];        // 防御阵型（{workshopId, gridX, gridY}数组，3-10）
        this.pvpBattleLog = {                 // 对战日志（按模式分类，各最多20条）
            'attack-defense': [],
            'sync-battle': [],
            'defense-race': []
        };
        this.pvpStats = {                     // PVP统计（按模式分别记录胜场/败场）
            'attack-defense': { win: 0, lose: 0 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        };
        this.pvpCurrentMode = null;           // 当前PVP模式

        this.load();
    }

    /**
     * 创建空的16x16网格地图
     * @returns {Array} 16x16二维数组，每个格子状态为empty
     */
    _createEmptyGrid() {
        const grid = [];
        for (let i = 0; i < 16; i++) {
            grid[i] = [];
            for (let j = 0; j < 16; j++) {
                grid[i][j] = 'empty';
            }
        }
        return grid;
    }

    /**
     * 添加铜钱
     * @param {number} amount - 添加数量
     */
    addCoins(amount) {
        this.coins = Math.max(0, this.coins + amount);
        this._updateUI();
    }

    /**
     * 添加灵感
     * @param {number} amount - 添加数量
     */
    addInspiration(amount) {
        this.inspiration = Math.max(0, this.inspiration + amount);
        this._updateUI();
    }

    /**
     * 添加卷轴
     * @param {number} amount - 添加数量
     */
    addScrolls(amount) {
        this.scrolls = Math.max(0, this.scrolls + amount);
        this._updateUI();
    }

    /**
     * 添加人气
     * @param {number} amount - 添加数量
     */
    addPopularity(amount) {
        this.popularity = Math.max(0, this.popularity + amount);
        this._updateUI();
    }

    /**
     * 保存工坊数据（先展开旧数据再覆盖）
     * @param {object} workshop - 工坊数据
     */
    saveWorkshop(workshop) {
        const index = this.workshops.findIndex(w => w.id === workshop.id);
        if (index !== -1) {
            this.workshops[index] = { ...this.workshops[index], ...workshop };
        } else {
            this.workshops.push(workshop);
        }
        this.save();
    }

    /**
     * 获取所有工坊
     * @returns {Array} 工坊数组
     */
    getWorkshops() {
        return this.workshops;
    }

    /**
     * 根据ID获取工坊
     * @param {string} id - 工坊ID
     * @returns {object|null} 工坊对象或null
     */
    getWorkshopById(id) {
        return this.workshops.find(w => w.id === id) || null;
    }

    /**
     * 完成关卡
     * @param {number} levelId - 关卡ID
     */
    completeLevel(levelId) {
        if (!this.completedLevels.includes(levelId)) {
            this.completedLevels.push(levelId);
        }

        const nextLevel = levelId + 1;
        // 阶段九：关卡扩展至 30 关
        if (nextLevel <= 30 && !this.unlockedLevels.includes(nextLevel)) {
            this.unlockedLevels.push(nextLevel);
        }

        this.save();
    }

    /**
     * 解锁图鉴
     * @param {string} category - 类别（material/ich/monster）
     * @param {string} id - 条目ID
     */
    unlockCollection(category, id) {
        if (!this.collection[category]) {
            this.collection[category] = [];
        }
        if (!this.collection[category].includes(id)) {
            this.collection[category].push(id);
        }
        this.save();
    }

    /**
     * 检查图鉴是否已解锁
     * @param {string} category - 类别
     * @param {string} id - 条目ID
     * @returns {boolean} 是否已解锁
     */
    isCollectionUnlocked(category, id) {
        return this.collection[category]?.includes(id) || false;
    }

    /**
     * 保存游戏状态到localStorage
     */
    save() {
        try {
            const saveData = {
                coins: this.coins,
                inspiration: this.inspiration,
                scrolls: this.scrolls,
                popularity: this.popularity,
                townLevel: this.townLevel,
                workshops: this.workshops,
                decorations: this.decorations,
                removedObstacles: this.removedObstacles,
                unlockedLevels: this.unlockedLevels,
                completedLevels: this.completedLevels,
                collection: this.collection,
                tutorialStep: this.tutorialStep,
                achievements: this.achievements,
                grid: this.grid,
                permanentRelics: this.permanentRelics,
                saveVersion: this.saveVersion,
                endlessRecord: this.endlessRecord,
                specialCompleted: this.specialCompleted,
                levelStars: this.levelStars,
                // 阶段十：留存系统数据
                dailyTasks: this.dailyTasks,
                lastDailyRefreshDate: this.lastDailyRefreshDate,
                weeklyActivity: this.weeklyActivity,
                lastWeeklyRefreshDate: this.lastWeeklyRefreshDate,
                weeklyRewardsClaimed: this.weeklyRewardsClaimed,
                unlockedAchievements: this.unlockedAchievements,
                claimedAchievements: this.claimedAchievements,
                achievementProgress: this.achievementProgress,
                leaderboardScores: this.leaderboardScores,
                lastLeaderboardRefresh: this.lastLeaderboardRefresh,
                totalCoinsEarned: this.totalCoinsEarned,
                totalMergeCount: this.totalMergeCount,
                totalLoginDays: this.totalLoginDays,
                consecutiveLoginDays: this.consecutiveLoginDays,
                lastLoginDate: this.lastLoginDate,
                // 阶段十一：PVP系统数据
                pvpAttackTokens: this.pvpAttackTokens,
                pvpLastTokenRecoverTime: this.pvpLastTokenRecoverTime,
                pvpAttackDeck: this.pvpAttackDeck,
                pvpDefenseFormation: this.pvpDefenseFormation,
                pvpBattleLog: this.pvpBattleLog,
                pvpStats: this.pvpStats,
                pvpCurrentMode: this.pvpCurrentMode
            };
            localStorage.setItem('feiyi-guzhen-save', JSON.stringify(saveData));
        } catch (error) {
            console.error('保存游戏状态失败:', error);
        }
    }

    /**
     * 导出存档为 Base64 字符串（用于跨源迁移）
     * @returns {string} Base64 编码的存档数据
     */
    exportSave() {
        try {
            const raw = localStorage.getItem('feiyi-guzhen-save') || '{}';
            // 使用 btoa 转 Base64（支持中文：先 encodeURIComponent 再 escape）
            const b64 = btoa(unescape(encodeURIComponent(raw)));
            return b64;
        } catch (e) {
            console.error('导出存档失败:', e);
            return '';
        }
    }

    /**
     * 从 Base64 字符串导入存档
     * @param {string} b64 - Base64 编码的存档数据
     * @returns {boolean} 是否成功
     */
    importSave(b64) {
        try {
            const raw = decodeURIComponent(escape(atob(b64)));
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || !('coins' in data)) {
                alert('存档数据格式不正确，请检查粘贴的内容');
                return false;
            }
            localStorage.setItem('feiyi-guzhen-save', raw);
            alert('存档导入成功！页面即将刷新...');
            location.reload();
            return true;
        } catch (e) {
            console.error('导入存档失败:', e);
            alert('存档导入失败：' + e.message);
            return false;
        }
    }

    /**
     * 从localStorage加载游戏状态
     */
    load() {
        try {
            const saveData = localStorage.getItem('feiyi-guzhen-save');
            if (saveData) {
                const data = JSON.parse(saveData);
                this.coins = data.coins ?? 1000;
                this.inspiration = data.inspiration ?? 0;
                this.scrolls = data.scrolls ?? 0;
                this.popularity = data.popularity ?? 0;
                this.townLevel = data.townLevel ?? 1;
                this.workshops = data.workshops ?? [];
                this.decorations = data.decorations ?? [];
                this.removedObstacles = data.removedObstacles ?? [];
                this.unlockedLevels = data.unlockedLevels ?? [1];
                this.completedLevels = data.completedLevels ?? [];
                this.collection = data.collection ?? { material: [], ich: [], monster: [] };
                this.tutorialStep = data.tutorialStep ?? 0;
                this.achievements = data.achievements ?? [];
                this.grid = data.grid ?? this._createEmptyGrid();
                this.permanentRelics = data.permanentRelics ?? []; // 兼容旧存档
                // 阶段九：读取新字段（兼容旧存档默认值）
                this.saveVersion = data.saveVersion ?? 0;
                this.endlessRecord = data.endlessRecord ?? 0;
                this.specialCompleted = data.specialCompleted ?? {};
                this.levelStars = data.levelStars ?? {};

                // 阶段十：读取留存系统数据（兼容旧存档默认值）
                this.dailyTasks = data.dailyTasks ?? [];
                this.lastDailyRefreshDate = data.lastDailyRefreshDate ?? 0;
                this.weeklyActivity = data.weeklyActivity ?? 0;
                this.lastWeeklyRefreshDate = data.lastWeeklyRefreshDate ?? 0;
                this.weeklyRewardsClaimed = data.weeklyRewardsClaimed ?? [];
                this.unlockedAchievements = data.unlockedAchievements ?? [];
                this.claimedAchievements = data.claimedAchievements ?? [];
                this.achievementProgress = data.achievementProgress ?? {};
                this.leaderboardScores = data.leaderboardScores ?? {};
                this.lastLeaderboardRefresh = data.lastLeaderboardRefresh ?? 0;
                this.totalCoinsEarned = data.totalCoinsEarned ?? 0;
                this.totalMergeCount = data.totalMergeCount ?? 0;
                this.totalLoginDays = data.totalLoginDays ?? 0;
                this.consecutiveLoginDays = data.consecutiveLoginDays ?? 0;
                this.lastLoginDate = data.lastLoginDate ?? '';

                // 阶段十一：读取 PVP 系统数据（兼容旧存档默认值）
                this.pvpAttackTokens = data.pvpAttackTokens ?? 5;
                this.pvpLastTokenRecoverTime = data.pvpLastTokenRecoverTime ?? 0;
                this.pvpAttackDeck = data.pvpAttackDeck ?? [];
                this.pvpDefenseFormation = data.pvpDefenseFormation ?? [];
                this.pvpBattleLog = data.pvpBattleLog ?? {
                    'attack-defense': [],
                    'sync-battle': [],
                    'defense-race': []
                };
                this.pvpStats = data.pvpStats ?? {
                    'attack-defense': { win: 0, lose: 0 },
                    'sync-battle': { win: 0, lose: 0 },
                    'defense-race': { win: 0, lose: 0 }
                };
                this.pvpCurrentMode = data.pvpCurrentMode ?? null;
                // 进攻令恢复时间戳为 0（首次或旧存档）时初始化为当前时间
                if (this.pvpLastTokenRecoverTime === 0) {
                    this.pvpLastTokenRecoverTime = Date.now();
                }

                // 阶段九：存档版本迁移（v0..v8 旧12关 → v9 30关）
                if (this.saveVersion < 9) {
                    this._migrateToV9();
                }
                // 阶段十：存档版本迁移（v9 → v10，补充留存系统默认值，不覆盖已有数据）
                if (this.saveVersion < 10) {
                    this._migrateToV10();
                }
                // 阶段十一：存档版本迁移（v10 → v11，补充 PVP 系统默认值，不覆盖已有数据）
                if (this.saveVersion < 11) {
                    this._migrateToV11();
                }
            }
        } catch (error) {
            console.error('加载游戏状态失败:', error);
        }
        // 调试模式已关闭（正式发布）
        const DEBUG = false;
        if (DEBUG) {
            this.coins = 99999;
            this.inspiration = 9999;
            this.scrolls = 999;
        }
        this._updateUI();
    }

    /**
     * 重置游戏状态
     */
    reset() {
        this.coins = 1000;
        this.inspiration = 0;
        this.scrolls = 0;
        this.popularity = 0;
        this.workshops = [];
        this.decorations = [];
        this.unlockedLevels = [1];
        this.completedLevels = [];
        this.collection = { material: [], ich: [], monster: [] };
        this.tutorialStep = 0;
        this.achievements = [];
        this.grid = this._createEmptyGrid();
        this.permanentRelics = [];
        // 阶段九：重置新字段
        this.saveVersion = 11;
        this.endlessRecord = 0;
        this.isEndlessMode = false;
        this.specialCompleted = {};
        this.levelStars = {};
        // 阶段十：重置留存系统字段
        this.dailyTasks = [];
        this.lastDailyRefreshDate = 0;
        this.weeklyActivity = 0;
        this.lastWeeklyRefreshDate = 0;
        this.weeklyRewardsClaimed = [];
        this.unlockedAchievements = [];
        this.claimedAchievements = [];
        this.achievementProgress = {};
        this.leaderboardScores = {};
        this.lastLeaderboardRefresh = 0;
        this.totalCoinsEarned = 0;
        this.totalMergeCount = 0;
        this.totalLoginDays = 0;
        this.consecutiveLoginDays = 0;
        this.lastLoginDate = '';
        // 阶段十一：重置 PVP 系统字段
        this.pvpAttackTokens = 5;
        this.pvpLastTokenRecoverTime = Date.now();
        this.pvpAttackDeck = [];
        this.pvpDefenseFormation = [];
        this.pvpBattleLog = {
            'attack-defense': [],
            'sync-battle': [],
            'defense-race': []
        };
        this.pvpStats = {
            'attack-defense': { win: 0, lose: 0 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        };
        this.pvpCurrentMode = null;
        this.save();
        this._updateUI();
    }

    /**
     * 阶段九：存档迁移 v0..v8 → v9
     * 将旧版 12 关进度映射到新版 30 关（旧关 n → 新末关 LEVELS_LEGACY_MAP[n]）
     * 并补齐中间子关卡解锁，保留玩家进度不丢失。
     */
    _migrateToV9() {
        const legacyMap = (window.GameData && window.GameData.LEVELS_LEGACY_MAP) || {
            1: 3, 2: 6, 3: 9, 4: 12, 5: 15, 6: 18,
            7: 21, 8: 24, 9: 27, 10: 29, 11: 27, 12: 30
        };
        // 仅当 completedLevels/unlockedLevels 中存在 <=12 的旧关 index 时触发迁移
        const hasLegacy = this.completedLevels.some(n => n >= 1 && n <= 12 && legacyMap[n])
            || this.unlockedLevels.some(n => n >= 1 && n <= 12 && legacyMap[n]);
        if (!hasLegacy) {
            this.saveVersion = 9;
            return;
        }

        const newCompleted = [];
        const newUnlocked = new Set([1]);

        // 旧 completedLevels：n → legacyMap[n]，并解锁 1..m
        this.completedLevels.forEach(n => {
            if (n >= 1 && n <= 12 && legacyMap[n]) {
                const m = legacyMap[n];
                if (!newCompleted.includes(m)) newCompleted.push(m);
                for (let i = 1; i <= m; i++) newUnlocked.add(i);
            } else {
                // 已是新关卡 index（>12），保留
                if (!newCompleted.includes(n)) newCompleted.push(n);
                newUnlocked.add(n);
            }
        });

        // 旧 unlockedLevels：n → legacyMap[n]
        this.unlockedLevels.forEach(n => {
            if (n >= 1 && n <= 12 && legacyMap[n]) {
                newUnlocked.add(legacyMap[n]);
            } else {
                newUnlocked.add(n);
            }
        });

        this.completedLevels = newCompleted;
        this.unlockedLevels = Array.from(newUnlocked).sort((a, b) => a - b);
        this.saveVersion = 9;
        console.log('[阶段九] 存档已迁移至 v9（30关），completed:', this.completedLevels, 'unlocked:', this.unlockedLevels);
        this.save();
    }

    /**
     * 阶段十：存档迁移 v9 → v10
     * 补充留存系统默认值（不覆盖已有数据），向后兼容阶段九存档。
     */
    _migrateToV10() {
        // 仅当字段缺失时补充默认值（?? 已在 load 中处理，这里确保结构完整）
        if (!Array.isArray(this.dailyTasks)) this.dailyTasks = [];
        if (typeof this.lastDailyRefreshDate !== 'number') this.lastDailyRefreshDate = 0;
        if (typeof this.weeklyActivity !== 'number') this.weeklyActivity = 0;
        if (typeof this.lastWeeklyRefreshDate !== 'number') this.lastWeeklyRefreshDate = 0;
        if (!Array.isArray(this.weeklyRewardsClaimed)) this.weeklyRewardsClaimed = [];
        if (!Array.isArray(this.unlockedAchievements)) this.unlockedAchievements = [];
        if (!Array.isArray(this.claimedAchievements)) this.claimedAchievements = [];
        if (typeof this.achievementProgress !== 'object' || this.achievementProgress === null) this.achievementProgress = {};
        if (typeof this.leaderboardScores !== 'object' || this.leaderboardScores === null) this.leaderboardScores = {};
        if (typeof this.lastLeaderboardRefresh !== 'number') this.lastLeaderboardRefresh = 0;
        if (typeof this.totalCoinsEarned !== 'number') this.totalCoinsEarned = 0;
        if (typeof this.totalMergeCount !== 'number') this.totalMergeCount = 0;
        if (typeof this.totalLoginDays !== 'number') this.totalLoginDays = 0;
        if (typeof this.consecutiveLoginDays !== 'number') this.consecutiveLoginDays = 0;
        if (typeof this.lastLoginDate !== 'string') this.lastLoginDate = '';
        this.saveVersion = 10;
        console.log('[阶段十] 存档已迁移至 v10（留存系统）');
        this.save();
    }

    /**
     * 阶段十一：存档迁移 v10 → v11
     * 补充 PVP 系统默认值（不覆盖已有数据），向后兼容阶段十存档。
     * AI 玩家数据独立存储在 feiyi-guzhen-ai-players 键中。
     */
    _migrateToV11() {
        if (typeof this.pvpAttackTokens !== 'number') this.pvpAttackTokens = 5;
        if (typeof this.pvpLastTokenRecoverTime !== 'number' || this.pvpLastTokenRecoverTime === 0) {
            this.pvpLastTokenRecoverTime = Date.now();
        }
        if (!Array.isArray(this.pvpAttackDeck)) this.pvpAttackDeck = [];
        if (!Array.isArray(this.pvpDefenseFormation)) this.pvpDefenseFormation = [];
        if (typeof this.pvpBattleLog !== 'object' || this.pvpBattleLog === null) {
            this.pvpBattleLog = { 'attack-defense': [], 'sync-battle': [], 'defense-race': [] };
        } else {
            // 补齐缺失的模式键
            if (!Array.isArray(this.pvpBattleLog['attack-defense'])) this.pvpBattleLog['attack-defense'] = [];
            if (!Array.isArray(this.pvpBattleLog['sync-battle'])) this.pvpBattleLog['sync-battle'] = [];
            if (!Array.isArray(this.pvpBattleLog['defense-race'])) this.pvpBattleLog['defense-race'] = [];
        }
        if (typeof this.pvpStats !== 'object' || this.pvpStats === null) {
            this.pvpStats = {
                'attack-defense': { win: 0, lose: 0 },
                'sync-battle': { win: 0, lose: 0 },
                'defense-race': { win: 0, lose: 0 }
            };
        } else {
            // 补齐缺失的模式键及字段
            ['attack-defense', 'sync-battle', 'defense-race'].forEach(mode => {
                if (typeof this.pvpStats[mode] !== 'object' || this.pvpStats[mode] === null) {
                    this.pvpStats[mode] = { win: 0, lose: 0 };
                } else {
                    if (typeof this.pvpStats[mode].win !== 'number') this.pvpStats[mode].win = 0;
                    if (typeof this.pvpStats[mode].lose !== 'number') this.pvpStats[mode].lose = 0;
                }
            });
        }
        if (this.pvpCurrentMode === undefined) this.pvpCurrentMode = null;
        this.saveVersion = 11;
        console.log('[阶段十一] 存档已迁移至 v11（PVP系统）');
        this.save();
    }

    // ===== 阶段十一：PVP系统辅助方法 =====

    /**
     * 保存 PVP 系统数据（整合到主存档）
     * 实际由 save() 统一处理，此处提供独立入口便于 PVP 模块主动保存。
     */
    savePvpData() {
        try {
            this.save();
        } catch (error) {
            console.error('[PVP] 保存PVP数据失败:', error);
        }
    }

    /**
     * 加载 PVP 系统数据（由 load() 统一处理）
     * 此处提供独立入口便于 PVP 模块主动加载/校验。
     * @returns {object} PVP相关字段集合
     */
    loadPvpData() {
        return {
            pvpAttackTokens: this.pvpAttackTokens,
            pvpLastTokenRecoverTime: this.pvpLastTokenRecoverTime,
            pvpAttackDeck: this.pvpAttackDeck,
            pvpDefenseFormation: this.pvpDefenseFormation,
            pvpBattleLog: this.pvpBattleLog,
            pvpStats: this.pvpStats,
            pvpCurrentMode: this.pvpCurrentMode
        };
    }

    // ===== 阶段十：留存系统辅助方法 =====

    /**
     * 累计铜钱统计（用于成就检查）
     * @param {number} amount - 产出铜钱数（正数）
     */
    addTotalCoinsEarned(amount) {
        if (amount > 0) {
            this.totalCoinsEarned += amount;
        }
    }

    /**
     * 累计三合一次数
     */
    addTotalMergeCount() {
        this.totalMergeCount += 1;
    }

    /**
     * 更新登录连续天数（使用日期字符串比较，避免时区问题）
     * - 同一天：不更新
     * - 连续下一天：consecutiveLoginDays++
     * - 间隔超过一天：consecutiveLoginDays=1
     */
    updateLoginStreak() {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        if (this.lastLoginDate === todayStr) {
            return; // 同一天多次打开，不重复计算
        }
        if (this.lastLoginDate) {
            // 计算与上次登录的日期差
            const last = new Date(this.lastLoginDate);
            const cur = new Date(todayStr);
            const diffDays = Math.round((cur - last) / (24 * 60 * 60 * 1000));
            if (diffDays === 1) {
                this.consecutiveLoginDays += 1;
            } else {
                this.consecutiveLoginDays = 1;
            }
        } else {
            this.consecutiveLoginDays = 1;
        }
        this.lastLoginDate = todayStr;
        this.totalLoginDays += 1;
        this.save();
    }

    /**
     * 设置关卡星级（仅当新星级 > 已有星级时更新）
     * @param {number|string} levelId - 关卡 ID（数字序号或字符串）
     * @param {number} stars - 星级 0-3
     */
    setLevelStars(levelId, stars) {
        const key = typeof levelId === 'string' ? this._levelIdToIndex(levelId) : levelId;
        if (key == null) return;
        const prev = this.levelStars[key] || 0;
        if (stars > prev) {
            this.levelStars[key] = stars;
            this.save();
        }
    }

    /**
     * 获取关卡星级
     * @param {number|string} levelId - 关卡 ID
     * @returns {number} 星级 0-3
     */
    getLevelStars(levelId) {
        const key = typeof levelId === 'string' ? this._levelIdToIndex(levelId) : levelId;
        if (key == null) return 0;
        return this.levelStars[key] || 0;
    }

    /**
     * 关卡字符串 ID 转数字序号（'level-1-1' → 1, 'level-3-5' → 25）
     * 兼容纯数字直接返回
     * @param {string} id
     * @returns {number|null}
     */
    _levelIdToIndex(id) {
        if (typeof id === 'number') return id;
        const m = String(id).match(/^level-(\d+)-(\d+)$/);
        if (m) {
            const chapter = parseInt(m[1], 10);
            const sub = parseInt(m[2], 10);
            return (chapter - 1) * 10 + sub;
        }
        const n = parseInt(id, 10);
        return isNaN(n) ? null : n;
    }

    /**
     * 设置无尽模式最高波次（仅当新波次 > 已有记录时更新）
     * @param {number} wave - 波次
     */
    setEndlessMaxWave(wave) {
        if (wave > (this.endlessRecord || 0)) {
            this.endlessRecord = wave;
            this.save();
        }
    }

    /**
     * 检查是否拥有指定永久遗物
     * @param {string} relicId - 遗物ID
     * @returns {boolean}
     */
    hasRelic(relicId) {
        return this.permanentRelics.includes(relicId);
    }

    /**
     * 添加永久遗物（去重），自动保存
     * @param {string} relicId - 遗物ID
     */
    addPermanentRelic(relicId) {
        if (!this.permanentRelics.includes(relicId)) {
            this.permanentRelics.push(relicId);
            this.save();
        }
    }

    /**
     * 更新UI显示
     */
    _updateUI() {
        const coinsEl = document.getElementById('coins-value');
        const inspirationEl = document.getElementById('inspiration-value');
        const scrollsEl = document.getElementById('scrolls-value');
        const popularityEl = document.getElementById('popularity-value');
        
        if (coinsEl) coinsEl.textContent = this.coins;
        if (inspirationEl) inspirationEl.textContent = this.inspiration;
        if (scrollsEl) scrollsEl.textContent = this.scrolls;
        if (popularityEl) popularityEl.textContent = this.popularity;
    }
}

window.GameState = new GameState();