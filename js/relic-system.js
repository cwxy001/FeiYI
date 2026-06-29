/*
 * relic-system.js - Roguelike 遗物系统（阶段七）
 * 功能：局内 Build 三选一遗物 + 通关永久收集遗物
 * 日期：2026-06-25
 *
 * 架构说明：
 *  - Relic 类：id/name/emoji/rarity/description/effect/stackable
 *  - RELIC_POOL：全局遗物池（runRelics 局内 15 个 + permanentRelics 永久 5 个）
 *  - RelicSystem 单例：抽取 / 应用 / 查询 / 重置
 *
 * 效果存储设计（关键）：
 *  - 遗物 effect 函数不直接修改塔属性，而是将效果标记写入 activeEffects 上下文
 *  - 按 heritageId（非遗工坊 id）分组，'all' 键为全局倍率（与具体塔倍率乘算）
 *  - tower-defense.js 在计算塔属性时查询 RelicSystem.getDamageMul(heritageId) 等
 *  - 局内遗物每关重置（resetRunRelics 清空 activeEffects），永久遗物每关重新应用
 *
 * 效果上限（applyRelic 写入时钳制 + 查询时再钳制，双重保险）：
 *  - 伤害/攻速倍率 ≤ 3.0，射程倍率 ≤ 2.0，暴击率 ≤ 100%
 *  - 多目标数 ≤ 5，抽卡消耗倍率 ≥ 0.2，合并阈值 ≥ 2
 *
 * 依赖：
 *  - index.html 需在 audio.js 之后引入本文件
 *  - 业务代码通过 window.RelicSystem 调用
 */

(function () {
    'use strict';

    // ===== 稀有度配置 =====
    const RARITY_WEIGHT = { common: 50, rare: 30, epic: 15, legendary: 5 };
    const RARITY_LABEL = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
    const RARITY_COLOR = {
        common: '#8B7355',
        rare: '#1E90FF',
        epic: '#9400D3',
        legendary: '#FFD700'
    };

    // ===== Relic 类 =====
    class Relic {
        constructor(opts) {
            this.id = opts.id;
            this.name = opts.name;
            this.emoji = opts.emoji;
            this.rarity = opts.rarity; // common / rare / epic / legendary
            this.description = opts.description;
            this.effect = opts.effect || function () {};
            this.stackable = opts.stackable || false;
            this.boundTowerId = opts.boundTowerId || null; // 绑定的塔种(heritageId)，null=全局遗物
        }
    }

    // ===== 遗物池 =====
    const RELIC_POOL = {
        // 一、局内增益遗物（每关三选一，仅当局有效）
        // 设计理念：每个遗物都融合非遗文化典故，效果与塔的攻击机制匹配
        runRelics: [
            new Relic({
                id: 'paper-cut-mastery', name: '剪纸·万剪同花', emoji: '✂️', rarity: 'common',
                description: '「千刻不落，万剪不断」剪纸塔伤害+30%，多目标数+1',
                boundTowerId: 'paper-cut',
                effect: (ctx) => {
                    ctx['tower-damage-multiplier']['paper-cut'] = 1.3;
                    ctx['tower-multi-target']['paper-cut'] = (ctx['tower-multi-target']['paper-cut'] || 0) + 1;
                }
            }),
            new Relic({
                id: 'shadow-control', name: '皮影·影随形动', emoji: '🎭', rarity: 'common',
                description: '「一口叙说千古事，双手对舞百万兵」皮影塔攻速+50%',
                boundTowerId: 'shadow-play',
                effect: (ctx) => { ctx['tower-attack-speed-multiplier']['shadow-play'] = 1.5; }
            }),
            new Relic({
                id: 'golden-thread', name: '刺绣·金线穿云', emoji: '🧵', rarity: 'common',
                description: '「劈丝如发，绣花如生」刺绣塔射程+30%，穿透伤害+20%',
                boundTowerId: 'embroidery',
                effect: (ctx) => { ctx['tower-range-multiplier']['embroidery'] = 1.3; }
            }),
            new Relic({
                id: 'kiln-temper', name: '陶瓷·窑变天成', emoji: '🏺', rarity: 'rare',
                description: '「入窑一色，出窑万彩」陶瓷塔溅射范围+50%',
                boundTowerId: 'ceramics',
                effect: (ctx) => { ctx['tower-splash-multiplier']['ceramics'] = 1.5; }
            }),
            new Relic({
                id: 'lion-fury', name: '舞狮·醒狮怒目', emoji: '🦁', rarity: 'rare',
                description:'「瑞狮怒吼，邪祟退散」舞狮塔伤害+50%，溅射范围+30%',
                boundTowerId: 'lion-dance',
                effect: (ctx) => {
                    ctx['tower-damage-multiplier']['lion-dance'] = 1.5;
                    ctx['tower-splash-multiplier']['lion-dance'] = 1.3;
                }
            }),
            new Relic({
                id: 'face-master', name: '京剧·变脸惊魂', emoji: '🎪', rarity: 'rare',
                description: '「台下十年功，台上一分钟」京剧塔暴击率+25%',
                boundTowerId: 'peking-opera',
                effect: (ctx) => { ctx['tower-crit-rate']['peking-opera'] = 0.25; }
            }),
            new Relic({
                id: 'vajra-body', name: '武术·金刚之力', emoji: '🥋', rarity: 'rare',
                description: '「天下武功，唯快不破」武术塔伤害+40%，暴击率+15%',
                boundTowerId: 'martial-arts',
                effect: (ctx) => {
                    ctx['tower-damage-multiplier']['martial-arts'] = 1.4;
                    ctx['tower-crit-rate']['martial-arts'] = 0.15;
                }
            }),
            new Relic({
                id: 'zen-tea', name: '茶艺·禅茶一味', emoji: '🍵', rarity: 'rare',
                description: '「茶禅一味，心境如水」茶艺塔减速效果+50%',
                boundTowerId: 'tea-art',
                effect: (ctx) => { ctx['tower-slow-multiplier']['tea-art'] = 1.5; }
            }),
            new Relic({
                id: 'ink-formation', name: '文房·泼墨成阵', emoji: '🖌️', rarity: 'epic',
                description: '「笔走龙蛇，墨染山河」文房塔多攻击1个目标，无视护盾',
                boundTowerId: 'four-treasures',
                effect: (ctx) => { ctx['tower-multi-target']['four-treasures'] = 1; }
            }),
            new Relic({
                id: 'feast-bounty', name: '美食·八方珍馐', emoji: '🍜', rarity: 'epic',
                description: '「民以食为天，食以味为先」美食塔多目标数+2',
                boundTowerId: 'cuisine',
                effect: (ctx) => { ctx['tower-multi-target']['cuisine'] = (ctx['tower-multi-target']['cuisine'] || 0) + 2; }
            }),
            new Relic({
                id: 'healing-hands', name: '中医·悬壶济世', emoji: '🌿', rarity: 'epic',
                description: '「悬壶济世，妙手回春」中医塔毒素DPS+100%',
                boundTowerId: 'tcm',
                effect: (ctx) => { ctx['tower-poison-on-hit']['tcm'] = true; }
            }),
            new Relic({
                id: 'all-in-one', name: '非遗·万法归一', emoji: '🌟', rarity: 'legendary',
                description: '「万法归一，大道至简」所有塔伤害+20%，攻速+15%',
                effect: (ctx) => {
                    ctx['tower-damage-multiplier']['all'] = 1.2;
                    ctx['tower-attack-speed-multiplier']['all'] = 1.15;
                }
            }),
            new Relic({
                id: 'popularity-surge', name: '庙会·人声鼎沸', emoji: '📈', rarity: 'common',
                description: '「庙会繁华，万民同乐」击杀敌人人气+50%',
                effect: (ctx) => { ctx['popularity-kill-bonus'] = 1.5; }
            }),
            new Relic({
                id: 'quick-draw', name: '书法·行云流水', emoji: '⚡', rarity: 'rare',
                description: '「行云流水，一气呵成」抽卡人气消耗-30%',
                effect: (ctx) => { ctx['draw-cost-multiplier'] = 0.7; }
            }),
            new Relic({
                id: 'merge-master', name: '匠心·三合之道', emoji: '🔀', rarity: 'epic',
                description: '「精益求精，三合为一」手牌自动合并阈值降为2张',
                effect: (ctx) => { ctx['merge-threshold'] = 2; }
            }),
            // 新增：与非遗文化直接相关的全局遗物
            new Relic({
                id: 'silk-road', name: '丝路·驼铃远播', emoji: '🐪', rarity: 'epic',
                description: '「丝路万里，驼铃叮当」所有塔射程+20%',
                effect: (ctx) => { ctx['tower-range-multiplier']['all'] = 1.2; }
            }),
            new Relic({
                id: 'ancestor-blessing', name: '先祖·庇佑之光', emoji: '🏮', rarity: 'legendary',
                description: '「列祖列宗，庇佑子孙」所有塔暴击率+15%，主灯血量+30%',
                effect: (ctx) => {
                    ctx['tower-crit-rate']['all'] = 0.15;
                    ctx['lamp-hp-bonus'] = 1.3;
                }
            })
        ],

        // 二、永久遗物（通关后获得，永久保留，跨局跨关生效）
        permanentRelics: [
            new Relic({
                id: 'heirloom-pendant', name: '传承玉佩', emoji: '📿', rarity: 'rare',
                description: '初始多1张手牌',
                effect: (ctx) => { ctx['extra-starting-hand'] = 1; }
            }),
            new Relic({
                id: 'popularity-gourd', name: '人气葫芦', emoji: '🎋', rarity: 'rare',
                description: '初始人气+50',
                effect: (ctx) => { ctx['starting-popularity-bonus'] = 50; }
            }),
            new Relic({
                id: 'building-atlas', name: '建造图谱', emoji: '📜', rarity: 'rare',
                description: '初始铜钱+500',
                effect: (ctx) => { ctx['starting-coins-bonus'] = 500; }
            }),
            new Relic({
                id: 'time-hourglass', name: '时光沙漏', emoji: '⏳', rarity: 'epic',
                description: '准备时间+5秒',
                effect: (ctx) => { ctx['prep-time-bonus'] = 5; }
            }),
            new Relic({
                id: 'lucky-charm', name: '幸运护符', emoji: '🍀', rarity: 'legendary',
                description: '遗物三选一变为四选一',
                // 不写 effect：rollRunRelics 时通过 GameState.hasRelic('lucky-charm') 检查
                effect: () => {}
            })
        ]
    };

    // ===== RelicSystem 单例 =====
    const RelicSystem = {
        // 当前局内生效的遗物列表
        activeRunRelics: [],
        // 效果上下文（按 heritageId 分组，'all' 为全局倍率）
        activeEffects: {},
        // getActiveRelics 结果缓存（遗物列表变化时置 null）
        _effectsCache: null,

        /**
         * 初始化 activeEffects 结构（按塔分组的子对象预创建）
         */
        _initEffects() {
            return {
                'tower-damage-multiplier': {},
                'tower-attack-speed-multiplier': {},
                'tower-range-multiplier': {},
                'tower-splash-multiplier': {},
                'tower-hp-multiplier': {},
                'tower-crit-rate': {},
                'tower-slow-multiplier': {},
                'tower-multi-target': {},
                'tower-heal-multiplier': {},
                'tower-poison-on-hit': {}
            };
        },

        /**
         * 从局内遗物池随机抽取 count 个不重复遗物（按稀有度权重）
         * 拥有 lucky-charm 永久遗物时 count 自动 +1
         * 修复：过滤掉未建造工坊对应的塔种遗物
         */
        rollRunRelics(count = 3) {
            if (window.GameState && window.GameState.hasRelic('lucky-charm')) {
                count += 1;
            }
            // 修复：获取已建造工坊列表，过滤绑定遗物
            const available = (window.DataIntegration && window.DataIntegration.getAvailableTowers)
                ? window.DataIntegration.getAvailableTowers()
                : (window.GameState && window.GameState.workshops
                    ? window.GameState.workshops.map(ws => ws.id)
                    : []);
            let pool = RELIC_POOL.runRelics.filter(r => {
                if (!r.boundTowerId) return true; // 全局遗物始终保留
                return available.includes(r.boundTowerId); // 绑定塔须已建造
            });
            // 兜底：过滤后不足时回退全量池，避免无遗物可选
            if (pool.length < count) pool = RELIC_POOL.runRelics.slice();

            const result = [];
            while (result.length < count && pool.length > 0) {
                let total = 0;
                for (const r of pool) total += (RARITY_WEIGHT[r.rarity] || 0);
                if (total <= 0) break;
                let rnd = Math.random() * total;
                let idx = 0;
                for (let i = 0; i < pool.length; i++) {
                    rnd -= (RARITY_WEIGHT[pool[i].rarity] || 0);
                    if (rnd <= 0) { idx = i; break; }
                }
                result.push(pool.splice(idx, 1)[0]);
            }
            return result;
        },

        /**
         * 从永久遗物池随机抽取 1 个尚未拥有的遗物
         * 全部已拥有则返回 null
         */
        rollPermanentRelic() {
            const available = RELIC_POOL.permanentRelics.filter(r => {
                return !(window.GameState && window.GameState.hasRelic(r.id));
            });
            if (available.length === 0) return null;
            return available[Math.floor(Math.random() * available.length)];
        },

        /**
         * 应用遗物效果
         * @param {string} relicId - 遗物 id
         * @param {boolean} isPermanent - 是否永久遗物
         * @returns {boolean} 是否应用成功（重复获取返回 false）
         */
        applyRelic(relicId, isPermanent) {
            const relic = this.getRelicById(relicId);
            if (!relic) {
                console.warn('[RelicSystem] 遗物不存在:', relicId);
                return false;
            }

            if (isPermanent) {
                // 永久遗物：去重检查（applyRelic 再次检查，避免重复添加）
                if (window.GameState && window.GameState.hasRelic(relicId)) {
                    this._toast('已拥有该遗物');
                    return false;
                }
                if (window.GameState) window.GameState.addPermanentRelic(relicId);
                this._applyEffect(relic);
            } else {
                // 局内遗物：不可叠加时去重
                if (!relic.stackable && this.activeRunRelics.some(r => r.id === relicId)) {
                    this._toast('已拥有该遗物');
                    return false;
                }
                this.activeRunRelics.push(relic);
                this._applyEffect(relic);
            }
            this._effectsCache = null; // 失效缓存
            return true;
        },

        /**
         * 调用遗物 effect 函数写入 activeEffects，并钳制效果上限
         */
        _applyEffect(relic) {
            try {
                relic.effect(this.activeEffects);
            } catch (e) {
                console.error('[RelicSystem] 应用遗物效果失败:', relic.id, e);
            }
            this._clampEffects();
        },

        /**
         * 钳制单遗物效果上限（超出部分截断）
         */
        _clampEffects() {
            const e = this.activeEffects;
            const clampGroup = (key, max) => {
                if (!e[key]) return;
                for (const k in e[key]) {
                    if (e[key][k] > max) e[key][k] = max;
                }
            };
            clampGroup('tower-damage-multiplier', 3.0);
            clampGroup('tower-attack-speed-multiplier', 3.0);
            clampGroup('tower-range-multiplier', 2.0);
            clampGroup('tower-splash-multiplier', 5.0);
            clampGroup('tower-hp-multiplier', 5.0);
            clampGroup('tower-crit-rate', 1.0);
            clampGroup('tower-multi-target', 5);
            // 抽卡消耗倍率下限 0.2（不低于原值 20%）
            if (typeof e['draw-cost-multiplier'] === 'number' && e['draw-cost-multiplier'] < 0.2) {
                e['draw-cost-multiplier'] = 0.2;
            }
            // 合并阈值下限 2
            if (typeof e['merge-threshold'] === 'number' && e['merge-threshold'] < 2) {
                e['merge-threshold'] = 2;
            }
        },

        /**
         * 获取当前生效的所有遗物列表（局内 + 永久），带缓存
         */
        getActiveRelics() {
            if (this._effectsCache) return this._effectsCache;
            const list = [];
            this.activeRunRelics.forEach(r => list.push(r));
            const permanent = (window.GameState && window.GameState.permanentRelics) || [];
            permanent.forEach(id => {
                const r = this.getRelicById(id);
                if (r) list.push(r);
            });
            this._effectsCache = list;
            return list;
        },

        /**
         * 获取当前局内遗物列表
         */
        getActiveRunRelics() {
            return this.activeRunRelics.slice();
        },

        /**
         * 清空当前局内遗物（关卡结束/失败/退出时调用）
         * 永久遗物不受影响；activeEffects 一并清空，由 startLevel 重新应用永久遗物
         */
        resetRunRelics() {
            this.activeRunRelics = [];
            this.activeEffects = this._initEffects();
            this._effectsCache = null;
        },

        /**
         * 重新应用所有已拥有永久遗物的效果（每关 startLevel 时调用）
         */
        reapplyPermanentRelics() {
            const permanent = (window.GameState && window.GameState.permanentRelics) || [];
            permanent.forEach(id => {
                const r = this.getRelicById(id);
                if (r) this._applyEffect(r);
            });
            this._effectsCache = null;
        },

        /**
         * 根据 id 从 RELIC_POOL 查找遗物
         */
        getRelicById(relicId) {
            return RELIC_POOL.runRelics.find(r => r.id === relicId) ||
                   RELIC_POOL.permanentRelics.find(r => r.id === relicId) ||
                   null;
        },

        /**
         * 查询某遗物是否生效，生效返回 true，否则返回 defaultValue
         */
        getRelicEffectValue(relicId, defaultValue) {
            const active = this.getActiveRelics();
            if (active.some(r => r.id === relicId)) return true;
            return defaultValue;
        },

        // ===== 效果查询函数（供 tower-defense.js 调用）=====

        /** 伤害倍率（'all' 全局倍率与具体塔倍率乘算，上限 3.0） */
        getDamageMul(heritageId) {
            const m = this.activeEffects['tower-damage-multiplier'] || {};
            let mul = 1;
            if (m['all']) mul *= m['all'];
            if (m[heritageId]) mul *= m[heritageId];
            return Math.min(mul, 3.0);
        },
        /** 攻速倍率（上限 3.0） */
        getAttackSpeedMul(heritageId) {
            const m = this.activeEffects['tower-attack-speed-multiplier'] || {};
            let mul = 1;
            if (m['all']) mul *= m['all'];
            if (m[heritageId]) mul *= m[heritageId];
            return Math.min(mul, 3.0);
        },
        /** 射程倍率（上限 2.0） */
        getRangeMul(heritageId) {
            const m = this.activeEffects['tower-range-multiplier'] || {};
            let mul = 1;
            if (m['all']) mul *= m['all'];
            if (m[heritageId]) mul *= m[heritageId];
            return Math.min(mul, 2.0);
        },
        /** 暴击率增加值（上限 100%） */
        getCritRate(heritageId) {
            const m = this.activeEffects['tower-crit-rate'] || {};
            let rate = m[heritageId] || 0;
            if (m['all']) rate += m['all'];
            return Math.min(rate, 1.0);
        },
        /** 溅射范围倍率 */
        getSplashMul(heritageId) {
            const m = this.activeEffects['tower-splash-multiplier'] || {};
            return m[heritageId] || 1;
        },
        /** 塔血量倍率 */
        getHpMul(heritageId) {
            const m = this.activeEffects['tower-hp-multiplier'] || {};
            return m[heritageId] || 1;
        },
        /** 减速效果倍率（最终减速值由调用方钳制 ≤ 90%） */
        getSlowMul(heritageId) {
            const m = this.activeEffects['tower-slow-multiplier'] || {};
            return m[heritageId] || 1;
        },
        /** 额外攻击目标数（上限 5） */
        getMultiTarget(heritageId) {
            const m = this.activeEffects['tower-multi-target'] || {};
            return Math.min(m[heritageId] || 0, 5);
        },
        /** 治疗量倍率 */
        getHealMul(heritageId) {
            const m = this.activeEffects['tower-heal-multiplier'] || {};
            return m[heritageId] || 1;
        },
        /** 攻击是否附带中毒 */
        hasPoisonOnHit(heritageId) {
            const m = this.activeEffects['tower-poison-on-hit'] || {};
            return !!m[heritageId];
        },
        /** 击杀人气加成倍率 */
        getPopularityBonus() {
            return this.activeEffects['popularity-kill-bonus'] || 1;
        },
        /** 抽卡人气消耗倍率（下限 0.2） */
        getDrawCostMul() {
            return Math.max(this.activeEffects['draw-cost-multiplier'] || 1, 0.2);
        },
        /** 手牌自动合并阈值（下限 2，默认 3） */
        getMergeThreshold() {
            return Math.max(this.activeEffects['merge-threshold'] || 3, 2);
        },
        /** 初始额外手牌数 */
        getExtraStartingHand() {
            return this.activeEffects['extra-starting-hand'] || 0;
        },
        /** 初始人气加成 */
        getStartingPopularityBonus() {
            return this.activeEffects['starting-popularity-bonus'] || 0;
        },
        /** 初始铜钱加成 */
        getStartingCoinsBonus() {
            return this.activeEffects['starting-coins-bonus'] || 0;
        },
        /** 准备时间加成（秒） */
        getPrepTimeBonus() {
            return this.activeEffects['prep-time-bonus'] || 0;
        },
        /** 是否拥有某永久遗物（便捷查询） */
        hasRelic(relicId) {
            return !!(window.GameState && window.GameState.hasRelic(relicId));
        },

        /**
         * 简易 toast 提示（复用项目现有 toast，降级 console）
         */
        _toast(msg) {
            if (window.TowerDefense && window.TowerDefense._toast) {
                window.TowerDefense._toast(msg, 'info');
            } else if (window.UI && window.UI.toast) {
                window.UI.toast(msg);
            } else {
                console.log('[RelicSystem]', msg);
            }
        }
    };

    // 初始化 activeEffects 结构
    RelicSystem.activeEffects = RelicSystem._initEffects();

    // ===== 暴露全局 =====
    window.Relic = Relic;
    window.RELIC_POOL = RELIC_POOL;
    window.RARITY_LABEL = RARITY_LABEL;
    window.RARITY_COLOR = RARITY_COLOR;
    window.RelicSystem = RelicSystem;
})();
