/*
 * pvp-system.js - PVP系统（三种对战模式 + 本地模拟AI玩家）
 * 功能：纯本地模拟PVP，包含攻守轮换制/同步对战制/防守竞赛制三种模式
 *       以及100个模拟AI玩家子系统。无服务器依赖，数据存localStorage。
 * 日期：2026-06-25
 * 依赖：game-state.js, data.js
 *
 * 模块结构：
 *   - AIPlayerSystem：模拟AI玩家子系统（生成/活跃/模拟对战/持久化）
 *   - PvpSystem：PVP通用系统（进攻令/卡组/防御阵型/匹配/统计/评级/日志）
 *   - AttackDefenseMode：攻守轮换制
 *   - SyncBattleMode：同步对战制
 *   - DefenseRaceMode：防守竞赛制
 */

// ============================================================
// 模拟AI玩家子系统（AIPlayerSystem）
// ============================================================
const AIPlayerSystem = {
    AI_PLAYER_COUNT: 100,
    aiPlayers: [],
    lastAIActiveTime: 0,
    _activityTimer: null,

    // 非遗相关姓氏与身份词，用于组合AI玩家名字
    _SURNAMES: ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '林', '郭', '何', '高', '罗', '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹'],
    _TITLES: ['匠心坊主', '绣娘', '茶道', '陶艺师', '剪纸传人', '皮影戏班主', '武馆掌门', '戏曲名角', '漆器名家', '雕版师', '染坊掌柜', '糖画师', '风筝匠', '油纸伞匠', '花灯师', '古琴师', '青铜匠', '年画师', '泥人张', '缂丝匠'],
    _NAME_GIVEN: ['三', '四', '五', '六', '七', '八', '九', '十', '大', '小', '春', '夏', '秋', '冬', '明', '华', '建', '国', '文', '武', '德', '才', '福', '禄', '寿', '喜', '财', '吉', '祥', '安'],
    _AVATARS: ['🔨', '🪡', '🍵', '🏺', '✂️', '🎭', '🥋', '🎨', '🖌️', '🖨️', '🧵', '🍬', '🪁', '☂️', '🏮', '🎸', '🔮', '📜', '🎎', '🧶'],

    AI_STORAGE_KEY: 'feiyi-guzhen-ai-players',

    /**
     * 初始化：优先从localStorage加载，无则生成100个AI玩家
     */
    init() {
        const loaded = this.loadAIPlayers();
        if (loaded && this.aiPlayers.length === this.AI_PLAYER_COUNT) {
            console.log('[AIPlayerSystem] 已加载', this.aiPlayers.length, '个AI玩家');
        } else {
            this.generateAIPlayers();
            this.saveAIPlayers();
            console.log('[AIPlayerSystem] 已生成', this.aiPlayers.length, '个AI玩家');
        }
        this.lastAIActiveTime = Date.now();
    },

    /**
     * 生成100个AI玩家数据
     * 繁荣度分布：10%高(5000-10000) / 30%中(2000-5000) / 60%低(500-2000)
     * 名字不重复
     */
    generateAIPlayers() {
        this.aiPlayers = [];
        const usedNames = new Set();
        const ichList = (window.GameData && window.GameData.ICH_LIST) || [];

        for (let i = 0; i < this.AI_PLAYER_COUNT; i++) {
            // 决定繁荣度档位
            const roll = Math.random();
            let prosperity;
            if (roll < 0.10) {
                prosperity = 5000 + Math.floor(Math.random() * 5001); // 高 5000-10000
            } else if (roll < 0.40) {
                prosperity = 2000 + Math.floor(Math.random() * 3001); // 中 2000-5000
            } else {
                prosperity = 500 + Math.floor(Math.random() * 1501);  // 低 500-2000
            }

            // 生成不重复名字
            let name = this._generateUniqueName(usedNames);
            usedNames.add(name);

            const avatar = this._AVATARS[Math.floor(Math.random() * this._AVATARS.length)];
            const level = Math.max(1, Math.min(30, Math.floor(prosperity / 300) + 1));

            const aiPlayer = {
                id: 'ai-' + String(i + 1).padStart(3, '0'),
                name: name,
                avatar: avatar,
                prosperity: prosperity,
                isOnline: false,
                lastActiveTime: Date.now() - Math.floor(Math.random() * 1800000), // 随机过去0-30分钟
                townLayout: this._generateTownLayout(ichList, prosperity),
                defenseFormation: [],
                attackDeck: [],
                level: level,
                pvpRating: this._prosperityToRating(prosperity),
                pvpStats: this._generateInitialPvpStats(prosperity)
            };

            aiPlayer.defenseFormation = this._generateDefenseFormation(prosperity);
            aiPlayer.attackDeck = this._generateAttackDeck(ichList);

            this.aiPlayers.push(aiPlayer);
        }
    },

    /**
     * 生成不重复名字（姓氏+身份+名字），冲突时加序号
     */
    _generateUniqueName(usedNames) {
        for (let attempt = 0; attempt < 50; attempt++) {
            const surname = this._SURNAMES[Math.floor(Math.random() * this._SURNAMES.length)];
            const title = this._TITLES[Math.floor(Math.random() * this._TITLES.length)];
            const given = this._NAME_GIVEN[Math.floor(Math.random() * this._NAME_GIVEN.length)];
            const name = `${surname}${title}${given}`;
            if (!usedNames.has(name)) return name;
        }
        // 兜底：加随机数
        return `匠人${Math.floor(Math.random() * 100000)}`;
    },

    /**
     * 生成AI古镇布局：随机3-15个建筑，不重叠不超边界
     */
    _generateTownLayout(ichList, prosperity) {
        const buildings = [];
        const buildingCount = Math.min(15, Math.max(3, Math.floor(prosperity / 600) + 3));
        const occupied = new Set();
        for (let i = 0; i < buildingCount && ichList.length > 0; i++) {
            const ich = ichList[Math.floor(Math.random() * ichList.length)];
            // 随机放置位置（16x16网格，建筑占2x2，避免重叠）
            let gridX, gridY, key, tries = 0;
            do {
                gridX = Math.floor(Math.random() * 14);
                gridY = Math.floor(Math.random() * 14);
                key = `${gridX},${gridY}`;
                tries++;
            } while (occupied.has(key) && tries < 20);
            if (tries >= 20) continue;
            occupied.add(key);
            buildings.push({
                id: ich.id,
                name: ich.name,
                emoji: ich.emoji,
                gridX: gridX,
                gridY: gridY,
                level: 1 + Math.floor(Math.random() * 5)
            });
        }
        return { buildings: buildings };
    },

    /**
     * 生成AI防御阵型：根据繁荣度决定塔数(3-8)
     */
    _generateDefenseFormation(prosperity) {
        const towerCount = Math.min(8, Math.max(3, Math.floor(prosperity / 800) + 3));
        const formation = [];
        const occupied = new Set();
        for (let i = 0; i < towerCount; i++) {
            let gridX, gridY, key, tries = 0;
            do {
                gridX = Math.floor(Math.random() * 16);
                gridY = Math.floor(Math.random() * 16);
                key = `${gridX},${gridY}`;
                tries++;
            } while (occupied.has(key) && tries < 20);
            if (tries >= 20) continue;
            occupied.add(key);
            formation.push({
                workshopId: `ai-tower-${i}`,
                gridX: gridX,
                gridY: gridY
            });
        }
        return formation;
    },

    /**
     * 生成AI进攻卡组：随机5-8个工坊ID
     */
    _generateAttackDeck(ichList) {
        if (!ichList || ichList.length === 0) return [];
        const deckSize = 5 + Math.floor(Math.random() * 4); // 5-8
        const shuffled = [...ichList].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, Math.min(deckSize, shuffled.length)).map(ich => ich.id);
    },

    /**
     * 繁荣度转评级
     */
    _prosperityToRating(prosperity) {
        if (prosperity >= 7000) return 'S';
        if (prosperity >= 5000) return 'A';
        if (prosperity >= 3000) return 'B';
        if (prosperity >= 1500) return 'C';
        return 'D';
    },

    /**
     * 生成AI初始PVP统计（繁荣度越高胜场越多）
     */
    _generateInitialPvpStats(prosperity) {
        const base = Math.floor(prosperity / 200);
        return {
            'attack-defense': {
                win: base + Math.floor(Math.random() * 10),
                lose: Math.floor(Math.random() * 10)
            },
            'sync-battle': {
                win: Math.floor(base * 0.8) + Math.floor(Math.random() * 8),
                lose: Math.floor(Math.random() * 10)
            },
            'defense-race': {
                win: base + Math.floor(Math.random() * 12),
                lose: Math.floor(Math.random() * 8)
            }
        };
    },

    /**
     * 更新AI玩家活跃度
     * - 随机10-20个AI上线
     * - 超过30分钟未活跃的下线
     * - 10%概率触发AI间模拟对战
     */
    updateAIActivity() {
        const now = Date.now();
        // 下线超过30分钟的
        this.aiPlayers.forEach(ai => {
            if (ai.isOnline && (now - ai.lastActiveTime) > 30 * 60 * 1000) {
                ai.isOnline = false;
            }
        });
        // 随机上线10-20个
        const onlineTarget = 10 + Math.floor(Math.random() * 11);
        const offlineAIs = this.aiPlayers.filter(ai => !ai.isOnline);
        const shuffled = offlineAIs.sort(() => Math.random() - 0.5);
        for (let i = 0; i < Math.min(onlineTarget, shuffled.length); i++) {
            shuffled[i].isOnline = true;
            shuffled[i].lastActiveTime = now;
        }
        // 10%概率模拟AI间对战
        if (Math.random() < 0.10) {
            this.simulateAIBattle();
        }
        this.lastAIActiveTime = now;
        // 活跃更新后持久化（避免频繁写盘，仅在状态变化时）
        this.saveAIPlayers();
    },

    /**
     * 模拟AI玩家之间的PVP对战
     * 随机选2个在线AI，根据繁荣度和评级决定胜负，更新统计
     */
    simulateAIBattle() {
        const onlineAIs = this.aiPlayers.filter(ai => ai.isOnline);
        if (onlineAIs.length < 2) return;
        const shuffled = [...onlineAIs].sort(() => Math.random() - 0.5);
        const ai1 = shuffled[0];
        const ai2 = shuffled[1];
        // 胜负概率：繁荣度高+评级高的胜率更高
        const score1 = ai1.prosperity + this._ratingToScore(ai1.pvpRating) * 500;
        const score2 = ai2.prosperity + this._ratingToScore(ai2.pvpRating) * 500;
        const total = score1 + score2;
        const winProb1 = total > 0 ? score1 / total : 0.5;
        const ai1Win = Math.random() < winProb1;
        const modes = ['attack-defense', 'sync-battle', 'defense-race'];
        const mode = modes[Math.floor(Math.random() * 3)];
        if (ai1Win) {
            ai1.pvpStats[mode].win++;
            ai2.pvpStats[mode].lose++;
        } else {
            ai1.pvpStats[mode].lose++;
            ai2.pvpStats[mode].win++;
        }
        // 更新评级
        ai1.pvpRating = this._recalcRating(ai1.pvpStats);
        ai2.pvpRating = this._recalcRating(ai2.pvpStats);
    },

    /**
     * 评级转分数（用于模拟对战胜负计算）
     */
    _ratingToScore(rating) {
        const map = { 'S': 4, 'A': 3, 'B': 2, 'C': 1, 'D': 0 };
        return map[rating] || 0;
    },

    /**
     * 根据PVP统计重算评级（总胜率）
     */
    _recalcRating(stats) {
        let win = 0, lose = 0;
        ['attack-defense', 'sync-battle', 'defense-race'].forEach(m => {
            win += (stats[m] && stats[m].win) || 0;
            lose += (stats[m] && stats[m].lose) || 0;
        });
        const total = win + lose;
        if (total === 0) return 'D';
        const winRate = win / total;
        if (winRate >= 0.8) return 'S';
        if (winRate >= 0.65) return 'A';
        if (winRate >= 0.5) return 'B';
        if (winRate >= 0.35) return 'C';
        return 'D';
    },

    /**
     * 根据ID获取AI玩家
     */
    getAIPlayerById(id) {
        return this.aiPlayers.find(ai => ai.id === id) || null;
    },

    /**
     * 随机获取一个AI玩家（可排除指定ID）
     */
    getRandomAIPlayer(excludeId) {
        const pool = excludeId ? this.aiPlayers.filter(ai => ai.id !== excludeId) : this.aiPlayers;
        if (pool.length === 0) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    },

    /**
     * 按繁荣度范围获取AI玩家
     */
    getAIPlayersByProsperity(minScore, maxScore) {
        return this.aiPlayers.filter(ai => ai.prosperity >= minScore && ai.prosperity <= maxScore);
    },

    /**
     * AI玩家数据持久化到localStorage
     */
    saveAIPlayers() {
        try {
            localStorage.setItem(this.AI_STORAGE_KEY, JSON.stringify(this.aiPlayers));
        } catch (error) {
            console.error('[AIPlayerSystem] 保存AI玩家数据失败:', error);
        }
    },

    /**
     * 从localStorage加载AI玩家数据
     * @returns {boolean} 是否加载成功
     */
    loadAIPlayers() {
        try {
            const data = localStorage.getItem(this.AI_STORAGE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this.aiPlayers = parsed;
                    return true;
                }
            }
        } catch (error) {
            console.error('[AIPlayerSystem] 加载AI玩家数据失败:', error);
        }
        return false;
    },

    /**
     * 启动AI活跃定时器（每5分钟一次，页面隐藏时降为15分钟）
     */
    startActivityTimer() {
        if (this._activityTimer) clearInterval(this._activityTimer);
        const interval = document.hidden ? 15 * 60 * 1000 : 5 * 60 * 1000;
        this._activityTimer = setInterval(() => this.updateAIActivity(), interval);
    }
};

// ============================================================
// PVP通用系统（PvpSystem）
// ============================================================
const PvpSystem = {
    // 属性（镜像 GameState 字段，实际以 GameState 为准）
    attackTokens: 5,
    maxAttackTokens: 5,
    lastTokenRecoverTime: 0,
    attackDeck: [],
    defenseFormation: [],
    battleLog: { 'attack-defense': [], 'sync-battle': [], 'defense-race': [] },
    pvpStats: { 'attack-defense': { win: 0, lose: 0 }, 'sync-battle': { win: 0, lose: 0 }, 'defense-race': { win: 0, lose: 0 } },
    matchedOpponent: null,
    currentMode: null,

    TOKEN_RECOVER_INTERVAL: 3600000, // 1小时
    MAX_BATTLE_LOG_PER_MODE: 20,

    /**
     * 初始化：从GameState同步数据
     */
    init() {
        this.syncFromGameState();
    },

    /**
     * 从GameState同步PVP数据到本模块
     */
    syncFromGameState() {
        const gs = window.GameState;
        if (!gs) return;
        this.attackTokens = gs.pvpAttackTokens;
        this.maxAttackTokens = 5;
        this.lastTokenRecoverTime = gs.pvpLastTokenRecoverTime;
        this.attackDeck = gs.pvpAttackDeck || [];
        this.defenseFormation = gs.pvpDefenseFormation || [];
        this.battleLog = gs.pvpBattleLog || this.battleLog;
        this.pvpStats = gs.pvpStats || this.pvpStats;
        this.currentMode = gs.pvpCurrentMode || null;
    },

    /**
     * 将本模块数据保存到GameState并持久化
     */
    syncToGameState() {
        const gs = window.GameState;
        if (!gs) return;
        gs.pvpAttackTokens = this.attackTokens;
        gs.pvpLastTokenRecoverTime = this.lastTokenRecoverTime;
        gs.pvpAttackDeck = this.attackDeck;
        gs.pvpDefenseFormation = this.defenseFormation;
        gs.pvpBattleLog = this.battleLog;
        gs.pvpStats = this.pvpStats;
        gs.pvpCurrentMode = this.currentMode;
        gs.savePvpData();
    },

    /**
     * 检查进攻令恢复
     * 每小时恢复1个，按整小时对齐（不足1小时的余量保留到下次）
     * 恢复到上限后停止，lastTokenRecoverTime重置为now
     */
    checkTokenRecovery() {
        this.syncFromGameState();
        const now = Date.now();
        // 首次或异常：时间戳为0时初始化
        if (this.lastTokenRecoverTime === 0) {
            this.lastTokenRecoverTime = now;
            this.syncToGameState();
            return;
        }
        // 已达上限：重新计时
        if (this.attackTokens >= this.maxAttackTokens) {
            this.lastTokenRecoverTime = now;
            this.syncToGameState();
            return;
        }
        const hoursPassed = Math.floor((now - this.lastTokenRecoverTime) / this.TOKEN_RECOVER_INTERVAL);
        if (hoursPassed > 0) {
            this.attackTokens = Math.min(this.maxAttackTokens, this.attackTokens + hoursPassed);
            // 按整小时对齐，保留不足1小时的余量
            this.lastTokenRecoverTime = this.lastTokenRecoverTime + hoursPassed * this.TOKEN_RECOVER_INTERVAL;
            // 恢复到上限后重新计时
            if (this.attackTokens >= this.maxAttackTokens) {
                this.lastTokenRecoverTime = now;
            }
            this.syncToGameState();
        }
    },

    /**
     * 消耗1个进攻令（进入战斗时调用）
     * @returns {boolean} 是否消耗成功
     */
    consumeToken() {
        this.checkTokenRecovery();
        if (this.attackTokens <= 0) return false;
        // 若之前是满状态，记录恢复起始时间为now
        const wasFull = this.attackTokens >= this.maxAttackTokens;
        this.attackTokens--;
        if (wasFull) {
            this.lastTokenRecoverTime = Date.now();
        }
        this.syncToGameState();
        return true;
    },

    /**
     * 获取恢复倒计时（毫秒，到下一个整小时）
     * 已满则返回0
     */
    getTokenRecoverCountdown() {
        this.syncFromGameState();
        if (this.attackTokens >= this.maxAttackTokens) return 0;
        if (this.lastTokenRecoverTime === 0) return 0;
        const now = Date.now();
        const elapsed = now - this.lastTokenRecoverTime;
        const remaining = this.TOKEN_RECOVER_INTERVAL - (elapsed % this.TOKEN_RECOVER_INTERVAL);
        return remaining;
    },

    /**
     * 设置进攻卡组
     * @param {string[]} workshopIds 工坊ID数组（5-8个）
     * @returns {{success: boolean, reason?: string}}
     */
    setAttackDeck(workshopIds) {
        if (!Array.isArray(workshopIds)) {
            return { success: false, reason: '参数必须为数组' };
        }
        if (workshopIds.length < 5 || workshopIds.length > 8) {
            return { success: false, reason: `进攻卡组数量需为5-8个，当前${workshopIds.length}个` };
        }
        // 校验工坊ID存在
        const gs = window.GameState;
        const validIds = new Set((gs.workshops || []).map(w => w.id));
        for (const id of workshopIds) {
            if (!validIds.has(id)) {
                return { success: false, reason: `工坊ID不存在：${id}` };
            }
        }
        // 校验无重复
        const set = new Set(workshopIds);
        if (set.size !== workshopIds.length) {
            return { success: false, reason: '进攻卡组存在重复工坊ID' };
        }
        this.attackDeck = [...workshopIds];
        this.syncToGameState();
        return { success: true };
    },

    /**
     * 获取当前进攻卡组
     */
    getAttackDeck() {
        this.syncFromGameState();
        return this.attackDeck;
    },

    /**
     * 获取出战牌组（三模式共用的统一接口）
     * 内部等同于 getAttackDeck，为未来微信小程序真人匹配预留语义化 API
     */
    getBattleDeck() {
        return this.getAttackDeck();
    },

    /**
     * 获取可用于进攻的工坊列表（已建造的工坊）
     */
    getAvailableWorkshops() {
        const gs = window.GameState;
        return gs.workshops || [];
    },

    /**
     * [已废弃] 设置防御阵型 — PVP改造后统一使用出战牌组，此方法保留向后兼容
     * @param {Array} formation [{workshopId, gridX, gridY}]，3-10个
     * @returns {{success: boolean, reason?: string}}
     */
    setDefenseFormation(formation) {
        if (!Array.isArray(formation)) {
            return { success: false, reason: '参数必须为数组' };
        }
        if (formation.length < 3 || formation.length > 10) {
            return { success: false, reason: `防御塔数量需为3-10个，当前${formation.length}个` };
        }
        // 校验位置不重叠
        const posSet = new Set();
        for (const t of formation) {
            const key = `${t.gridX},${t.gridY}`;
            if (posSet.has(key)) {
                return { success: false, reason: `防御塔位置重叠：${key}` };
            }
            posSet.add(key);
            // 校验不超出地图边界（16x16）
            const unlocked = window.IsometricMap ? window.IsometricMap.getUnlockedSize() : 16;
            if (t.gridX < 0 || t.gridX >= unlocked || t.gridY < 0 || t.gridY >= unlocked) {
                return { success: false, reason: `防御塔位置超出边界：${key}` };
            }
        }
        this.defenseFormation = formation.map(t => ({ workshopId: t.workshopId, gridX: t.gridX, gridY: t.gridY }));
        this.syncToGameState();
        return { success: true };
    },

    /**
     * [已废弃] 获取当前防御阵型 — PVP改造后不再使用
     */
    getDefenseFormation() {
        this.syncFromGameState();
        return this.defenseFormation;
    },

    /**
     * 计算玩家繁荣度
     * 繁荣度 = 建筑数量×100 + 总等级×50 + 装饰景观值
     * （规格要求复用阶段十 calculateManagementScore，但项目无此函数，此处等价实现）
     */
    calculateProsperity() {
        const gs = window.GameState;
        let buildingCount = 0;
        let totalLevel = 0;
        // 工坊作为建筑
        (gs.workshops || []).forEach(w => {
            buildingCount++;
            totalLevel += (w.level || 1);
        });
        // 装饰作为建筑并贡献景观值
        let decorationValue = 0;
        (gs.decorations || []).forEach(d => {
            buildingCount++;
            decorationValue += (d.beauty || d.value || 50);
        });
        return buildingCount * 100 + totalLevel * 50 + decorationValue;
    },

    /**
     * 匹配对手
     * - attack-defense/sync-battle需进攻令，defense-race不需要
     * - 繁荣度±30%范围内筛选，不足3个扩大到±50%
     * - 不消耗进攻令（进入战斗时消耗）
     * @param {string} mode 'attack-defense'|'sync-battle'|'defense-race'
     * @returns {{success: boolean, opponent?: object, reason?: string}}
     */
    matchOpponent(mode) {
        this.checkTokenRecovery();
        // 进攻令校验（防守竞赛不需要）
        if (mode !== 'defense-race' && this.attackTokens <= 0) {
            return { success: false, reason: '进攻令不足' };
        }
        const playerProsperity = this.calculateProsperity();
        // 先在±30%范围筛选
        let candidates = this._findCandidates(playerProsperity, 0.30);
        if (candidates.length < 3) {
            // 扩大到±50%
            candidates = this._findCandidates(playerProsperity, 0.50);
        }
        if (candidates.length === 0) {
            // 兜底：随机取一个
            const fallback = AIPlayerSystem.getRandomAIPlayer();
            if (fallback) candidates = [fallback];
        }
        if (candidates.length === 0) {
            return { success: false, reason: '无可匹配的对手' };
        }
        const opponent = candidates[Math.floor(Math.random() * candidates.length)];
        this.matchedOpponent = opponent;
        this.currentMode = mode;
        this.syncToGameState();
        return { success: true, opponent: opponent };
    },

    /**
     * 在繁荣度范围内查找候选对手
     */
    _findCandidates(playerProsperity, ratio) {
        const min = playerProsperity * (1 - ratio);
        const max = playerProsperity * (1 + ratio);
        return AIPlayerSystem.getAIPlayersByProsperity(min, max);
    },

    /**
     * 获取PVP统计数据
     */
    getPvpStats() {
        this.syncFromGameState();
        return this.pvpStats;
    },

    /**
     * 获取PVP评级（根据总胜率：S/A/B/C/D）
     * S:>=80% A:>=65% B:>=50% C:>=35% D:<35%
     */
    getPvpRating() {
        const stats = this.getPvpStats();
        let win = 0, lose = 0;
        ['attack-defense', 'sync-battle', 'defense-race'].forEach(m => {
            win += (stats[m] && stats[m].win) || 0;
            lose += (stats[m] && stats[m].lose) || 0;
        });
        const total = win + lose;
        if (total === 0) return 'D';
        const winRate = win / total;
        if (winRate >= 0.8) return 'S';
        if (winRate >= 0.65) return 'A';
        if (winRate >= 0.5) return 'B';
        if (winRate >= 0.35) return 'C';
        return 'D';
    },

    /**
     * 记录对战结果
     * @param {string} mode 模式
     * @param {string} result 'win'|'lose'|'draw'
     * @param {object} reward 奖励 {coins, inspiration, scrolls}
     * @param {string} opponentName 对手名
     */
    recordBattleResult(mode, result, reward, opponentName) {
        this.syncFromGameState();
        if (result === 'win') {
            this.pvpStats[mode].win++;
        } else if (result === 'lose') {
            this.pvpStats[mode].lose++;
        }
        // draw不计入胜负
        // 记录日志
        const logEntry = {
            mode: mode,
            result: result,
            opponent: opponentName || '未知对手',
            reward: reward || {},
            time: Date.now()
        };
        if (!this.battleLog[mode]) this.battleLog[mode] = [];
        this.battleLog[mode].unshift(logEntry);
        if (this.battleLog[mode].length > this.MAX_BATTLE_LOG_PER_MODE) {
            this.battleLog[mode] = this.battleLog[mode].slice(0, this.MAX_BATTLE_LOG_PER_MODE);
        }
        this.syncToGameState();
    },

    /**
     * 发放PVP奖励到GameState
     * @param {object} reward {coins, inspiration, scrolls}
     */
    grantReward(reward) {
        const gs = window.GameState;
        if (!gs || !reward) return;
        if (reward.coins) gs.addCoins(reward.coins);
        if (reward.inspiration) gs.addInspiration(reward.inspiration);
        if (reward.scrolls) gs.addScrolls(reward.scrolls);
    },

    /**
     * 生成随机奖励（按模式）
     */
    generateReward(mode) {
        const ranges = {
            'attack-defense': { coins: [200, 500], inspiration: [20, 50], scrolls: 2 },
            'sync-battle': { coins: [300, 600], inspiration: [30, 60], scrolls: 3 },
            'defense-race': { coins: [200, 400], inspiration: [20, 40], scrolls: 2 }
        };
        const r = ranges[mode] || ranges['attack-defense'];
        const coins = r.coins[0] + Math.floor(Math.random() * (r.coins[1] - r.coins[0] + 1));
        const inspiration = r.inspiration[0] + Math.floor(Math.random() * (r.inspiration[1] - r.inspiration[0] + 1));
        return { coins, inspiration, scrolls: r.scrolls };
    }
};

// ============================================================
// 攻守轮换制（AttackDefenseMode）
// ============================================================
const AttackDefenseMode = {
    round: 1,
    timeLimit: 180, // 秒
    timeRemaining: 180,
    playerAttackScore: 0,
    aiAttackScore: 0,
    isActive: false,
    opponent: null,

    /**
     * 开始攻守轮换制对战
     * @param {object} opponent AI对手数据
     * @returns {boolean} 是否成功开始
     */
    start(opponent) {
        if (!opponent) return false;
        // 消耗进攻令
        if (!PvpSystem.consumeToken()) {
            return false;
        }
        this.opponent = opponent;
        this.round = 1;
        this.playerAttackScore = 0;
        this.aiAttackScore = 0;
        this.isActive = true;
        this.timeRemaining = this.timeLimit;
        // 委托塔防引擎加载第一回合（玩家防守）
        if (window.TowerDefense && typeof window.TowerDefense.startAttackDefense === 'function') {
            window.TowerDefense.startAttackDefense(opponent, PvpSystem.getBattleDeck());
        }
        return true;
    },

    /**
     * 结束当前回合
     * 第一回合结束后切换到第二回合；第二回合结束后结算
     * @param {number} aiScore 第一回合AI摧毁比例
     */
    endRound(aiScore) {
        if (this.round === 1) {
            this.aiAttackScore = aiScore || 0;
            this.round = 2;
            this.timeRemaining = this.timeLimit;
            // 阶段十一：回合切换由塔防引擎 _endPvpRound 延迟调用 startAttackDefenseRound2，
            // 此处不再直接调用以提供回合过渡时间
        } else {
            // 第二回合得分由 placeMonster/update 计算，通过 setPlayerAttackScore 设置
            this.endBattle();
        }
    },

    /**
     * 设置玩家进攻回合得分（第二回合结束时由塔防引擎调用）
     */
    setPlayerAttackScore(score) {
        this.playerAttackScore = score;
    },

    /**
     * 结束对战
     * 比较两回合得分，得分高者获胜，平分则平局
     */
    endBattle() {
        this.isActive = false;
        let result;
        if (this.playerAttackScore > this.aiAttackScore) {
            result = 'win';
        } else if (this.playerAttackScore < this.aiAttackScore) {
            result = 'lose';
        } else {
            result = 'draw';
        }
        const reward = result === 'win' ? PvpSystem.generateReward('attack-defense') : { coins: 0, inspiration: 0, scrolls: 0 };
        if (result === 'win') PvpSystem.grantReward(reward);
        PvpSystem.recordBattleResult('attack-defense', result, reward, this.opponent ? this.opponent.name : '');
        return { result, reward, playerScore: this.playerAttackScore, aiScore: this.aiAttackScore };
    }
};

// ============================================================
// 同步对战制（SyncBattleMode）
// ============================================================
const SyncBattleMode = {
    timeLimit: 300,
    timeRemaining: 300,
    playerMainLampHP: 0,
    aiMainLampHP: 0,
    playerTowers: [],
    aiTowers: [],
    centerMonsters: [],
    isActive: false,
    opponent: null,

    /**
     * 主灯HP计算：基础1000 + 繁荣度×0.5
     */
    calculateMainLampHP(prosperity) {
        return 1000 + Math.floor(prosperity * 0.5);
    },

    /**
     * 开始同步对战制
     */
    start(opponent) {
        if (!opponent) return false;
        if (!PvpSystem.consumeToken()) return false;
        this.opponent = opponent;
        this.isActive = true;
        this.timeRemaining = this.timeLimit;
        this.playerTowers = [];
        this.aiTowers = [];
        this.centerMonsters = [];
        const playerProsperity = PvpSystem.calculateProsperity();
        this.playerMainLampHP = this.calculateMainLampHP(playerProsperity);
        this.aiMainLampHP = this.calculateMainLampHP(opponent.prosperity);
        if (window.TowerDefense && typeof window.TowerDefense.startSyncBattle === 'function') {
            window.TowerDefense.startSyncBattle(opponent, PvpSystem.getBattleDeck(), {
                playerHP: this.playerMainLampHP,
                aiHP: this.aiMainLampHP
            });
        }
        return true;
    },

    /**
     * 结束对战
     * @param {string} reason 'playerDead'|'aiDead'|'timeout'
     */
    endBattle(reason) {
        this.isActive = false;
        let result;
        if (reason === 'playerDead') {
            result = 'lose';
        } else if (reason === 'aiDead') {
            result = 'win';
        } else {
            // timeout：比较剩余HP
            result = this.playerMainLampHP > this.aiMainLampHP ? 'win' :
                     (this.playerMainLampHP < this.aiMainLampHP ? 'lose' : 'draw');
        }
        const reward = result === 'win' ? PvpSystem.generateReward('sync-battle') : { coins: 0, inspiration: 0, scrolls: 0 };
        if (result === 'win') PvpSystem.grantReward(reward);
        PvpSystem.recordBattleResult('sync-battle', result, reward, this.opponent ? this.opponent.name : '');
        return { result, reward, playerHP: this.playerMainLampHP, aiHP: this.aiMainLampHP };
    }
};

// ============================================================
// 防守竞赛制（DefenseRaceMode）
// ============================================================
const DefenseRaceMode = {
    currentWave: 0,
    playerMainLampHP: 0,
    aiMainLampHP: 0,
    playerWavesSurvived: 0,
    aiWavesSurvived: 0,
    playerDefeated: false,
    aiDefeated: false,
    isActive: false,
    opponent: null,

    /**
     * 开始防守竞赛制（不消耗进攻令）
     */
    start(opponent) {
        if (!opponent) return false;
        // 不消耗进攻令
        this.opponent = opponent;
        this.isActive = true;
        this.currentWave = 0;
        this.playerWavesSurvived = 0;
        this.aiWavesSurvived = 0;
        this.playerDefeated = false;
        this.aiDefeated = false;
        const playerProsperity = PvpSystem.calculateProsperity();
        this.playerMainLampHP = 1000 + Math.floor(playerProsperity * 0.5);
        this.aiMainLampHP = 1000 + Math.floor(opponent.prosperity * 0.5);
        if (window.TowerDefense && typeof window.TowerDefense.startDefenseRace === 'function') {
            window.TowerDefense.startDefenseRace(opponent, PvpSystem.getBattleDeck(), {
                playerHP: this.playerMainLampHP,
                aiHP: this.aiMainLampHP
            });
        }
        return true;
    },

    /**
     * 结束竞赛
     * 比较坚持波次
     */
    endRace() {
        this.isActive = false;
        let result;
        if (this.playerWavesSurvived > this.aiWavesSurvived) {
            result = 'win';
        } else if (this.playerWavesSurvived < this.aiWavesSurvived) {
            result = 'lose';
        } else {
            result = 'draw';
        }
        let reward = { coins: 0, inspiration: 0, scrolls: 0 };
        if (result === 'win') {
            reward = PvpSystem.generateReward('defense-race');
            // 每多坚持5波额外奖励
            const extra = Math.floor((this.playerWavesSurvived - this.aiWavesSurvived) / 5);
            if (extra > 0) {
                reward.coins += extra * 100;
                reward.inspiration += extra * 10;
            }
            PvpSystem.grantReward(reward);
        }
        PvpSystem.recordBattleResult('defense-race', result, reward, this.opponent ? this.opponent.name : '');
        return { result, reward, playerWaves: this.playerWavesSurvived, aiWaves: this.aiWavesSurvived };
    }
};

// ============================================================
// 暴露全局对象
// ============================================================
window.AIPlayerSystem = AIPlayerSystem;
window.PvpSystem = PvpSystem;
window.AttackDefenseMode = AttackDefenseMode;
window.SyncBattleMode = SyncBattleMode;
window.DefenseRaceMode = DefenseRaceMode;
