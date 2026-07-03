/*
 * tower-defense.js - 塔防战斗系统（阶段三）
 * 功能：关卡选择、卡牌系统、防御塔、敌人、12 生肖 BOSS、战斗主控、结算
 * 版本：v1.1.0
 * 日期：2026-06-24
 * 更新：渐进式关卡难度（_buildWaves 重构，HP 倍率与每波敌人数按关配置）
 *
 * 关键 Bug 规避：
 *  1. Enemy 统一使用 hp 字段（不是 health）
 *  2. Tower.findTarget() 使用小于号比较距离
 *  3. exit() 取消 TowerDefense 实例上的 gameLoopId
 *  4. popularityPerCard 在 CardSystem 构造函数中初始化
 *  5. currentLevelId 在 TowerDefense 类中声明
 *  6. 奖励只通过 DataIntegration.onLevelVictory 发放，不重复
 *  7. startLevel 接入真实战斗循环（requestAnimationFrame）
 *  8. 不包含 EffectSystem（阶段五统一使用 effects-engine.js）
 */

(function () {
    'use strict';

    // ===== 常量 =====
    const GRID_COLS = 16;
    const GRID_ROWS = 10;
    const CELL = 60;
    const CANVAS_W = GRID_COLS * CELL;   // 960
    const CANVAS_H = GRID_ROWS * CELL;   // 600
    const MAX_HAND = 8;
    const MAX_TOWER_LEVEL = 5;
    const MERGE_THRESHOLD = 3; // 三张同名合并
    const INIT_LIVES = 30;

    // 30 关差异化路径（waypoints 为 [col,row]，相邻点共享行或列）
    // key 为关卡 index（1-30），兼容旧 12 关路径并新增 13-30
    const LEVEL_PATHS = {
        // ===== 子时（index 1-3）=====
        1:  [[0, 5], [15, 5]],                                                          // straight
        2:  [[0, 2], [9, 2], [9, 8], [15, 8]],                                          // L-shape
        3:  [[0, 1], [13, 1], [13, 4], [2, 4], [2, 7], [15, 7]],                        // S-shape
        // ===== 丑时（index 4-6）=====
        4:  [[0, 4], [15, 4]],                                                          // straight
        5:  [[0, 1], [3, 1], [3, 4], [6, 4], [6, 7], [9, 7], [9, 3], [12, 3], [12, 8], [15, 8]],  // zigzag
        6:  { lanes: [                                                                  // fork（双入口汇合）
            [[0, 2], [7, 2], [7, 5], [15, 5]],
            [[0, 8], [7, 8], [7, 5], [15, 5]]
        ]},
        // ===== 寅时（index 7-9）=====
        7:  [[0, 8], [10, 8], [10, 2], [15, 2]],                                        // L-shape
        8:  [[0, 1], [13, 1], [13, 4], [2, 4], [2, 7], [15, 7]],                        // S-shape
        9:  [[0, 5], [3, 5], [3, 2], [11, 2], [11, 7], [3, 7], [3, 5], [12, 5], [12, 3], [15, 3]],  // spiral
        // ===== 卯时（index 10-12）=====
        10: [[0, 5], [15, 5]],                                                          // straight
        11: { lanes: [                                                                  // fork
            [[0, 2], [10, 2], [10, 5], [15, 5]],
            [[0, 8], [10, 8], [10, 5], [15, 5]]
        ]},
        12: { lanes: [                                                                  // dual（双路径不汇合）
            [[0, 2], [15, 2], [15, 4]],
            [[0, 8], [15, 8], [15, 6]]
        ]},
        // ===== 辰时（index 13-15）=====
        13: [[0, 8], [4, 8], [4, 3], [10, 3], [10, 8], [14, 8], [14, 2], [15, 2]],     // L-shape
        14: [[0, 5], [3, 5], [3, 2], [11, 2], [11, 7], [3, 7], [3, 5], [12, 5], [15, 5]],  // ring
        15: [[0, 5], [3, 5], [3, 2], [11, 2], [11, 7], [3, 7], [3, 5], [8, 5], [8, 3], [13, 3], [13, 7], [15, 7]],  // spiral
        // ===== 巳时（index 16-18）=====
        16: [[0, 1], [13, 1], [13, 4], [2, 4], [2, 7], [15, 7]],                       // S-shape
        17: { lanes: [                                                                  // dual
            [[0, 1], [13, 1], [13, 4], [15, 4]],
            [[0, 9], [13, 9], [13, 6], [15, 6]]
        ]},
        18: [[0, 1], [2, 1], [2, 4], [5, 4], [5, 1], [8, 1], [8, 4], [11, 4], [11, 1], [13, 1], [13, 8], [5, 8], [5, 6], [15, 6]],  // maze
        // ===== 午时（index 19-21）=====
        19: [[0, 5], [15, 5]],                                                          // straight
        20: [[0, 1], [3, 1], [3, 4], [6, 4], [6, 7], [9, 7], [9, 3], [12, 3], [12, 8], [15, 8]],  // zigzag
        21: [[0, 5], [3, 5], [3, 2], [11, 2], [11, 7], [3, 7], [3, 5], [8, 5], [8, 3], [13, 3], [13, 7], [15, 7]],  // spiral
        // ===== 未时（index 22-24）=====
        22: [[0, 8], [10, 8], [10, 2], [15, 2]],                                        // L-shape
        23: { lanes: [                                                                  // fork
            [[0, 2], [10, 2], [10, 5], [15, 5]],
            [[0, 8], [10, 8], [10, 5], [15, 5]]
        ]},
        24: [[0, 1], [3, 1], [3, 4], [6, 4], [6, 7], [9, 7], [9, 3], [12, 3], [12, 8], [15, 8]],  // zigzag
        // ===== 申时（index 25-27）=====
        25: [[0, 1], [13, 1], [13, 4], [2, 4], [2, 7], [15, 7]],                        // S-shape
        26: [[0, 1], [15, 1], [15, 3], [0, 3], [0, 5], [15, 5], [15, 7], [0, 7], [0, 9], [15, 9]],  // grid
        27: [[0, 1], [2, 1], [2, 4], [5, 4], [5, 1], [8, 1], [8, 4], [11, 4], [11, 1], [13, 1], [13, 8], [5, 8], [5, 6], [15, 6]],  // maze
        // ===== 酉时（index 28-29）=====
        28: [[0, 5], [3, 5], [3, 2], [11, 2], [11, 7], [3, 7], [3, 5], [12, 5], [15, 5]],  // ring
        29: [[0, 0], [15, 0], [15, 5], [0, 5], [0, 9], [15, 9]],                        // fullmap
        // ===== 亥时·末（index 30，终极全图）=====
        30: [[0, 0], [15, 0], [15, 2], [0, 2], [0, 4], [15, 4], [15, 6], [0, 6], [0, 8], [15, 8], [15, 5], [7, 5], [7, 9], [15, 9]]  // fullmap（终极）
    };

    const BOSS_EMOJI = {
        'boss-rat': '🐭', 'boss-ox': '🐂', 'boss-tiger': '🐯', 'boss-rabbit': '🐰',
        'boss-dragon': '🐲', 'boss-snake': '🐍', 'boss-horse': '🐴', 'boss-sheep': '🐑',
        'boss-monkey': '🐵', 'boss-rooster': '🐔', 'boss-dog': '🐶', 'boss-pig': '🐷'
    };
    const NORMAL_EMOJI = '👤';
    const ELITE_EMOJI = '👹';

    // 阶段六：enemy-hit 音效节流（避免高频打击刷屏）
    let _lastHitSoundTime = 0;
    const HIT_SOUND_INTERVAL = 0.08; // 80ms 内最多播放一次

    function ichData(id) {
        return ((window.GameData && window.GameData.ICH_LIST) || []).find(i => i.id === id);
    }
    function enemyDataById(id) {
        const ed = window.GameData && window.GameData.ENEMY_DATA;
        if (!ed) return null;
        return [].concat(ed.normal || [], ed.elite || [], ed.boss || []).find(e => e.id === id);
    }
    function levelData(id) {
        // 阶段九：id 可为数字 index（1-30）或字符串 'level-x-y'，统一查询
        const list = (window.GameData && window.GameData.LEVELS) || [];
        if (typeof id === 'number') return list.find(l => l.index === id);
        return list.find(l => l.id === id);
    }
    function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    // ===== 卡牌系统 =====
    class CardSystem {
        constructor() {
            this.deck = [];
            this.hand = [];
            this.discard = [];
            this.popularity = 0;
            this.popularityPerCard = 50;
            this.maxPopularity = 999;
            this._buildDeck();
        }

        _buildDeck() {
            let ids = (window.DataIntegration && window.DataIntegration.getAvailableTowers)
                ? window.DataIntegration.getAvailableTowers() : [];
            // 阶段九：特殊关卡塔种限制（过滤后为空则用原池兜底，避免无法抽卡）
            const td = window.TowerDefense;
            if (td && td.specialMode && td.specialMode.running && td.specialMode.id === 'tower-restriction') {
                const filtered = ids.filter(id => td._isCardAllowedBySpecial(id));
                if (filtered.length > 0) ids = filtered;
            }
            const deck = [];
            ids.forEach(id => {
                const ich = ichData(id);
                if (!ich) return;
                for (let k = 0; k < 4; k++) {
                    deck.push({
                        heritageId: id,
                        name: ich.name,
                        emoji: ich.emoji,
                        towerType: ich.towerType,
                        damage: ich.towerDamage,
                        range: ich.towerRange,
                        attackSpeed: ich.towerAttackSpeed,
                        skill: ich.skill,
                        // 阶段重构：特殊攻击属性
                        splash: ich.splash || 0,
                        slowFactor: ich.slowFactor || 0,
                        slowDuration: ich.slowDuration || 0,
                        multiTarget: ich.multiTarget || 1,
                        poisonDps: ich.poisonDps || 0,
                        pierce: ich.pierce || false,
                        critRate: ich.critRate || 0,
                        ignoreShield: ich.ignoreShield || false
                    });
                }
            });
            this._shuffle(deck);
            this.deck = deck;
        }

        _shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
        }

        drawCard() {
            if (this.hand.length >= MAX_HAND) return null;
            if (this.deck.length === 0) {
                if (this.discard.length > 0) {
                    this.deck = this.discard.slice();
                    this.discard = [];
                    this._shuffle(this.deck);
                } else {
                    this._buildDeck();
                }
            }
            if (this.deck.length === 0) return null;
            const card = this.deck.pop();
            this.hand.push(card);
            // 自动合并：三张同名卡合并为一张升级卡
            this._autoMerge();
            return card;
        }

        /** 抽卡但不自动合并（用于初始手牌） */
        drawCardWithoutMerge() {
            if (this.hand.length >= MAX_HAND) return null;
            if (this.deck.length === 0) {
                if (this.discard.length > 0) {
                    this.deck = this.discard.slice();
                    this.discard = [];
                    this._shuffle(this.deck);
                } else {
                    this._buildDeck();
                }
            }
            if (this.deck.length === 0) return null;
            const card = this.deck.pop();
            this.hand.push(card);
            return card;
        }

        /**
         * 自动合并：三张同名卡合并为一张，等级+1（最多合并一次，即最高Lv+1）
         */
        _autoMerge() {
            const TH = window.RelicSystem ? RelicSystem.getMergeThreshold() : MERGE_THRESHOLD;
            const groups = {};
            this.hand.forEach((card, idx) => {
                const key = card.heritageId;
                if (!groups[key]) groups[key] = [];
                groups[key].push(idx);
            });

            for (const key in groups) {
                const indices = groups[key];
                if (indices.length >= TH) {
                    // 取前 TH 张合并
                    const mergeIdx = indices.slice(0, TH);
                    // 从大到小排序，方便删除
                    mergeIdx.sort((a, b) => b - a);
                    // 保留第一张（等级最低的索引），删除其他两张
                    const keepIdx = mergeIdx[mergeIdx.length - 1];
                    const mergedCard = this.hand[keepIdx];
                    // 标记合并等级（最多+1）
                    mergedCard.mergeLevel = 2;
                    // 删除其他 (TH-1) 张
                    for (let i = 0; i < TH - 1; i++) {
                        this.hand.splice(mergeIdx[i], 1);
                    }
                    if (window.TowerDefense) {
                        window.TowerDefense._toast(`三张「${mergedCard.name}」合并！放置时等级+1`, 'success');
                        window.TowerDefense._renderHand();
                    }
                    // 阶段十：留存系统——三合一上报 + 累计统计 + 成就检查
                    if (window.DailyTasks) {
                        try { DailyTasks.updateProgress('merge-cards', 1); } catch (e) { /* ignore */ }
                    }
                    if (window.GameState && typeof window.GameState.addTotalMergeCount === 'function') {
                        try { window.GameState.addTotalMergeCount(); } catch (e) { /* ignore */ }
                    }
                    if (window.Achievements) {
                        try { Achievements.checkAll(); } catch (e) { /* ignore */ }
                    }
                    // 只合并一次，不递归
                    return;
                }
            }
        }

        playCard(index) {
            if (index < 0 || index >= this.hand.length) return null;
            return this.hand.splice(index, 1)[0];
        }

        addToDiscard(card) { if (card) this.discard.push(card); }

        addPopularity(amount) {
            this.popularity = Math.min(this.maxPopularity, this.popularity + amount);
            if (window.TowerDefense) window.TowerDefense._updatePopularityUI();
        }

        /** 手动抽卡：消耗人气值抽一张牌 */
        manualDraw() {
            const cost = this.popularityPerCard * (window.RelicSystem ? RelicSystem.getDrawCostMul() : 1);
            if (this.popularity < cost) return null;
            if (this.hand.length >= MAX_HAND) return null;
            this.popularity -= cost;
            const card = this.drawCard();
            if (window.TowerDefense) window.TowerDefense._updatePopularityUI();
            // 阶段十：留存系统——抽卡上报
            if (card && window.DailyTasks) {
                try { DailyTasks.updateProgress('draw-cards', 1); } catch (e) { /* ignore */ }
            }
            return card;
        }
    }

    // ===== 防御塔 =====
    class Tower {
        constructor(card, gridX, gridY, baseLevel) {
            this.heritageId = card.heritageId;
            this.card = card;
            this.gridX = gridX;
            this.gridY = gridY;
            this.x = gridX * CELL + CELL / 2;
            this.y = gridY * CELL + CELL / 2;
            this.level = Math.max(1, Math.min(MAX_TOWER_LEVEL, baseLevel || 1));
            this.baseDamage = card.damage;
            this.baseRange = card.range;
            this._baseAttackSpeed = card.attackSpeed;  // 基础攻速，getter 按等级成长
            this.lastAttackTime = 0;
            this.target = null;
            this.stunnedUntil = 0;
            this.emoji = card.emoji;
            this.name = card.name;
            this.skill = card.skill;
            this.towerType = card.towerType;
            // === 阶段重构：特殊攻击属性（从 card 读取，缺省为无） ===
            this.splash = card.splash || 0;           // 溅射半径（像素）
            this.slowFactor = card.slowFactor || 0;    // 减速比例（0-1）
            this.slowDuration = card.slowDuration || 0;// 减速持续（秒）
            this.multiTarget = card.multiTarget || 1;  // 多目标数
            this.poisonDps = card.poisonDps || 0;      // 自带中毒 DPS
            this.pierce = card.pierce || false;        // 穿透攻击
            this.baseCritRate = card.critRate || 0;    // 自带暴击率
            this.ignoreShield = card.ignoreShield || false; // 无视护盾
        }

        get damage() {
            let m = Math.pow(1.35, this.level - 1);  // 增强：1.2→1.35，满级3.32x
            if (window.RelicSystem) m *= RelicSystem.getDamageMul(this.heritageId);
            return Math.round(this.baseDamage * m);
        }
        get range() {
            let m = Math.pow(1.15, this.level - 1);  // 增强：1.1→1.15，满级1.75x
            if (window.RelicSystem) m *= RelicSystem.getRangeMul(this.heritageId);
            return this.baseRange * m;
        }
        get attackSpeed() {
            let m = Math.pow(1.1, this.level - 1);   // 新增：攻速成长，满级1.46x
            return this._baseAttackSpeed * m;
        }
        get critRate() {
            let r = this.baseCritRate;
            if (window.RelicSystem) r += RelicSystem.getCritRate(this.heritageId);
            return Math.min(1.0, r);
        }

        upgrade() {
            if (this.level >= MAX_TOWER_LEVEL) return false;
            this.level++;
            return true;
        }

        findTarget(enemies) {
            let best = null;
            let bestDist = Infinity;
            const range = this.range;
            for (const e of enemies) {
                if (!e.alive || e.invisible) continue;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d <= range && d < bestDist) {
                    bestDist = d;
                    best = e;
                }
            }
            return best;
        }

        /**
         * 找范围内最近的 N 个目标（多目标攻击用）
         */
        findTargets(enemies, count) {
            const valid = [];
            const range = this.range;
            for (const e of enemies) {
                if (!e.alive || e.invisible) continue;
                const dx = e.x - this.x;
                const dy = e.y - this.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d <= range) valid.push({ enemy: e, dist: d });
            }
            valid.sort((a, b) => a.dist - b.dist);
            return valid.slice(0, count).map(v => v.enemy);
        }

        attack(currentTime, enemies, speedMul) {
            if (currentTime < this.stunnedUntil) return null;
            // 多目标塔：重新选择目标列表
            const effectiveMulti = this.multiTarget + (window.RelicSystem ? RelicSystem.getMultiTarget(this.heritageId) : 0);
            if (effectiveMulti > 1) {
                this.target = this.findTargets(enemies, effectiveMulti)[0];
            } else {
                if (!this.target || !this.target.alive || this.target.invisible) {
                    this.target = this.findTarget(enemies);
                } else {
                    const d = Math.sqrt((this.target.x - this.x) ** 2 + (this.target.y - this.y) ** 2);
                    if (d > this.range) this.target = this.findTarget(enemies);
                }
            }
            if (!this.target) return null;
            // 攻速受倍速影响 + 遗物攻速倍率
            const relicAS = window.RelicSystem ? RelicSystem.getAttackSpeedMul(this.heritageId) : 1;
            const effectiveSpeed = this.attackSpeed * (speedMul || 1) * relicAS;
            const interval = 1000 / effectiveSpeed;
            if (currentTime - this.lastAttackTime >= interval) {
                this.lastAttackTime = currentTime;
                let dmg = this.damage;
                // 暴击（自带 + 遗物）
                if (this.critRate > 0 && Math.random() < this.critRate) {
                    dmg = Math.round(dmg * 1.5);
                }

                const projectiles = [];

                // === 多目标攻击 ===
                if (effectiveMulti > 1) {
                    const targets = this.findTargets(enemies, effectiveMulti);
                    for (const t of targets) {
                        this._dealDamage(t, dmg);
                        projectiles.push({ x: this.x, y: this.y, tx: t.x, ty: t.y, t: 0, dur: 0.18 });
                    }
                    return projectiles;
                }

                // === 单目标攻击 ===
                this._dealDamage(this.target, dmg);

                // === 溅射攻击 ===
                if (this.splash > 0) {
                    let splashR = this.splash;
                    if (window.RelicSystem) splashR *= RelicSystem.getSplashMul(this.heritageId);
                    for (const e of enemies) {
                        if (!e.alive || e === this.target) continue;
                        const dx = e.x - this.target.x;
                        const dy = e.y - this.target.y;
                        if (Math.sqrt(dx * dx + dy * dy) <= splashR) {
                            this._dealDamage(e, Math.round(dmg * 0.5));
                        }
                    }
                }

                // === 穿透攻击：沿直线伤害所有敌人 ===
                if (this.pierce) {
                    const dx = this.target.x - this.x;
                    const dy = this.target.y - this.y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len > 0) {
                        const nx = dx / len, ny = dy / len;
                        for (const e of enemies) {
                            if (!e.alive || e === this.target) continue;
                            // 计算敌人到射线距离
                            const ex = e.x - this.x, ey = e.y - this.y;
                            const proj = ex * nx + ey * ny;
                            if (proj < 0 || proj > len) continue;
                            const perpX = ex - proj * nx, perpY = ey - proj * ny;
                            if (Math.sqrt(perpX * perpX + perpY * perpY) <= 30) {
                                this._dealDamage(e, Math.round(dmg * 0.7));
                            }
                        }
                    }
                }

                return [{ x: this.x, y: this.y, tx: this.target.x, ty: this.target.y, t: 0, dur: 0.18 }];
            }
            return null;
        }

        /**
         * 统一伤害处理：包含护盾穿透、减速、中毒
         */
        _dealDamage(enemy, dmg) {
            if (this.ignoreShield) {
                // 无视护盾，直接扣血
                enemy.hp -= dmg;
                if (enemy.hp <= 0) { enemy.alive = false; enemy.killed = true; }
            } else {
                enemy.takeDamage(dmg);
            }
            // 自带减速
            if (this.slowFactor > 0) {
                let slow = this.slowFactor;
                if (window.RelicSystem) slow *= RelicSystem.getSlowMul(this.heritageId);
                enemy.slow = Math.min(0.8, Math.max(enemy.slow || 0, slow));
                enemy.slowTimer = Math.max(enemy.slowTimer || 0, this.slowDuration);
            }
            // 自带中毒
            if (this.poisonDps > 0) {
                const pd = this.poisonDps + (window.RelicSystem && RelicSystem.hasPoisonOnHit(this.heritageId) ? Math.round(dmg * 0.2) : 0);
                enemy.poisonDps = Math.max(enemy.poisonDps || 0, pd);
                enemy.poisonTimer = 3;
            } else if (window.RelicSystem && RelicSystem.hasPoisonOnHit(this.heritageId)) {
                enemy.poisonDps = Math.max(enemy.poisonDps || 0, Math.round(dmg * 0.2));
                enemy.poisonTimer = 3;
            }
        }
    }

    // ===== 敌人 =====
    class Enemy {
        constructor(data, lane, opts) {
            opts = opts || {};
            this.id = data.id + '_' + Math.random().toString(36).slice(2, 7);
            this.type = data.id;
            this.name = data.name;
            this.hp = data.hp * (opts.hpMul || 1); // bug fix #1：统一使用 hp
            this.maxHp = this.hp;
            this.speed = data.speed * (opts.speedMul || 1);
            this.attack = data.attack;
            this.isBoss = !!opts.isBoss;
            this.isElite = !!opts.isElite;
            this.skills = data.skill || null;
            this.reward = data.reward || {};
            this.color = data.color || '#888';
            this.lane = lane;
            this.pathIndex = 0;
            this.x = lane[0].x;
            this.y = lane[0].y;
            this.alive = true;
            this.reachedEnd = false;
            this.deathTimer = 0;
            this.displayHp = this.hp;
            this.invisible = false;
            this.shield = 0;
            this.dodge = 0;
            this.lampDamage = opts.lampDamage || 1;
            this.data = data;
            // 动画状态：弹跳/摇摆/受击闪烁
            this._animTime = 0;       // 累计动画时间
            this._hitFlash = 0;       // 受击闪烁计时器（秒）
            this._bouncePhase = 0;    // 弹跳相位
            if (this.isBoss) {
                this.skillTimer = this._skillCooldown();
                this.invisibleTimer = 0;
                this.split = false;
            }

            // 阶段四：首次遭遇怪物时解锁图鉴（无论是否击杀）
            if (data && data.id && window.GameState) {
                const isNew = !window.GameState.isCollectionUnlocked('monster', data.id);
                if (isNew) {
                    window.GameState.unlockCollection('monster', data.id);
                    // 战斗中使用非阻塞动画，避免影响操作
                    if (window.Management && window.Management.triggerUnlockAnimation) {
                        window.Management.triggerUnlockAnimation('monster', data.id, { blocking: false });
                    }
                }
            }
        }

        _skillCooldown() {
            const map = {
                'boss-rat': 5, 'boss-ox': 6, 'boss-rabbit': 3, 'boss-dragon': 4,
                'boss-snake': 5, 'boss-horse': 4, 'boss-sheep': 3, 'boss-monkey': 6,
                'boss-rooster': 4, 'boss-pig': 7
            };
            return map[this.type] || 6;
        }

        takeDamage(damage) {
            if (!this.alive) return;
            if (this.dodge > 0 && Math.random() < this.dodge) return;
            if (this.shield > 0) {
                const absorbed = Math.min(this.shield, damage);
                this.shield -= absorbed;
                damage -= absorbed;
            }
            this.hp -= damage;
            // 受击闪烁动画
            if (damage > 0) this._hitFlash = 0.15;
            // 阶段六：受击音效（节流，避免高频刷屏）
            if (window.AudioManager && damage > 0) {
                const now = performance.now() / 1000;
                if (now - _lastHitSoundTime > HIT_SOUND_INTERVAL) {
                    _lastHitSoundTime = now;
                    window.AudioManager.playSound('enemy-hit', 0.4);
                }
            }
            if (this.hp <= 0) {
                this.hp = 0;
                this.alive = false;
                this.deathTimer = 0.5;
                this.killed = true; // 被塔击杀（区别于逃逸），用于发奖
            }
        }

        move(dt) {
            if (!this.alive || this.reachedEnd) return;
            // 更新动画时间（弹跳/摇摆）
            this._animTime += dt;
            if (this._hitFlash > 0) this._hitFlash -= dt;
            if (this.pathIndex >= this.lane.length - 1) {
                this.reachedEnd = true;
                return;
            }
            const target = this.lane[this.pathIndex + 1];
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            // 减速效果生效
            const speedMul = this.slow > 0 ? (1 - this.slow) : 1;
            const step = this.speed * 60 * dt * speedMul;
            if (dist <= step) {
                this.x = target.x;
                this.y = target.y;
                this.pathIndex++;
            } else {
                this.x += (dx / dist) * step;
                this.y += (dy / dist) * step;
            }
            // 减速计时器递减
            if (this.slowTimer > 0) {
                this.slowTimer -= dt;
                if (this.slowTimer <= 0) this.slow = 0;
            }
        }
    }

    // ===== 主控 =====
    class TowerDefense {
        constructor() {
            this.canvas = null;
            this.ctx = null;
            this.currentLevelId = null; // bug fix #5
            this.gameLoopId = null;
            this.running = false;
            this.paused = false;
            this.speed = 1;
            // 同步速度按钮显示
            const speedBtn = document.getElementById('td-speed-btn');
            if (speedBtn) speedBtn.textContent = '1x';
            const pauseBtn = document.getElementById('td-pause-btn');
            if (pauseBtn) pauseBtn.textContent = '暂停';
            this.lastTime = 0;
            this.enemies = [];
            this.towers = [];
            this.projectiles = [];
            this.floats = [];
            this.lanes = [];
            this.pathCells = new Set();
            this.occupiedCells = new Set();
            this.lamp = null;
            this.lives = INIT_LIVES;
            this.cardSystem = null;
            this.waves = [];
            this.currentWave = 0;
            this.totalWaves = 0;
            this.spawnQueue = [];
            this.spawnTimer = 0;
            this.waveBreakTimer = 0;
            this.spawnCount = 0;
            this.placementMode = false;
            this.placementCard = null;
            this.hoverCell = null;
            this.selectedTower = null;
            this.bossRef = null;
            this._bound = false;
            this._pendingSpawns = [];
            // ===== 阶段十一：PVP 模式字段 =====
            this.pvpMode = null;        // null | 'attack-defense' | 'sync-battle' | 'defense-race'
            this.pvpRound = 0;          // 攻守轮换当前回合（1=玩家防守, 2=玩家进攻）
            this.pvpOpponent = null;    // AI对手数据
            this.pvpAttackDeck = [];    // 出战牌组（工坊ID列表，5-8个，三模式共用）
            this.pvpDefenseFormation = []; // [已废弃] 保留向后兼容
            this.pvpTimeLimit = 180;    // 回合限时（秒）
            this.pvpTimeRemaining = 0;  // 剩余时间（秒）
            this.pvpMainLampHP = 0;     // 玩家主灯HP
            this.pvpMainLampMaxHP = 0;
            this.pvpAiLampHP = 0;       // AI主灯HP
            this.pvpAiLampMaxHP = 0;
            this.pvpAiAttackScore = 0;  // 回合1：AI摧毁比例
            this.pvpPlayerAttackScore = 0; // 回合2：玩家摧毁比例
            // 同步对战/防守竞赛：AI后台模拟
            this.pvpAiSimTimer = 0;     // AI模拟累计时间（秒）
            this.pvpAiWavesSurvived = 0; // 防守竞赛：AI坚持波次
            this.pvpPlayerWavesSurvived = 0; // 防守竞赛：玩家坚持波次
        }

        // ===== DOM 视图切换 =====
        _ensureDom() {
            if (this._bound) return;
            this._bound = true;
            const screen = document.getElementById('td-screen');
            if (!screen) { console.error('td-screen 不存在'); return; }
            this.canvas = document.getElementById('td-canvas');
            this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
            // 设置画布绘图分辨率（CSS 仅控制显示尺寸，内部缓冲区需显式设定，否则默认 300x150 导致渲染被裁剪）
            if (this.canvas) {
                this.canvas.width = CANVAS_W;
                this.canvas.height = CANVAS_H;
            }

            const pauseBtn = document.getElementById('td-pause-btn');
            const speedBtn = document.getElementById('td-speed-btn');
            const exitBtn = document.getElementById('td-exit-btn');
            if (pauseBtn) pauseBtn.addEventListener('click', () => this.togglePause());
            if (speedBtn) speedBtn.addEventListener('click', () => this.toggleSpeed());
            if (exitBtn) exitBtn.addEventListener('click', () => this.exit());

            // 准备阶段"立即开始"按钮
            const prepStartBtn = document.getElementById('td-prep-start');
            if (prepStartBtn) prepStartBtn.addEventListener('click', () => this._skipPrep());

            // 手动抽卡按钮
            const drawBtn = document.getElementById('td-draw-btn');
            if (drawBtn) drawBtn.addEventListener('click', () => this._manualDrawCard());

            // 阶段十二：看广告免费抽卡按钮
            const freeDrawBtn = document.getElementById('td-free-draw-btn');
            if (freeDrawBtn) freeDrawBtn.addEventListener('click', () => this._freeDrawCardViaAd());

            if (this.canvas) {
                this.canvas.addEventListener('mousemove', (e) => this._onCanvasMove(e));
                this.canvas.addEventListener('click', (e) => this._onCanvasClick(e));
                this.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this._cancelPlacement(); });
            }
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.placementMode) this._cancelPlacement();
            });
        }

        _showView(view) {
            this._ensureDom();
            const map = ['td-level-select', 'td-top-bar', 'td-canvas', 'td-popularity-bar', 'td-hand-area', 'td-boss-bar', 'td-tower-info', 'td-card-choice', 'td-result', 'td-draw-anim'];
            map.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
            const screen = document.getElementById('td-screen');
            if (screen) screen.classList.remove('hidden');
            if (view === 'select') {
                const el = document.getElementById('td-level-select'); if (el) el.classList.remove('hidden');
            } else if (view === 'battle') {
                ['td-top-bar', 'td-canvas', 'td-popularity-bar', 'td-hand-area'].forEach(id => {
                    const el = document.getElementById(id); if (el) el.classList.remove('hidden');
                });
            }
        }

        _hideAll() {
            const screen = document.getElementById('td-screen');
            if (screen) screen.classList.add('hidden');
        }

        // ===== 关卡选择（阶段九：分页网格，3页×10关）=====
        showLevelSelect() {
            this._ensureDom();
            this._showView('select');
            const container = document.getElementById('td-level-select');
            if (!container) return;
            // 分页状态保持（面板关闭/重开不丢失）
            if (this._lsCurrentPage == null) this._lsCurrentPage = 0;
            this._lsShowLevels = false; // 每次进入默认显示圆环
            this._renderLevelSelectPage(container, this._lsCurrentPage);
        }

        // 渲染关卡选择页（十二生肖圆环选择器）
        _renderLevelSelectPage(container, pageIdx) {
            const levels = (window.GameData && window.GameData.LEVELS) || [];
            const gs = window.GameState || {};
            const unlocked = gs.unlockedLevels || [1];
            const completed = gs.completedLevels || [];
            const endlessRecord = gs.endlessRecord || 0;

            // 12 生肖与时辰对应关系，关卡从 LEVELS 数据按 hour 字段自动分组
            const ZODIAC = [
                { name: '鼠', emoji: '🐭', hour: '子时' },
                { name: '牛', emoji: '🐮', hour: '丑时' },
                { name: '虎', emoji: '🐯', hour: '寅时' },
                { name: '兔', emoji: '🐰', hour: '卯时' },
                { name: '龙', emoji: '🐲', hour: '辰时' },
                { name: '蛇', emoji: '🐍', hour: '巳时' },
                { name: '马', emoji: '🐴', hour: '午时' },
                { name: '羊', emoji: '🐑', hour: '未时' },
                { name: '猴', emoji: '🐵', hour: '申时' },
                { name: '鸡', emoji: '🐔', hour: '酉时' },
                { name: '狗', emoji: '🐶', hour: '戌时' },
                { name: '猪', emoji: '🐷', hour: '亥时' }
            ];
            // 按 hour 自动分组关卡
            ZODIAC.forEach(z => { z.levels = levels.filter(l => l.hour === z.hour).map(l => l.index); });

            // 计算当前应高亮的生肖：首个"已解锁但未通关"关卡所在生肖
            const sortedUnlocked = [...unlocked].sort((a, b) => a - b);
            let currentLevelIdx = sortedUnlocked.length ? sortedUnlocked[sortedUnlocked.length - 1] : 1;
            for (const idx of sortedUnlocked) {
                if (!completed.includes(idx)) { currentLevelIdx = idx; break; }
            }
            const currentZodiacIdx = Math.max(0, ZODIAC.findIndex(z => z.levels.includes(currentLevelIdx)));

            // 保持选中的生肖（面板重开不丢失）；默认展开当前生肖
            if (this._lsSelectedZodiac == null) this._lsSelectedZodiac = currentZodiacIdx;
            const selIdx = Math.min(Math.max(0, this._lsSelectedZodiac), ZODIAC.length - 1);

            const weeklySpecial = this._getWeeklySpecial();
            const spCfg = (window.GameData && window.GameData.SPECIAL_LEVELS || {})[weeklySpecial];

            // 判断当前视图：圆环 or 关卡列表
            const showLevelsView = this._lsShowLevels === true;

            let html = '<button class="td-back-btn" id="td-ls-back">' + (showLevelsView ? '← 返回圆环' : '← 返回古镇') + '</button>';

            if (showLevelsView) {
                // === 关卡列表页面（点击生肖后跳转） ===
                const selZodiac = ZODIAC[selIdx];
                html += `<h2 class="td-ls-title">${selZodiac.emoji} ${selZodiac.name}时辰 · 关卡</h2>`;
                const SUBTYPE_BORDER = { initial: 'sub-initial', middle: 'sub-middle', final: 'sub-final' };
                html += '<div class="zodiac-levels-grid zodiac-levels-fullpage">';
                selZodiac.levels.forEach(lvIdx => {
                    const lv = levels.find(l => l.index === lvIdx);
                    if (!lv) return;
                    const isUnlocked = unlocked.includes(lv.index);
                    const isCompleted = completed.includes(lv.index);
                    const stars = (gs.levelStars && gs.levelStars[lv.index]) || (isCompleted ? 1 : 0);
                    const bossObj = enemyDataById(lv.boss);
                    const bossShort = bossObj ? bossObj.name.split('·')[0] : '';
                    const subClass = SUBTYPE_BORDER[lv.subType] || '';
                    html += `
                        <div class="td-level-card ${subClass} ${isUnlocked ? '' : 'locked'} ${isCompleted ? 'completed' : ''}" data-level="${lv.index}">
                            <div class="td-level-emoji">${BOSS_EMOJI[lv.boss] || '⭐'}</div>
                            <div class="td-level-name">${lv.name}</div>
                            <div class="td-level-boss">${bossShort}</div>
                            <div class="td-level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
                            ${isCompleted ? '<div class="td-level-check">✓</div>' : ''}
                            ${!isUnlocked ? '<div class="td-level-lock">🔒</div>' : ''}
                        </div>`;
                });
                html += '</div>';
                html += '<div class="td-ls-hint">点击已解锁关卡进入战斗</div>';
            } else {
                // === 圆环主页面 ===
                html += '<h2 class="td-ls-title">十二时辰 · 闯关</h2>';
                html += '<div class="zodiac-wheel-wrap">';
                html += this._renderZodiacWheel(ZODIAC, { unlocked, completed, gs, selIdx, currentZodiacIdx, endlessRecord, spCfg });
                html += '</div>';
                html += '<div class="td-ls-hint zodiac-future-hint">点击生肖进入关卡 · 未来更新：24节气 · 天干地支</div>';
            }

            container.innerHTML = html;

            // 绑定生肖扇形点击 → 跳转到关卡列表页面
            if (!showLevelsView) {
                container.querySelectorAll('.zodiac-sector').forEach(node => {
                    const zi = parseInt(node.dataset.zodiac, 10);
                    const z = ZODIAC[zi];
                    const isUnlocked = z.levels.length > 0 && z.levels.some(l => unlocked.includes(l));
                    if (!isUnlocked) {
                        node.addEventListener('click', () => {
                            const firstLv = z.levels[0] || 1;
                            const prevLv = firstLv > 1 ? firstLv - 1 : 1;
                            const prevDef = levels.find(l => l.index === prevLv);
                            alert(`🔒 ${z.emoji} ${z.name}时辰尚未开启\n请先通关「${prevDef ? prevDef.name : '前一关'}」`);
                        });
                    } else {
                        node.addEventListener('click', () => {
                            this._lsSelectedZodiac = zi;
                            this._lsShowLevels = true;
                            this._renderLevelSelectPage(container, pageIdx);
                        });
                    }
                });
            }

            // 绑定关卡卡片点击
            container.querySelectorAll('.td-level-card').forEach(node => {
                const lid = parseInt(node.dataset.level, 10);
                if (unlocked.includes(lid)) {
                    node.addEventListener('click', () => this.startLevel(lid));
                }
            });

            // 返回按钮
            const back = document.getElementById('td-ls-back');
            if (back) back.addEventListener('click', () => {
                if (showLevelsView) {
                    // 从关卡列表返回圆环
                    this._lsShowLevels = false;
                    this._renderLevelSelectPage(container, pageIdx);
                } else {
                    this._hideAll();
                }
            });

            // 无尽入口
            const endlessBtn = document.getElementById('td-endless-entry');
            if (endlessBtn) endlessBtn.addEventListener('click', () => this._confirmEndless());
            // 特殊入口
            const specialBtn = document.getElementById('td-special-entry');
            if (specialBtn) specialBtn.addEventListener('click', () => this._showSpecialPreview(this._getWeeklySpecial()));
        }

        // 渲染十二生肖圆环（返回 HTML 字符串）
        _renderZodiacWheel(zodiacList, ctx) {
            const { unlocked, completed, gs, selIdx, currentZodiacIdx, endlessRecord, spCfg } = ctx;
            const TOTAL = zodiacList.length;

            let html = '<div class="zodiac-wheel">';
            // 圆环底色（conic-gradient 12 等分，奇偶交替）
            html += '<div class="zodiac-ring" aria-hidden="true"></div>';

            zodiacList.forEach((z, i) => {
                const angle = (360 / TOTAL) * i; // 鼠在正上方，顺时针
                const isUnlocked = z.levels.some(l => unlocked.includes(l));
                const allCompleted = z.levels.every(l => completed.includes(l));
                const isCurrent = i === currentZodiacIdx;
                const isActive = i === selIdx;
                const starsEarned = z.levels.reduce((sum, l) => {
                    const s = (gs.levelStars && gs.levelStars[l]) || (completed.includes(l) ? 1 : 0);
                    return sum + s;
                }, 0);
                const starsMax = z.levels.length * 3;

                const cls = ['zodiac-sector'];
                if (!isUnlocked) cls.push('locked');
                if (allCompleted) cls.push('completed');
                if (isCurrent) cls.push('current');
                if (isActive) cls.push('active');

                html += `<div class="${cls.join(' ')}" data-zodiac="${i}" style="--zs-angle:${angle}deg;" role="button" tabindex="${isUnlocked ? 0 : -1}" aria-label="${z.name}时辰">`;
                html += `<div class="zodiac-sector-emoji">${z.emoji}</div>`;
                html += `<div class="zodiac-sector-name">${z.name}</div>`;
                if (!isUnlocked) {
                    html += `<div class="zodiac-sector-badge">🔒</div>`;
                } else if (allCompleted) {
                    html += `<div class="zodiac-sector-stars">⭐${starsEarned}/${starsMax}</div>`;
                } else if (isCurrent) {
                    html += `<div class="zodiac-sector-now">进行中</div>`;
                } else {
                    html += `<div class="zodiac-sector-stars dim">⭐${starsEarned}/${starsMax}</div>`;
                }
                html += `</div>`;
            });

            // 中心区域：无尽挑战 + 特殊挑战
            html += '<div class="zodiac-center">';
            html += `<button class="endless-entry-btn zodiac-center-btn" id="td-endless-entry">无尽挑战<span class="endless-best">最高：第 ${endlessRecord} 波</span></button>`;
            if (spCfg) {
                html += `<button class="special-entry-btn zodiac-center-btn" id="td-special-entry">${spCfg.icon} 特殊挑战<span class="special-reward-hint">奖励预览</span></button>`;
            } else {
                html += `<button class="special-entry-btn zodiac-center-btn" id="td-special-entry" disabled>特殊挑战<span class="special-reward-hint">敬请期待</span></button>`;
            }
            html += '</div>';
            html += '</div>';
            return html;
        }

        // 计算本周特殊关卡（按周轮换）
        _getWeeklySpecial() {
            const START_DATE = new Date('2026-01-01').getTime();
            const weekNumber = Math.floor((Date.now() - START_DATE) / (7 * 24 * 60 * 60 * 1000));
            const specialIndex = ((weekNumber % 3) + 3) % 3;
            return ['boss-rush', 'tower-restriction', 'resource-restriction'][specialIndex];
        }

        // 无尽模式进入确认
        _confirmEndless() {
            const ok = confirm('无尽模式中经营产出将暂停，确认进入？');
            if (ok) this._startEndless();
        }

        // 特殊关卡奖励预览
        _showSpecialPreview(specialId) {
            const cfg = (window.GameData && window.GameData.SPECIAL_LEVELS || {})[specialId];
            if (!cfg) return;
            const r = cfg.reward || {};
            const rewardStr = `铜钱 ${r.coins || 0} · 卷轴 ${r.scrolls || 0} · 灵感 ${r.inspiration || 0}${r.relic ? ' · 稀有遗物' : ''}`;
            const ok = confirm(`${cfg.icon} ${cfg.name}\n${cfg.description}\n奖励：${rewardStr}\n\n点击确定进入挑战（不影响主线进度）`);
            if (ok) this._startSpecial(specialId);
        }

        // ===== 路径构建 =====
        _buildPath(levelId) {
            const def = LEVEL_PATHS[levelId];
            let laneDefs;
            if (Array.isArray(def)) laneDefs = [def];
            else laneDefs = def.lanes;
            this.lanes = laneDefs.map(lane => lane.map(([c, r]) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 })));
            this.pathCells = new Set();
            laneDefs.forEach(lane => {
                for (let i = 0; i < lane.length - 1; i++) {
                    const [c1, r1] = lane[i];
                    const [c2, r2] = lane[i + 1];
                    const dc = Math.sign(c2 - c1);
                    const dr = Math.sign(r2 - r1);
                    let c = c1, r = r1;
                    this.pathCells.add(`${c},${r}`);
                    while (c !== c2 || r !== r2) {
                        c += dc; r += dr;
                        this.pathCells.add(`${c},${r}`);
                    }
                }
            });
            this.lamp = this.lanes[0][this.lanes[0].length - 1];
        }

        // ===== 波次构建 =====
        _buildWaves(levelId) {
            const lv = levelData(levelId);
            if (!lv) return;
            const waves = [];

            // 阶段九：30 关难度配置表（按 index）——基础 HP 倍率与每波数量
            // 子关卡再用 lv.difficultyMultiplier(0.8/1.0/1.3) 二次缩放
            const LEVEL_DIFF = {
                1:  { hpMul: 0.70, baseCount: 3 }, 2:  { hpMul: 0.80, baseCount: 4 },
                3:  { hpMul: 0.90, baseCount: 4 }, 4:  { hpMul: 1.00, baseCount: 5 },
                5:  { hpMul: 1.00, baseCount: 5 }, 6:  { hpMul: 1.00, baseCount: 6 },
                7:  { hpMul: 1.10, baseCount: 6 }, 8:  { hpMul: 1.15, baseCount: 7 },
                9:  { hpMul: 1.20, baseCount: 7 }, 10: { hpMul: 1.25, baseCount: 8 },
                11: { hpMul: 1.30, baseCount: 8 }, 12: { hpMul: 1.40, baseCount: 9 },
                13: { hpMul: 1.20, baseCount: 8 }, 14: { hpMul: 1.25, baseCount: 8 },
                15: { hpMul: 1.30, baseCount: 9 }, 16: { hpMul: 1.30, baseCount: 9 },
                17: { hpMul: 1.35, baseCount: 9 }, 18: { hpMul: 1.40, baseCount: 10 },
                19: { hpMul: 1.40, baseCount: 10 },20: { hpMul: 1.45, baseCount: 10 },
                21: { hpMul: 1.50, baseCount: 11 },22: { hpMul: 1.45, baseCount: 10 },
                23: { hpMul: 1.50, baseCount: 11 },24: { hpMul: 1.55, baseCount: 11 },
                25: { hpMul: 1.55, baseCount: 11 },26: { hpMul: 1.60, baseCount: 12 },
                27: { hpMul: 1.65, baseCount: 12 },28: { hpMul: 1.60, baseCount: 12 },
                29: { hpMul: 1.70, baseCount: 13 },30: { hpMul: 1.80, baseCount: 14 }
            };
            const idx = lv.index || levelId;
            const diff = LEVEL_DIFF[idx] || { hpMul: 1.0, baseCount: 5 };
            // 子类型难度倍率叠加：initial 0.8 / middle 1.0 / final 1.3
            const subMul = lv.difficultyMultiplier || 1.0;
            const hpMul = diff.hpMul * subMul;
            const bossHpMul = hpMul * (lv.bossHpMultiplier || 1.0);

            for (let w = 0; w < lv.waves; w++) {
                const isLast = w === lv.waves - 1;
                const entries = [];
                if (isLast) {
                    // BOSS 波次：最后一波出 BOSS（应用 bossHpMul）+ 伴生小怪
                    entries.push({ kind: 'boss', id: lv.boss, hpMul: bossHpMul, delay: 1200 });
                    const adds = 2 + Math.floor(idx / 3);
                    for (let i = 0; i < adds; i++) entries.push({ kind: 'normal', hpMul, delay: 700 });
                } else {
                    const count = diff.baseCount + (w > 0 ? 1 : 0);
                    const eliteChance = w >= 2 ? 0.1 : 0;
                    for (let i = 0; i < count; i++) {
                        entries.push({ kind: Math.random() < eliteChance ? 'elite' : 'normal', hpMul, delay: Math.max(500, 1000 - idx * 15) });
                    }
                }
                waves.push(entries);
            }
            this.waves = waves;
            this.totalWaves = waves.length;
            this.currentWave = 0;
            this.spawnQueue = [];
            this.spawnTimer = 0;
            this.prepPhase = true;
            this.prepTimer = 10;
            this.waveBreakTimer = 0;
        }

        // ===== 开始关卡 =====
        startLevel(levelId) {
            this.currentLevelId = levelId; // bug fix #5
            this._ensureDom();
            this._showView('battle');

            // 停止经营产出（防止关卡内铜钱飞行特效残留）
            if (window._managementInstance && window._managementInstance.stopProduction) {
                window._managementInstance.stopProduction();
            }

            // 阶段七：重置上一关局内遗物，重新应用永久遗物效果
            if (window.RelicSystem) {
                RelicSystem.resetRunRelics();
                RelicSystem.reapplyPermanentRelics();
            }

            // 阶段七：弹出遗物三选一面板（拥有 lucky-charm 时四选一）
            // 遗物选择期间不启动游戏循环、不开始倒计时
            if (window.RelicSystem) {
                this._showRelicSelectPanel();
                return; // 等待玩家选择后调用 _startLevelCore
            }

            // 无遗物系统时直接进入战斗
            this._startLevelCore();
        }

        /**
         * 阶段七：显示遗物选择面板
         */
        _showRelicSelectPanel() {
            const panel = document.getElementById('relic-select-panel');
            const cardsEl = document.getElementById('relic-select-cards');
            if (!panel || !cardsEl) {
                // DOM 缺失降级
                this._startLevelCore();
                return;
            }

            // 关闭其他弹窗（避免冲突）
            const result = document.getElementById('td-result'); if (result) result.classList.add('hidden');
            const choice = document.getElementById('td-card-choice'); if (choice) choice.classList.add('hidden');

            const candidates = RelicSystem.rollRunRelics(3);
            this._pendingRelicCandidates = candidates;

            cardsEl.innerHTML = '';
            candidates.forEach(relic => {
                const card = document.createElement('div');
                card.className = `relic-card rarity-${relic.rarity}`;
                card.innerHTML = `
                    <div class="relic-rarity-tag rarity-${relic.rarity}">${window.RARITY_LABEL ? RARITY_LABEL[relic.rarity] : relic.rarity}</div>
                    <div class="relic-card-emoji">${relic.emoji}</div>
                    <div class="relic-card-name">${relic.name}</div>
                    <div class="relic-card-desc">${relic.description}</div>
                `;
                card.addEventListener('click', () => this._onRelicSelected(relic.id));
                cardsEl.appendChild(card);
            });

            panel.classList.remove('hidden');
            if (window.AudioManager) AudioManager.playSound('relic-select', 0.8);
        }

        /**
         * 阶段七：玩家选择遗物后回调
         */
        _onRelicSelected(relicId) {
            RelicSystem.applyRelic(relicId, false); // 应用局内遗物
            this._pendingRelicCandidates = null;

            const panel = document.getElementById('relic-select-panel');
            if (panel) panel.classList.add('hidden');

            if (window.AudioManager) AudioManager.playSound('relic-select', 0.5);

            // 进入战斗核心流程
            this._startLevelCore();
        }

        /**
         * 阶段七：实际初始化战斗数据 + 启动游戏循环（原 startLevel 主体）
         */
        _startLevelCore() {
            const levelId = this.currentLevelId;

            // 重置状态
            this.enemies = [];
            this.towers = [];
            this.projectiles = [];
            this.floats = [];
            this.occupiedCells = new Set();
            this.lives = INIT_LIVES;
            this.bossRef = null;
            this.selectedTower = null;
            this.placementMode = false;
            this.placementCard = null;
            this.hoverCell = null;
            this.movingTower = null;
            this.paused = false;
            this.speed = 1;
            this.spawnCount = 0;
            this._pendingSpawns = [];

            // 阶段十二：广告复活续命 - 每关开始重置本关复活标记
            this._showingRevive = false;
            if (window.AdSystem && typeof AdSystem.resetReviveForNewLevel === 'function') {
                AdSystem.resetReviveForNewLevel();
            }

            // 阶段十：留存系统追踪字段
            this._levelStartTime = Date.now();   // 关卡开始时间（用于通关速度统计）
            this._levelNoDamage = true;          // 主灯是否未受损
            this._leakedEnemy = false;           // 是否有敌人漏过（逃逸到主灯）
            this._killCount = 0;                 // 本关击杀计数（用于节流检查成就）

            this._buildPath(levelId);
            this._buildWaves(levelId);

            // 阶段七：准备时间加成（永久遗物 time-hourglass）
            if (window.RelicSystem) {
                this.prepTimer += RelicSystem.getPrepTimeBonus();
            }

            // 卡牌系统：构建牌库 + 抽初始手牌（5张 + 永久遗物加成）
            this.cardSystem = new CardSystem();
            const extraHand = window.RelicSystem ? RelicSystem.getExtraStartingHand() : 0;
            const initHandCount = 5 + extraHand;
            for (let i = 0; i < initHandCount; i++) this.cardSystem.drawCardWithoutMerge();

            // 阶段七：初始人气/铜钱加成（永久遗物）
            if (window.RelicSystem && this.cardSystem) {
                const popBonus = RelicSystem.getStartingPopularityBonus();
                if (popBonus > 0) this.cardSystem.addPopularity(popBonus);
                const coinBonus = RelicSystem.getStartingCoinsBonus();
                if (coinBonus > 0 && window.GameState) window.GameState.addCoins(coinBonus);
            }

            // 修复：特殊关卡规则在 _buildWaves 和遗物加成之后应用，避免被覆盖
            if (this.specialMode && this.specialMode.running) {
                if (this.specialMode.id === 'boss-rush') {
                    this._applyBossRush(this.specialMode.cfg);
                }
                if (this.specialMode.id === 'resource-restriction' && window.GameState) {
                    const half = Math.floor(window.GameState.coins / 2);
                    window.GameState.coins = half;
                    this.specialMode.popularityMul = this.specialMode.cfg.popularityMul || 0.5;
                    window.GameState.isResourceRestricted = true;
                    window.GameState._resourcePopularityMul = this.specialMode.cfg.popularityMul || 0.5;
                }
            }

            // 顶部信息
            const lv = levelData(levelId);
            const nameEl = document.getElementById('td-level-name');
            if (nameEl && lv) nameEl.textContent = lv.name;
            this._updateLivesUI();
            this._updateWaveUI();
            this._updatePopularityUI();
            this._renderHand();
            this._updateBossBar(null);
            this._showPrepBanner();

            // 阶段七：更新右上角遗物栏
            this._updateActiveRelicsBar();

            // bug fix #7：接入真实战斗循环
            this.running = true;
            this.lastTime = 0;
            this.gameLoopId = requestAnimationFrame((t) => this._gameLoop(t));

            if (this.cardSystem.hand.length === 0) {
                this._toast('未建造任何工坊，无可用卡牌！请先在经营模式建造工坊。', 'error');
            }

            // 阶段六：切换为战斗背景音乐
            if (window.AudioManager) window.AudioManager.playBGM('bgm-battle');

            // #10 关卡天气：根据关卡时辰播放对应天气特效
            if (lv && lv.weather && window.SceneFx) {
                window.SceneFx.clearWeather();
                setTimeout(() => {
                    if (window.SceneFx && this.running) {
                        window.SceneFx.setWeather(lv.weather);
                    }
                }, 100);
            }
        }

        /**
         * 阶段七：更新右上角战斗遗物栏
         */
        _updateActiveRelicsBar() {
            const bar = document.getElementById('td-active-relics');
            if (!bar || !window.RelicSystem) return;
            const relics = RelicSystem.getActiveRelics();
            bar.innerHTML = '';
            relics.forEach(relic => {
                const icon = document.createElement('div');
                icon.className = `relic-bar-icon rarity-${relic.rarity}`;
                icon.innerHTML = `${relic.emoji}<div class="relic-tooltip"><div class="relic-tooltip-name">${relic.name}</div><div class="relic-tooltip-desc">${relic.description}</div></div>`;
                bar.appendChild(icon);
            });
            bar.classList.toggle('hidden', relics.length === 0);
        }

        // ===== 游戏循环 =====
        _gameLoop(timestamp) {
            if (!this.running) return;
            if (this.lastTime === 0) this.lastTime = timestamp;
            let dt = (timestamp - this.lastTime) / 1000;
            this.lastTime = timestamp;
            if (dt > 0.05) dt = 0.05; // 钳制大跳变

            if (!this.paused) {
                const eff = dt * this.speed;
                this._update(eff, timestamp);
            }
            this._render(timestamp);
            this.gameLoopId = requestAnimationFrame((t) => this._gameLoop(t));
        }

        _update(dt, now) {
            // 阶段十一：PVP 模式走专用波次 + 计时逻辑
            if (this.pvpMode) {
                this._updatePvpWaves(dt);
            } else {
                // 波次推进
                this._updateWaves(dt);
            }

            // 敌人移动 + BOSS 技能（用快照迭代，避免召唤/分裂时边遍历边 push）
            const snapshot = this.enemies.slice();
            snapshot.forEach(e => {
                if (e.alive) {
                    e.move(dt);
                    if (e.isBoss) this._updateBossSkill(e, dt, now);
                    // 阶段七：中毒效果扣血（中医塔 + 悬壶济世遗物）
                    if (e.poisonTimer && e.poisonTimer > 0) {
                        e.poisonTimer -= dt;
                        const dps = e.poisonDps || 0;
                        if (dps > 0) e.takeDamage(dps * dt);
                        if (e.poisonTimer <= 0) { e.poisonTimer = 0; e.poisonDps = 0; }
                    }
                } else if (e.deathTimer > 0) {
                    e.deathTimer -= dt;
                }
                // 血条平滑过渡
                if (e.displayHp !== e.hp) {
                    const diff = e.displayHp - e.hp;
                    e.displayHp = e.hp + diff * Math.pow(0.001, dt);
                    if (Math.abs(e.displayHp - e.hp) < 0.5) e.displayHp = e.hp;
                }
            });
            // 合并本帧召唤/分裂的新敌人
            if (this._pendingSpawns.length) {
                this.enemies = this.enemies.concat(this._pendingSpawns);
                this._pendingSpawns = [];
            }

            // 到达终点（逃逸，不发奖励）
            this.enemies.forEach(e => {
                if (e.alive && e.reachedEnd) {
                    e.alive = false;
                    e.escaped = true;
                    e.deathTimer = 0;
                    // 阶段十一：PVP 模式扣对应主灯 HP
                    if (this.pvpMode) {
                        const dmg = e.lampDamage * 50; // PVP 主灯伤害放大
                        // attack-defense 回合2 扣 AI 主灯，其余模式扣玩家主灯
                        if (this.pvpMode === 'attack-defense' && this.pvpRound === 2) {
                            this.pvpAiLampHP = Math.max(0, this.pvpAiLampHP - dmg);
                            this._addFloat(this.lamp.x, this.lamp.y - 20, `-${dmg}`, '#1E90FF');
                        } else {
                            this.pvpMainLampHP = Math.max(0, this.pvpMainLampHP - dmg);
                            this._addFloat(this.lamp.x, this.lamp.y - 20, `-${dmg}`, '#DC143C');
                        }
                    } else {
                        this.lives = Math.max(0, this.lives - e.lampDamage);
                        this._updateLivesUI();
                        this._addFloat(this.lamp.x, this.lamp.y - 20, `-${e.lampDamage}灯`, '#DC143C');
                        // 阶段十：标记漏怪 + 主灯受损
                        this._leakedEnemy = true;
                        this._levelNoDamage = false;
                    }
                }
            });

            // 击杀奖励：被塔打死的敌人（killed 标记，仍有消散动画）
            this.enemies.forEach(e => {
                if (!e.alive && e.killed && !e._rewarded) {
                    this._onEnemyDeath(e);
                }
            });

            // 塔攻击（攻速受倍速影响）
            this.towers.forEach(t => {
                const proj = t.attack(now, this.enemies, this.speed);
                if (proj) {
                    // 兼容多目标返回数组
                    const projList = Array.isArray(proj) ? proj : [proj];
                    for (const p of projList) {
                        this.projectiles.push(p);
                        if (window.BattleFx) {
                            window.BattleFx.play(t.heritageId || t.towerType, t.x, t.y, p.tx, p.ty);
                        }
                        if (window.AudioManager) {
                            window.AudioManager.playSound('tower-attack', 0.6, { heritageId: t.heritageId });
                        }
                    }
                }
            });

            // 投射物
            this.projectiles.forEach(p => { p.t += dt; });
            this.projectiles = this.projectiles.filter(p => p.t < p.dur);

            // 阶段五：更新战斗特效 + 敌人特效粒子
            if (window.BattleFx) window.BattleFx.update(dt);
            if (window.EnemyFx) window.EnemyFx.update(dt);

            // 浮动文字
            this.floats.forEach(f => { f.t += dt; f.y -= 20 * dt; });
            this.floats = this.floats.filter(f => f.t < 1);

            // 清理消散完毕的敌人
            this.enemies = this.enemies.filter(e => e.alive || e.deathTimer > 0);

            // BOSS 血条
            const boss = this.enemies.find(e => e.isBoss && e.alive);
            this._updateBossBar(boss || null);

            // 胜负判定
            if (this.pvpMode) {
                // 阶段十一：PVP 模式由专用计时器处理结束判定
                this._updatePvpTimer(dt);
                return;
            }
            if (this.lives <= 0) {
                // 阶段十二：非无尽/非PVP模式下，如果还能复活，弹出复活提示
                const canTryRevive = !this._showingRevive
                    && !(this.endlessMode && this.endlessMode.running)
                    && !this.pvpMode
                    && window.AdSystem
                    && typeof AdSystem.canReviveThisLevel === 'function'
                    && AdSystem.canReviveThisLevel();
                if (canTryRevive) {
                    this._showingRevive = true;
                    this.paused = true;
                    this._showRevivePrompt();
                    return;
                }
                // 阶段九：无尽模式失败走专用结算
                if (this.endlessMode && this.endlessMode.running) {
                    this._endlessOnDefeat();
                    return;
                }
                this._endBattle(false);
                return;
            }
            // 无尽模式不判胜利（无限波次）
            if (this.endlessMode && this.endlessMode.running) return;
            if (this.currentWave >= this.totalWaves && this.spawnQueue.length === 0 && this.enemies.length === 0) {
                // 阶段九：特殊关卡胜利由 showResult 走专用结算分支（不影响主线）
                this._endBattle(true);
            }
        }

        _updateWaves(dt) {
            // 阶段九：无尽模式波次推进（不依赖固定 totalWaves）
            if (this.endlessMode && this.endlessMode.running) {
                // 准备阶段
                if (this.prepPhase) {
                    this.prepTimer -= dt;
                    this._updatePrepUI();
                    if (this.prepTimer <= 0) {
                        this.prepPhase = false;
                        this._hidePrepBanner();
                        if (this.currentWave < this.waves.length) {
                            this.spawnQueue = this.waves[this.currentWave].slice();
                            this.currentWave++;
                            this.spawnTimer = 0;
                            this._updateWaveUI();
                        }
                    }
                    return;
                }
                // 当前波出完且场上无活敌人 → 波次完成
                if (this.spawnQueue.length === 0) {
                    const anyAlive = this.enemies.some(e => e.alive);
                    if (!anyAlive) {
                        this._endlessOnWaveCleared();
                        return;
                    }
                    return;
                }
                // 生成（带 MAX_ENEMIES 检查）
                this.spawnTimer -= dt;
                if (this.spawnTimer <= 0) {
                    const cfg = (window.GameData && window.GameData.ENDLESS_CONFIG) || {};
                    const MAX = cfg.MAX_ENEMIES || 200;
                    const aliveCount = this.enemies.filter(e => e.alive).length;
                    if (aliveCount >= MAX) {
                        // 超限，延后生成
                        this.spawnTimer = 0.3;
                        return;
                    }
                    const entry = this.spawnQueue.shift();
                    this._spawnEnemy(entry);
                    this.spawnTimer = (entry.delay || 800) / 1000;
                }
                return;
            }
            // 准备阶段倒计时
            if (this.prepPhase) {
                this.prepTimer -= dt;
                this._updatePrepUI();
                if (this.prepTimer <= 0) {
                    this.prepPhase = false;
                    this._hidePrepBanner();
                    // 开始出怪
                    if (this.currentWave < this.totalWaves) {
                        this.spawnQueue = this.waves[this.currentWave].slice();
                        this.currentWave++;
                        this.spawnTimer = 0;
                        this._updateWaveUI();
                    }
                }
                return;
            }
            // 加载下一波（需要准备阶段）
            if (this.spawnQueue.length === 0) {
                const anyAlive = this.enemies.some(e => e.alive);
                if (!anyAlive) {
                    if (this.currentWave < this.totalWaves) {
                        // 进入下一波的准备阶段
                        this.prepPhase = true;
                        this.prepTimer = 10;
                        this._showPrepBanner();
                    }
                }
                return;
            }
            // 生成
            this.spawnTimer -= dt;
            if (this.spawnTimer <= 0) {
                const entry = this.spawnQueue.shift();
                this._spawnEnemy(entry);
                this.spawnTimer = (entry.delay || 800) / 1000;
            }
        }

        _showPrepBanner() {
            const banner = document.getElementById('td-prep-banner');
            if (banner) banner.classList.remove('hidden');
            this._updatePrepUI();
        }

        _hidePrepBanner() {
            const banner = document.getElementById('td-prep-banner');
            if (banner) banner.classList.add('hidden');
        }

        _updatePrepUI() {
            const timerEl = document.getElementById('td-prep-timer');
            const textEl = document.getElementById('td-prep-text');
            if (timerEl) timerEl.textContent = Math.ceil(this.prepTimer);
            if (textEl) {
                if (this.currentWave === 0) {
                    textEl.textContent = '准备阶段';
                } else {
                    textEl.textContent = `第${this.currentWave + 1}波准备`;
                }
            }
        }

        /** 跳过准备阶段 */
        _skipPrep() {
            if (this.prepPhase) {
                this.prepTimer = 0;
            }
        }

        _spawnEnemy(entry) {
            const lane = this.lanes[this.spawnCount % this.lanes.length];
            this.spawnCount++;
            let data, opts = { hpMul: entry.hpMul || 1 };
            if (entry.kind === 'boss') {
                data = enemyDataById(entry.id);
                opts.isBoss = true;
                opts.lampDamage = (entry.id === 'boss-dog' || entry.id === 'boss-horse') ? 3 : (entry.id === 'boss-pig' ? 5 : 2);
                if (entry.id === 'boss-rabbit') opts.speedMul = 1;
            } else if (entry.kind === 'elite') {
                data = pickRandom((window.GameData.ENEMY_DATA.elite || []));
                opts.isElite = true;
            } else {
                data = pickRandom((window.GameData.ENEMY_DATA.normal || []));
            }
            if (!data) return;
            const enemy = new Enemy(data, lane, opts);
            this.enemies.push(enemy);
            if (enemy.isBoss) {
                this.bossRef = enemy;
                this._toast(`${enemy.name} 降临！`, 'info');
                // 阶段五：BOSS 登场特效（暗色光环 + 屏幕震动）
                if (window.EnemyFx) window.EnemyFx.bossSpawn(enemy.x, enemy.y);
                if (window.DomFx) window.DomFx.shake(12, 600);
                // 阶段八：Lottie BOSS 登场动画（失败回退 CSS 紫色光芒）
                if (window.LottieFx && this.canvas) {
                    const rect = this.canvas.getBoundingClientRect();
                    const sx = rect.left + enemy.x;
                    const sy = rect.top + enemy.y;
                    window.LottieFx.play('boss-spawn', sx, sy, { scale: 1.0, timeout: 3000 });
                }
                // 阶段六：BOSS 登场音效 + 切换 BOSS 战 BGM
                if (window.AudioManager) {
                    window.AudioManager.playSound('boss-appear');
                    window.AudioManager.playBGM('bgm-boss');
                }
            }
        }

        // ===== 12 生肖 BOSS 技能 =====
        _updateBossSkill(boss, dt, now) {
            switch (boss.type) {
                case 'boss-rat': // 召唤鼠群
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 5;
                        for (let i = 0; i < 2; i++) {
                            const d = pickRandom((window.GameData.ENEMY_DATA.normal || []));
                            const add = new Enemy(d, boss.lane, { hpMul: 0.6 });
                            add.x = boss.x; add.y = boss.y;
                            add.pathIndex = boss.pathIndex;
                            this._pendingSpawns.push(add);
                        }
                    }
                    break;
                case 'boss-ox': // 冲撞眩晕
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 6;
                        this.towers.forEach(t => {
                            const d = Math.sqrt((t.x - boss.x) ** 2 + (t.y - boss.y) ** 2);
                            if (d < 160) t.stunnedUntil = now + 2000;
                        });
                        this._addFloat(boss.x, boss.y - 20, '眩晕!', '#FFA500');
                    }
                    break;
                case 'boss-rabbit': // 闪避+远程
                    if (boss.dodge < 0.4) boss.dodge = 0.4;
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 3;
                        const targets = this.towers.filter(t => now >= t.stunnedUntil);
                        if (targets.length) {
                            const t = pickRandom(targets);
                            t.stunnedUntil = now + 1500;
                            this._addFloat(t.x, t.y - 20, '远程命中', '#DDA0DD');
                        }
                    }
                    break;
                case 'boss-dragon': // AOE+水柱
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 4;
                        if (this.towers.length) {
                            const t = pickRandom(this.towers);
                            this.towers.forEach(tt => {
                                const d = Math.sqrt((tt.x - t.x) ** 2 + (tt.y - t.y) ** 2);
                                if (d < 110) tt.stunnedUntil = now + 2000;
                            });
                            this._addFloat(t.x, t.y - 20, '水柱!', '#1E90FF');
                        }
                    }
                    break;
                case 'boss-snake': // 中毒+隐身（周期隐身）
                    boss.invisibleTimer -= dt;
                    if (boss.invisible) {
                        if (boss.invisibleTimer <= 0) { boss.invisible = false; boss.invisibleTimer = 3; }
                    } else {
                        if (boss.invisibleTimer <= 0) { boss.invisible = true; boss.invisibleTimer = 2; }
                    }
                    break;
                case 'boss-horse': // 冲锋+践踏（周期加速）
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 4;
                        boss.speed = boss.data.speed * 2;
                        setTimeout(() => { if (boss.alive) boss.speed = boss.data.speed; }, 1000);
                        this._addFloat(boss.x, boss.y - 20, '冲锋!', '#8B4513');
                    }
                    break;
                case 'boss-sheep': // 治疗+护盾（修复：护盾改为周期性补盾，非每帧）
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 3;
                        // 周期性补盾50 + 治疗光环
                        boss.shield = Math.max(boss.shield, 50);
                        this.enemies.forEach(e => {
                            if (e.alive && e !== boss) {
                                e.hp = Math.min(e.maxHp, e.hp + 20);
                            }
                        });
                        this._addFloat(boss.x, boss.y - 20, '治疗光环', '#F5DEB3');
                    }
                    break;
                case 'boss-monkey': // 分身
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 6;
                        const d = (window.GameData.ENEMY_DATA.normal || []).find(e => e.id === 'monkey-demon') || pickRandom((window.GameData.ENEMY_DATA.normal || []));
                        const illu = new Enemy(d, boss.lane, { hpMul: 0.3 });
                        illu.x = boss.x; illu.y = boss.y; illu.pathIndex = boss.pathIndex;
                        this._pendingSpawns.push(illu);
                    }
                    break;
                case 'boss-rooster': // 群体增益+火焰
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 4;
                        this.enemies.forEach(e => {
                            if (e.alive && e !== boss) {
                                const d = Math.sqrt((e.x - boss.x) ** 2 + (e.y - boss.y) ** 2);
                                if (d < 200) e.speed = e.data.speed * 1.3;
                            }
                        });
                        if (this.towers.length) {
                            const t = pickRandom(this.towers);
                            t.stunnedUntil = now + 1500;
                            this._addFloat(t.x, t.y - 20, '火焰!', '#FF4500');
                        }
                    }
                    break;
                case 'boss-pig': // 全屏 AOE+万象
                    boss.skillTimer -= dt;
                    if (boss.skillTimer <= 0) {
                        boss.skillTimer = 7;
                        this.lives = Math.max(0, this.lives - 1);
                        this._updateLivesUI();
                        this._addFloat(this.lamp.x, this.lamp.y - 20, '万象 AOE!', '#8A2BE2');
                        // 阶段十：BOSS AOE 造成主灯受损
                        this._levelNoDamage = false;
                    }
                    break;
                case 'boss-tiger': // 分裂在死亡时处理
                case 'boss-dog': // 三头攻击通过 lampDamage 体现
                default:
                    break;
            }
        }

        // ===== 敌人死亡奖励 =====
        _onEnemyDeath(enemy) {
            if (enemy._rewarded) return;
            enemy._rewarded = true;

            // 阶段五：敌人死亡特效
            if (window.EnemyFx) {
                if (enemy.isBoss) {
                    window.EnemyFx.bossDeath(enemy.x, enemy.y);
                    if (window.DomFx) window.DomFx.shake(8, 400);
                } else {
                    window.EnemyFx.enemyDeath(enemy.x, enemy.y, enemy.color);
                }
            }

            // 阶段八：Lottie 敌人死亡动画（失败回退 CSS 红色爆裂）
            if (window.LottieFx && this.canvas) {
                const rect = this.canvas.getBoundingClientRect();
                const sx = rect.left + enemy.x;
                const sy = rect.top + enemy.y;
                const scale = enemy.isBoss ? 2.0 : (enemy.isElite ? 1.2 : 0.8);
                window.LottieFx.play('enemy-death', sx, sy, { scale, timeout: 1500 });
            }

            // 阶段六：敌人死亡 / BOSS 死亡音效
            if (window.AudioManager) {
                window.AudioManager.playSound(enemy.isBoss ? 'boss-death' : 'enemy-death', enemy.isBoss ? 1.0 : 0.5);
            }

            const r = enemy.reward || {};
            if (r.coins) {
                window.GameState.addCoins(r.coins);
                this._addFloat(enemy.x, enemy.y, `+${r.coins}💰`, '#FFD700');
            }
            if (r.scrolls) window.GameState.addScrolls(r.scrolls);
            if (r.inspiration) window.GameState.addInspiration(r.inspiration);
            // 人气抽牌：普通 10 / 精英 30 / BOSS 100（遗物 popularity-surge 倍率加成）
            const basePop = enemy.isBoss ? 100 : (enemy.isElite ? 30 : 10);
            const popMul = window.RelicSystem ? RelicSystem.getPopularityBonus() : 1;
            this.cardSystem.addPopularity(Math.round(basePop * popMul));

            // 寅虎分裂
            if (enemy.isBoss && enemy.type === 'boss-tiger' && !enemy.split) {
                enemy.split = true;
                const d = (window.GameData.ENEMY_DATA.elite || []).find(e => e.id === 'tiger-demon') || pickRandom((window.GameData.ENEMY_DATA.elite || []));
                for (let i = 0; i < 2; i++) {
                    const cub = new Enemy(d, enemy.lane, { hpMul: 0.5, isElite: true });
                    cub.x = enemy.x; cub.y = enemy.y; cub.pathIndex = enemy.pathIndex;
                    this._pendingSpawns.push(cub);
                }
                this._addFloat(enemy.x, enemy.y - 20, '分裂!', '#DC143C');
            }

            // 阶段十：留存系统——击杀上报 + 成就节流检查
            this._killCount = (this._killCount || 0) + 1;
            if (window.DailyTasks) {
                try { DailyTasks.updateProgress('defeat-enemies', 1); } catch (e) { /* ignore */ }
            }
            // 每击杀 10 个敌人检查一次成就（避免每帧遍历全部成就）
            if (this._killCount % 10 === 0 && window.Achievements) {
                try { Achievements.checkAll(); } catch (e) { /* ignore */ }
            }
        }

        // ===== 渲染 =====
        _render(now) {
            const ctx = this.ctx;
            if (!ctx) return;
            // 背景
            ctx.fillStyle = '#3a5a3a';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            // 草地纹理（网格）
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            for (let c = 0; c <= GRID_COLS; c++) {
                ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, CANVAS_H); ctx.stroke();
            }
            for (let r = 0; r <= GRID_ROWS; r++) {
                ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(CANVAS_W, r * CELL); ctx.stroke();
            }
            // 路径（增强：发光石板路 + 流动方向箭头）
            const flowPhase = (this._gameTime || 0) * 2; // 流动动画相位
            this.pathCells.forEach(key => {
                const [c, r] = key.split(',').map(Number);
                const x = c * CELL, y = r * CELL;
                // 石板路面：暖棕色渐变
                const grad = ctx.createLinearGradient(x, y, x, y + CELL);
                grad.addColorStop(0, '#C4A672');
                grad.addColorStop(0.5, '#A0826D');
                grad.addColorStop(1, '#8B6F4E');
                ctx.fillStyle = grad;
                ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
                // 石板缝隙
                ctx.strokeStyle = 'rgba(80,55,30,0.4)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
                // 顶部高光
                ctx.fillStyle = 'rgba(255,240,200,0.2)';
                ctx.fillRect(x + 2, y + 2, CELL - 4, 3);
            });
            // 绘制路径方向箭头（增强：金色发光 + 流动效果）
            this.lanes.forEach(lane => {
                for (let i = 0; i < lane.length - 1; i++) {
                    const p1 = lane[i], p2 = lane[i + 1];
                    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    // 流动透明度：箭头随时间脉动
                    const pulse = 0.5 + 0.4 * Math.sin(flowPhase + i * 0.5);
                    ctx.save();
                    ctx.translate(mx, my);
                    ctx.rotate(angle);
                    // 发光底
                    ctx.shadowColor = '#FFD700';
                    ctx.shadowBlur = 6;
                    ctx.fillStyle = `rgba(255,220,80,${pulse})`;
                    ctx.beginPath();
                    ctx.moveTo(8, 0);
                    ctx.lineTo(-5, -6);
                    ctx.lineTo(-5, 6);
                    ctx.closePath();
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.restore();
                }
            });
            // 主灯 + 血条
            if (this.lamp) {
                ctx.save();
                ctx.translate(this.lamp.x, this.lamp.y);
                ctx.fillStyle = '#FFD700';
                ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
                ctx.font = '24px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('🏮', 0, 0);
                ctx.restore();
                // 灯笼血条
                const lampW = 50;
                const lampX = this.lamp.x - lampW / 2;
                const lampY = this.lamp.y - 30;
                const lampRatio = Math.max(0, this.lives / INIT_LIVES);
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(lampX - 1, lampY - 1, lampW + 2, 8);
                ctx.fillStyle = '#444';
                ctx.fillRect(lampX, lampY, lampW, 6);
                ctx.fillStyle = lampRatio > 0.5 ? '#228B22' : (lampRatio > 0.25 ? '#FFA500' : '#DC143C');
                ctx.fillRect(lampX, lampY, lampW * lampRatio, 6);
                // 血量数字
                ctx.font = 'bold 11px Arial';
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.strokeStyle = 'rgba(0,0,0,0.8)';
                ctx.lineWidth = 3;
                ctx.strokeText(`${this.lives}`, this.lamp.x, lampY - 2);
                ctx.fillText(`${this.lives}`, this.lamp.x, lampY - 2);
            }
            // 塔
            this.towers.forEach(t => this._drawTower(t, now));
            // 敌人
            this.enemies.forEach(e => this._drawEnemy(e));
            // 投射物
            this.projectiles.forEach(p => {
                const k = p.t / p.dur;
                const x = p.x + (p.tx - p.x) * k;
                const y = p.y + (p.ty - p.y) * k;
                ctx.fillStyle = '#FFD700';
                ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
            });
            // 浮动文字
            this.floats.forEach(f => {
                ctx.save();
                ctx.globalAlpha = Math.max(0, 1 - f.t);
                ctx.fillStyle = f.color;
                ctx.font = 'bold 14px "Noto Serif SC", serif';
                ctx.textAlign = 'center';
                ctx.fillText(f.text, f.x, f.y);
                ctx.restore();
            });
            // 放置预览
            if (this.placementMode && this.hoverCell && this.placementCard) {
                this._drawPlacementPreview();
            }

            // 阶段五：绘制战斗特效 + 敌人特效粒子（在最上层）
            if (window.BattleFx) window.BattleFx.draw(ctx);
            if (window.EnemyFx) window.EnemyFx.draw(ctx);
        }

        _drawTower(t, now) {
            const ctx = this.ctx;
            // 选中/放置时显示射程
            if (this.selectedTower === t || this.movingTower === t) {
                ctx.save();
                ctx.strokeStyle = this.movingTower === t ? 'rgba(30,144,255,0.8)' : 'rgba(255,215,0,0.6)';
                ctx.fillStyle = this.movingTower === t ? 'rgba(30,144,255,0.12)' : 'rgba(255,215,0,0.08)';
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.restore();
                if (this.movingTower === t) {
                    ctx.save();
                    ctx.font = '12px Arial';
                    ctx.fillStyle = '#1E90FF';
                    ctx.textAlign = 'center';
                    ctx.fillText('点击空位移动', t.x, t.y - 40);
                    ctx.restore();
                }
            }

            // 攻击后坐力（150ms内缩放回弹）
            const attackDelta = now - (t.lastAttackTime || 0);
            const recoil = attackDelta < 150 ? 1 - 0.12 * (1 - attackDelta / 150) : 1;

            // 瞄准角度
            let aimAngle = 0;
            if (t.target) {
                aimAngle = Math.atan2(t.target.y - t.y, t.target.x - t.x);
            }

            const _ich = ichData(t.heritageId) || {};
            const bodyColor = _ich.color || (t.card && t.card.color) || '#888';
            const roofColor = _ich.roofColor || (t.card && t.card.roofColor) || '#555';

            ctx.save();
            ctx.translate(t.x, t.y);

            // === 地面阴影 ===
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(0, 8, 22, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            // === 等距石台底座 ===
            const bW = 22, bH = 11;
            // 侧面
            ctx.fillStyle = '#5C4033';
            ctx.beginPath();
            ctx.moveTo(-bW, 0); ctx.lineTo(0, bH); ctx.lineTo(bW, 0); ctx.lineTo(bW, -3);
            ctx.lineTo(0, bH - 3); ctx.lineTo(-bW, -3); ctx.closePath();
            ctx.fill();
            // 顶面
            const baseGrad = ctx.createLinearGradient(0, -bH, 0, bH);
            baseGrad.addColorStop(0, '#8B7355');
            baseGrad.addColorStop(1, '#6B5D4F');
            ctx.fillStyle = baseGrad;
            ctx.beginPath();
            ctx.moveTo(0, -bH); ctx.lineTo(bW, 0); ctx.lineTo(0, bH); ctx.lineTo(-bW, 0);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#4A3525'; ctx.lineWidth = 1;
            ctx.stroke();

            // === 塔身（带后坐力缩放）===
            const s = recoil;
            const bodyW = 18 * s, bodyH = 26 * s;
            const bodyTop = -bH - bodyH;
            // 塔身主体
            const bodyGrad = ctx.createLinearGradient(-bodyW/2, 0, bodyW/2, 0);
            bodyGrad.addColorStop(0, this._lightenHex(bodyColor, 20));
            bodyGrad.addColorStop(0.5, bodyColor);
            bodyGrad.addColorStop(1, this._darkenHex(bodyColor, 20));
            ctx.fillStyle = bodyGrad;
            ctx.fillRect(-bodyW/2, bodyTop, bodyW, bodyH);
            // 塔身底部圆角
            ctx.beginPath();
            ctx.arc(0, bodyTop + bodyH, bodyW/2, 0, Math.PI);
            ctx.fill();
            // 塔身装饰带（顶部和底部各一条金色线）
            ctx.fillStyle = 'rgba(255,215,0,0.4)';
            ctx.fillRect(-bodyW/2, bodyTop + 2, bodyW, 1.5);
            ctx.fillRect(-bodyW/2, bodyTop + bodyH - 4, bodyW, 1.5);

            // === 屋顶（中式飞檐）===
            const roofH = 14 * s;
            const eaveW = bodyW / 2 + 5;
            ctx.fillStyle = roofColor;
            ctx.beginPath();
            ctx.moveTo(-eaveW, bodyTop + 2);        // 左檐角
            ctx.quadraticCurveTo(-eaveW + 2, bodyTop - 2, -bodyW/2, bodyTop - 1); // 左上翘
            ctx.lineTo(0, bodyTop - roofH);          // 屋脊
            ctx.lineTo(bodyW/2, bodyTop - 1);        // 右下
            ctx.quadraticCurveTo(eaveW - 2, bodyTop - 2, eaveW, bodyTop + 2);     // 右檐角
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1;
            ctx.stroke();
            // 屋顶尖饰
            ctx.fillStyle = '#FFD700';
            ctx.beginPath();
            ctx.arc(0, bodyTop - roofH - 1, 2, 0, Math.PI * 2);
            ctx.fill();

            // === emoji 图标 ===
            ctx.font = '13px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(t.emoji, 0, bodyTop + bodyH / 2);

            // === 瞄准指示器（小箭头指向目标）===
            if (t.target) {
                ctx.save();
                ctx.rotate(aimAngle);
                ctx.fillStyle = 'rgba(255,215,0,0.8)';
                ctx.beginPath();
                ctx.moveTo(bodyW / 2 + 4, 0);
                ctx.lineTo(bodyW / 2 + 10, -3);
                ctx.lineTo(bodyW / 2 + 10, 3);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // === 等级星星 ===
            const starY = bH + 6;
            const starSz = 4;
            const starGap = 6;
            const totalW = (t.level - 1) * starGap;
            for (let i = 0; i < t.level; i++) {
                const sx = -totalW / 2 + i * starGap;
                this._drawStar(ctx, sx, starY, starSz, '#FFD700');
            }

            // === 眩晕效果 ===
            if (now < t.stunnedUntil) {
                const stunRot = (now / 200) % (Math.PI * 2);
                ctx.save();
                ctx.translate(0, bodyTop - roofH - 8);
                ctx.rotate(stunRot);
                ctx.font = '10px Arial'; ctx.textAlign = 'center';
                ctx.fillText('💫', 8, 0);
                ctx.restore();
            }

            ctx.restore();
        }

        _drawStar(ctx, x, y, size, color) {
            ctx.fillStyle = color;
            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
                const ia = a + Math.PI / 5;
                const px = x + Math.cos(a) * size;
                const py = y + Math.sin(a) * size;
                const ix = x + Math.cos(ia) * size * 0.4;
                const iy = y + Math.sin(ia) * size * 0.4;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                ctx.lineTo(ix, iy);
            }
            ctx.closePath();
            ctx.fill();
        }

        _lightenHex(hex, pct) {
            return this._shiftHex(hex, pct);
        }
        _darkenHex(hex, pct) {
            return this._shiftHex(hex, -pct);
        }
        _shiftHex(hex, pct) {
            hex = hex.replace('#', '');
            if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            const amt = Math.round(255 * pct / 100);
            const nr = Math.max(0, Math.min(255, r + amt));
            const ng = Math.max(0, Math.min(255, g + amt));
            const nb = Math.max(0, Math.min(255, b + amt));
            return '#' + [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
        }

        _drawEnemy(e) {
            const ctx = this.ctx;
            ctx.save();
            ctx.globalAlpha = e.alive ? (e.invisible ? 0.3 : 1) : Math.max(0, e.deathTimer / 0.5);
            ctx.translate(e.x, e.y);
            const radius = e.isBoss ? 22 : (e.isElite ? 16 : 12);

            // ===== 运动动画：弹跳 + 摇摆 =====
            const bounceFreq = e.isBoss ? 3 : 6; // Boss慢弹，小怪快弹
            const bounceAmp = e.isBoss ? 4 : 6;
            const bounceY = e.alive ? -Math.abs(Math.sin(e._animTime * bounceFreq)) * bounceAmp : 0;
            const swingAngle = e.alive ? Math.sin(e._animTime * bounceFreq * 1.3) * 0.08 : 0; // 轻微摇摆
            // 死亡动画：缩小+旋转
            const deathScale = e.alive ? 1 : (e.deathTimer / 0.5);
            const deathRot = e.alive ? 0 : (1 - e.deathTimer / 0.5) * 0.8;
            ctx.translate(0, bounceY);
            ctx.rotate(swingAngle + deathRot);
            ctx.scale(deathScale, deathScale);

            // 受击闪烁：红色叠加
            const hitFlashing = e._hitFlash > 0;

            // ===== 阶段八：优先使用敌人立绘图片，失败回退 emoji =====
            const imgKey = 'enemy-' + e.type;
            const useImage = window.AssetLoader && window.AssetLoader.has(imgKey);

            if (useImage) {
                const img = window.AssetLoader.get(imgKey);
                if (img) {
                    const size = e.isBoss ? 128 : 64;
                    // BOSS 紫色光环
                    if (e.isBoss) {
                        const grad = ctx.createRadialGradient(0, 0, size * 0.3, 0, 0, size * 0.75);
                        grad.addColorStop(0, 'rgba(160, 80, 255, 0.5)');
                        grad.addColorStop(1, 'rgba(160, 80, 255, 0)');
                        ctx.fillStyle = grad;
                        ctx.beginPath();
                        ctx.arc(0, 0, size * 0.75, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    // 受击闪烁：红色滤镜叠加
                    if (hitFlashing) {
                        ctx.save();
                        ctx.drawImage(img, -size / 2, -size / 2, size, size);
                        ctx.globalCompositeOperation = 'source-atop';
                        ctx.fillStyle = 'rgba(255, 50, 50, 0.5)';
                        ctx.fillRect(-size / 2, -size / 2, size, size);
                        ctx.restore();
                    } else {
                        ctx.drawImage(img, -size / 2, -size / 2, size, size);
                    }
                    // 精英金色边框
                    if (e.isElite && !e.isBoss) {
                        ctx.strokeStyle = '#FFD700';
                        ctx.lineWidth = 2;
                        ctx.strokeRect(-size / 2, -size / 2, size, size);
                    }
                    // BOSS 紫色边框
                    if (e.isBoss) {
                        ctx.strokeStyle = '#9400D3';
                        ctx.lineWidth = 3;
                        ctx.strokeRect(-size / 2, -size / 2, size, size);
                    }
                    ctx.restore();
                    // 血条（立绘上方）
                    if (e.alive) {
                        this._drawEnemyHpBar(ctx, e, e.isBoss ? 64 : 40);
                    }
                    return;
                }
            }

            // ===== 回退：圆形底 + emoji 文字 =====
            ctx.fillStyle = hitFlashing ? '#FF6347' : e.color; // 受击变红
            ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
            // emoji
            ctx.font = (e.isBoss ? 26 : 16) + 'px Arial';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const emoji = e.isBoss ? (BOSS_EMOJI[e.type] || '⭐') : (e.isElite ? ELITE_EMOJI : NORMAL_EMOJI);
            ctx.fillText(emoji, 0, 0);
            ctx.restore();
            // 血条 + 血量数字
            if (e.alive) {
                this._drawEnemyHpBar(ctx, e, e.isBoss ? 50 : (e.isElite ? 36 : 26));
            }
        }

        /** 绘制敌人血条 + 血量数字（抽出公共逻辑） */
        _drawEnemyHpBar(ctx, e, w) {
            const x = e.x - w / 2;
            const y = e.y - (e.isBoss ? 70 : 36);
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(x - 1, y - 1, w + 2, 6);
            ctx.fillStyle = '#444';
            ctx.fillRect(x, y, w, 4);
            const ratio = Math.max(0, e.displayHp / e.maxHp);
            ctx.fillStyle = ratio > 0.5 ? '#228B22' : (ratio > 0.25 ? '#FFA500' : '#DC143C');
            ctx.fillRect(x, y, w * ratio, 4);
            if (e.shield > 0) {
                ctx.fillStyle = '#1E90FF';
                ctx.fillRect(x, y - 3, w * Math.min(1, e.shield / e.maxHp), 2);
            }
            // 血量数字
            ctx.font = '10px Arial';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.strokeStyle = 'rgba(0,0,0,0.8)';
            ctx.lineWidth = 3;
            const hpText = `${Math.ceil(e.displayHp)}`;
            ctx.strokeText(hpText, e.x, y - 4);
            ctx.fillText(hpText, e.x, y - 4);
        }

        _drawPlacementPreview() {
            const ctx = this.ctx;
            const { col, row } = this.hoverCell;
            const card = this.placementCard;
            // 检查是否点击在同名塔上（可升级）
            const existingTower = this.towers.find(t => t.col === col && t.row === row && t.heritageId === card.heritageId);
            const canUpgrade = existingTower && existingTower.level < MAX_TOWER_LEVEL;
            const canPlace = this._canPlace(col, row);
            const valid = canPlace || canUpgrade;

            ctx.save();
            // 绿色=可新建，蓝色=可升级，红色=不可
            ctx.fillStyle = canUpgrade ? 'rgba(30,144,255,0.4)' : (canPlace ? 'rgba(34,139,34,0.4)' : 'rgba(220,20,60,0.4)');
            ctx.fillRect(col * CELL, row * CELL, CELL, CELL);
            ctx.strokeStyle = canUpgrade ? '#1E90FF' : (canPlace ? '#228B22' : '#DC143C');
            ctx.lineWidth = 2;
            ctx.strokeRect(col * CELL, row * CELL, CELL, CELL);
            if (valid && card) {
                ctx.fillStyle = 'rgba(255,215,0,0.15)';
                ctx.strokeStyle = 'rgba(255,215,0,0.5)';
                ctx.beginPath();
                ctx.arc(col * CELL + CELL / 2, row * CELL + CELL / 2, card.range, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();
                ctx.font = '22px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(card.emoji, col * CELL + CELL / 2, row * CELL + CELL / 2);
                if (canUpgrade) {
                    ctx.font = '12px Arial';
                    ctx.fillStyle = '#1E90FF';
                    ctx.fillText(`升级 Lv.${existingTower.level}→${existingTower.level + 1}`, col * CELL + CELL / 2, row * CELL + CELL - 8);
                }
            }
            ctx.restore();
        }

        // ===== 放置交互 =====
        _canPlace(col, row) {
            if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;
            if (this.pathCells.has(`${col},${row}`)) return false;
            if (this.occupiedCells.has(`${col},${row}`)) return false;
            return true;
        }

        _hasEmptyCell() {
            for (let c = 0; c < GRID_COLS; c++) {
                for (let r = 0; r < GRID_ROWS; r++) {
                    if (this._canPlace(c, r)) return true;
                }
            }
            return false;
        }

        _onCanvasMove(e) {
            if (!this.placementMode) return;
            const cell = this._eventToCell(e);
            this.hoverCell = cell;
        }

        _onCanvasClick(e) {
            const cell = this._eventToCell(e);
            if (!cell) return;
            if (this.placementMode) {
                this._confirmPlacement(cell.col, cell.row);
                return;
            }
            // 准备阶段：移动塔
            if (this.prepPhase && this.movingTower) {
                // 点击空位 → 移动塔
                if (this._canPlace(cell.col, cell.row)) {
                    const oldCol = this.movingTower.gridX;
                    const oldRow = this.movingTower.gridY;
                    this.occupiedCells.delete(`${oldCol},${oldRow}`);
                    this.movingTower.gridX = cell.col;
                    this.movingTower.gridY = cell.row;
                    this.movingTower.x = cell.col * CELL + CELL / 2;
                    this.movingTower.y = cell.row * CELL + CELL / 2;
                    this.occupiedCells.add(`${cell.col},${cell.row}`);
                    this._toast(`塔已移动`, 'success');
                    this.movingTower = null;
                } else {
                    this._toast('该位置无法放置', 'error');
                }
                return;
            }
            // 点击已有塔
            const tower = this.towers.find(t => t.gridX === cell.col && t.gridY === cell.row);
            if (tower) {
                if (this.prepPhase) {
                    // 准备阶段：选中塔准备移动
                    this.movingTower = tower;
                    this.selectedTower = tower;
                    this._showTowerInfo(tower);
                    this._toast('点击空位移动塔，或点击其他塔切换', 'info');
                } else {
                    this.selectedTower = tower;
                    this._showTowerInfo(tower);
                }
            } else {
                this.movingTower = null;
                this.selectedTower = null;
                this._hideTowerInfo();
            }
        }

        _eventToCell(e) {
            if (!this.canvas) return null;
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = CANVAS_W / rect.width;
            const scaleY = CANVAS_H / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            return { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
        }

        _startPlacement(card, index) {
            this.placementMode = true;
            this.placementCard = card;
            this.placementIndex = index;
            this.hoverCell = null;
            this._toast(`点击地图放置「${card.name}」，ESC或右键取消`, 'info');
        }

        _cancelPlacement() {
            this.placementMode = false;
            this.placementCard = null;
            this.placementIndex = -1;
            this.hoverCell = null;
            this.movingTower = null;
        }

        _confirmPlacement(col, row) {
            if (!this.placementCard) return;
            const card = this.placementCard;
            const index = this.placementIndex;

            // 检查点击位置是否有同名塔（可升级）
            const existingTower = this.towers.find(t => t.gridX === col && t.gridY === row && t.heritageId === card.heritageId);
            if (existingTower) {
                if (existingTower.level >= MAX_TOWER_LEVEL) {
                    this._toast('该塔已满级', 'error');
                    return;
                }
                // 三合一：需要场上另一个同级同名塔 + 手牌1张
                const otherSame = this.towers.find(t => t !== existingTower && t.heritageId === card.heritageId && t.level === existingTower.level);
                if (otherSame) {
                    // 消耗场上另一个同级塔 + 手牌
                    this.towers = this.towers.filter(t => t !== otherSame);
                    this.occupiedCells.delete(`${otherSame.gridX},${otherSame.gridY}`);
                    existingTower.upgrade();
                    this._toast(`三合一！${card.name} 升级至 Lv.${existingTower.level}`, 'success');
                } else {
                    this._toast('需要场上另一个同级同名塔才能三合一升级', 'error');
                    return;
                }
                // 放置成功才消耗手牌
                this.cardSystem.playCard(index);
                this.cardSystem.addToDiscard(card);
                this._cancelPlacement();
                this._renderHand();
                this._checkFieldMerge();
                return;
            }

            // 新建塔
            if (!this._canPlace(col, row)) {
                this._toast('该位置无法放置', 'error');
                return;
            }
            // 塔防中所有塔初始都是1级，不受经营界面等级影响
            const mergeBonus = (card.mergeLevel || 1) - 1;
            const finalLevel = Math.min(MAX_TOWER_LEVEL, 1 + mergeBonus);
            const tower = new Tower(card, col, row, finalLevel);
            this.towers.push(tower);
            this.occupiedCells.add(`${col},${row}`);
            // 放置成功才消耗手牌
            this.cardSystem.playCard(index);
            this.cardSystem.addToDiscard(card);
            this._cancelPlacement();
            this._renderHand();
            this._toast(`放置 ${card.name} Lv.${tower.level}`, 'success');
            // 检查场上是否有3个同级同名塔可自动三合一
            this._checkFieldMerge();
        }

        /**
         * 检查场上是否有3个同级同名塔，自动三合一升级
         * 3个同级同名 → 消耗2个，1个升级+1
         */
        _checkFieldMerge() {
            // 按heritageId+level分组
            const groups = {};
            this.towers.forEach(t => {
                const key = `${t.heritageId}_${t.level}`;
                if (!groups[key]) groups[key] = [];
                groups[key].push(t);
            });
            for (const key in groups) {
                const group = groups[key];
                if (group.length >= 3 && group[0].level < MAX_TOWER_LEVEL) {
                    // 保留第一个，消耗后两个
                    const keep = group[0];
                    const consume = group.slice(1, 3);
                    this.towers = this.towers.filter(t => !consume.includes(t));
                    consume.forEach(t => this.occupiedCells.delete(`${t.gridX},${t.gridY}`));
                    keep.upgrade();
                    this._toast(`场上三合一！${keep.name} 升级至 Lv.${keep.level}`, 'success');
                    // 递归检查是否还能继续合并
                    this._checkFieldMerge();
                    return;
                }
            }
        }

        // ===== 手牌 =====
        _renderHand() {
            const area = document.getElementById('td-hand-area');
            if (!area || !this.cardSystem) return;
            area.innerHTML = '';
            this.cardSystem.hand.forEach((card, idx) => {
                const el = document.createElement('div');
                const mergeLevel = card.mergeLevel || 1;
                el.className = 'td-card' + (mergeLevel > 1 ? ' td-card-merged' : '');
                // 阶段八：卡牌图标优先用图片，失败回退 emoji
                let iconHtml;
                const imgKey = card.heritageId ? 'building-' + card.heritageId : null;
                if (imgKey && window.AssetLoader && window.AssetLoader.has(imgKey)) {
                    iconHtml = `<div class="td-card-icon" style="background-image:url('assets/images/buildings/${card.heritageId}.png')"></div>`;
                } else {
                    iconHtml = `<div class="td-card-emoji">${card.emoji}</div>`;
                }
                el.innerHTML = `
                    ${iconHtml}
                    <div class="td-card-name">${card.name}</div>
                    <div class="td-card-type">${card.towerType}</div>
                    <div class="td-card-stat">伤${card.damage} · 射${card.range}</div>
                    ${mergeLevel > 1 ? `<div class="td-card-merge">合并 Lv+${mergeLevel - 1}</div>` : ''}`;
                el.addEventListener('click', () => this._onCardClick(idx));
                area.appendChild(el);
            });
            // 补足空槽位
            for (let i = this.cardSystem.hand.length; i < MAX_HAND; i++) {
                const empty = document.createElement('div');
                empty.className = 'td-card td-card-empty';
                area.appendChild(empty);
            }
        }

        _onCardClick(index) {
            const card = this.cardSystem.hand[index];
            if (!card) return;
            // 如果在放置模式，点击同一张牌则取消，点击不同牌则切换
            if (this.placementMode) {
                if (this.placementIndex === index) {
                    this._cancelPlacement();
                    return;
                }
                // 切换到新卡牌，不消耗旧卡牌
                this.placementCard = card;
                this.placementIndex = index;
                this._toast(`切换为「${card.name}」，ESC取消`, 'info');
                return;
            }
            // 进入放置模式，但不消耗手牌
            this._startPlacement(card, index);
        }

        /** 手动抽卡 */
        _manualDrawCard() {
            if (!this.cardSystem) return;
            if (this.cardSystem.hand.length >= MAX_HAND) {
                this._toast('手牌已满', 'error');
                return;
            }
            if (this.cardSystem.popularity < this.cardSystem.popularityPerCard) {
                this._toast(`人气不足（需要${this.cardSystem.popularityPerCard}）`, 'error');
                return;
            }
            const card = this.cardSystem.manualDraw();
            if (card) {
                this._playDrawAnimation(card);
                this._renderHand();
                this._toast(`抽到「${card.name}」`, 'success');
            }
        }

        // ===== 阶段十二：看广告免费抽卡 =====
        _freeDrawCardViaAd() {
            if (!this.cardSystem) return;
            if (!window.AdSystem) {
                this._toast('广告系统未加载', 'error');
                return;
            }
            if (this.cardSystem.hand.length >= MAX_HAND) {
                this._toast('手牌已满', 'error');
                return;
            }
            const check = AdSystem.canWatchReward('free-draw');
            if (!check.canWatch) {
                this._toast(check.reason, 'error');
                return;
            }
            // 播放广告，成功后免费抽1张卡（不消耗人气）
            AdSystem.showRewardAd('free-draw', () => {
                if (!this.cardSystem) return;
                if (this.cardSystem.hand.length >= MAX_HAND) {
                    this._toast('手牌已满，免费抽卡未生效', 'error');
                    return;
                }
                // 直接调用 drawCard，跳过 manualDraw 的人气扣费
                const card = this.cardSystem.drawCard();
                if (card) {
                    this._playDrawAnimation(card);
                    this._renderHand();
                    this._updatePopularityUI();
                    this._toast(`免费抽到「${card.name}」`, 'success');
                    // 埋点
                    if (window.Analytics) Analytics.trackEvent('card_draw', { source: 'free-ad' });
                }
            }, (reason) => {
                this._toast(reason || '广告未完成', 'error');
            });
        }

        // ===== 阶段十二：复活续命弹窗（Canvas 绘制） =====
        _showRevivePrompt() {
            // 创建独立 overlay canvas
            if (this._reviveCanvas) this._closeRevivePrompt(false);
            const canvas = document.createElement('canvas');
            canvas.id = 'td-revive-overlay';
            canvas.style.cssText = [
                'position:fixed', 'inset:0', 'width:100%', 'height:100%',
                'z-index:99998', 'pointer-events:auto', 'background:rgba(0,0,0,0.75)'
            ].join(';');
            document.body.appendChild(canvas);
            this._reviveCanvas = canvas;
            this._reviveCtx = canvas.getContext('2d');
            this._reviveButtons = null; // { accept:{x,y,w,h}, decline:{x,y,w,h} }
            this._resizeReviveOverlay();
            this._reviveResizeHandler = () => this._resizeReviveOverlay();
            window.addEventListener('resize', this._reviveResizeHandler);
            canvas.addEventListener('click', (e) => this._onReviveCanvasClick(e));
            this._drawRevivePrompt();
            console.log('[阶段十二] 复活续命弹窗已显示');
        }

        _resizeReviveOverlay() {
            if (!this._reviveCanvas) return;
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth, h = window.innerHeight;
            this._reviveCanvas.width = w * dpr;
            this._reviveCanvas.height = h * dpr;
            this._reviveCanvas.style.width = w + 'px';
            this._reviveCanvas.style.height = h + 'px';
            this._reviveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            this._drawRevivePrompt();
        }

        _drawRevivePrompt() {
            const ctx = this._reviveCtx;
            if (!ctx) return;
            const w = window.innerWidth, h = window.innerHeight;

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._reviveCanvas.width, this._reviveCanvas.height);
            ctx.restore();

            // 半透明背景
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fillRect(0, 0, w, h);

            // 居中弹窗
            const boxW = Math.min(440, w * 0.88);
            const boxH = Math.min(260, h * 0.55);
            const boxX = (w - boxW) / 2;
            const boxY = (h - boxH) / 2;

            // 弹窗背景 + 金边
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(boxX, boxY, boxW, boxH);
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#FFD700';
            ctx.strokeRect(boxX, boxY, boxW, boxH);

            // 标题
            ctx.fillStyle = '#E63946';
            ctx.font = 'bold 22px "Noto Serif SC", serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('战斗失败', w / 2, boxY + 40);

            // 说明文字
            ctx.fillStyle = '#ffffff';
            ctx.font = '15px "Noto Serif SC", serif';
            ctx.fillText('观看广告即可复活续命', w / 2, boxY + 75);
            ctx.fillStyle = '#B89968';
            ctx.font = '13px "Noto Serif SC", serif';
            ctx.fillText('（主灯血量恢复50%，每关限1次）', w / 2, boxY + 100);

            // 两个按钮：看广告复活 / 放弃
            const btnW = (boxW - 60) / 2;
            const btnH = 44;
            const btnY = boxY + boxH - 60;
            const acceptX = boxX + 20;
            const declineX = boxX + 40 + btnW;

            // 复活按钮（金色）
            ctx.fillStyle = '#D4A84D';
            ctx.fillRect(acceptX, btnY, btnW, btnH);
            ctx.fillStyle = '#1A0F0A';
            ctx.font = 'bold 15px "Noto Serif SC", serif';
            ctx.fillText('🎬 看广告复活', acceptX + btnW / 2, btnY + btnH / 2);

            // 放弃按钮（暗色）
            ctx.fillStyle = '#3C2415';
            ctx.fillRect(declineX, btnY, btnW, btnH);
            ctx.strokeStyle = '#5C3A24';
            ctx.lineWidth = 1;
            ctx.strokeRect(declineX, btnY, btnW, btnH);
            ctx.fillStyle = '#B89968';
            ctx.font = '15px "Noto Serif SC", serif';
            ctx.fillText('放弃', declineX + btnW / 2, btnY + btnH / 2);

            this._reviveButtons = {
                accept: { x: acceptX, y: btnY, w: btnW, h: btnH },
                decline: { x: declineX, y: btnY, w: btnW, h: btnH }
            };

            // 重置对齐
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }

        _onReviveCanvasClick(e) {
            if (!this._reviveButtons) return;
            const rect = this._reviveCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const isIn = (btn) => x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h;
            if (isIn(this._reviveButtons.accept)) {
                this._closeRevivePrompt(true);
                // 播放广告，成功后复活
                AdSystem.showRewardAd('revive', () => {
                    this._applyRevive();
                }, (reason) => {
                    // 广告失败/取消 → 真正结束战斗
                    this._toast(reason || '广告未完成，无法复活', 'error');
                    this._showingRevive = false;
                    this.paused = false;
                    this._endBattle(false);
                });
            } else if (isIn(this._reviveButtons.decline)) {
                this._closeRevivePrompt(false);
            }
        }

        _applyRevive() {
            // 主灯血量恢复 50%
            this.lives = Math.max(1, Math.ceil(INIT_LIVES * 0.5));
            // 清理场上接近主灯的敌人（避免立即再次失败）
            this.enemies = this.enemies.filter(e => !e.alive || e.progress < 0.85);
            this._showingRevive = false;
            this.paused = false;
            this._updateLivesUI();
            this._toast('复活成功！主灯血量恢复50%', 'success');
            // 埋点
            if (window.Analytics) Analytics.trackEvent('ad_watch', { reward_type: 'revive', level: this.currentLevelId });
            console.log('[阶段十二] 复活续命已生效，主灯血量:', this.lives);
        }

        _closeRevivePrompt(accepted) {
            if (this._reviveResizeHandler) {
                window.removeEventListener('resize', this._reviveResizeHandler);
                this._reviveResizeHandler = null;
            }
            if (this._reviveCanvas && this._reviveCanvas.parentNode) {
                this._reviveCanvas.parentNode.removeChild(this._reviveCanvas);
            }
            this._reviveCanvas = null;
            this._reviveCtx = null;
            this._reviveButtons = null;
            if (!accepted) {
                // 用户放弃复活 → 真正结束战斗
                this._showingRevive = false;
                this.paused = false;
                if (!(this.endlessMode && this.endlessMode.running) && !this.pvpMode) {
                    this._endBattle(false);
                }
            }
        }

        // ===== 塔信息面板 =====
        _showTowerInfo(t) {
            const panel = document.getElementById('td-tower-info');
            if (!panel) return;
            panel.classList.remove('hidden');
            
            // 检查手牌中是否有同名卡可升级
            const hasCard = this.cardSystem.hand.some(c => c.heritageId === t.heritageId);
            const handSameCount = this.cardSystem.hand.filter(c => c.heritageId === t.heritageId).length;
            // 三合一：需要场上另一个同级同名塔（+手牌）或场上2个同级同名塔（自动）
            const sameLevelTowers = this.towers.filter(t2 => t2 !== t && t2.heritageId === t.heritageId && t2.level === t.level);
            const canUpgradeWithCard = t.level < MAX_TOWER_LEVEL && hasCard && sameLevelTowers.length >= 1;
            const canUpgradeFieldOnly = t.level < MAX_TOWER_LEVEL && sameLevelTowers.length >= 2;
            // 新增：手2场1 —— 场上无其他同级同名塔，但手牌有2张同名卡
            const canUpgradeWithTwoCards = t.level < MAX_TOWER_LEVEL && sameLevelTowers.length === 0 && handSameCount >= 2;
            const canUpgrade = canUpgradeWithCard || canUpgradeFieldOnly || canUpgradeWithTwoCards;
            
            panel.innerHTML = `
                <button class="td-info-close" id="td-info-close">✕</button>
                <div class="td-info-emoji">${t.emoji}</div>
                <h4>${t.name}</h4>
                <div class="td-info-row">等级：Lv.${t.level} ${t.level >= MAX_TOWER_LEVEL ? '(满级)' : ''}</div>
                <div class="td-info-row">类型：${t.towerType}</div>
                <div class="td-info-row">伤害：${t.damage}</div>
                <div class="td-info-row">射程：${Math.round(t.range)}</div>
                <div class="td-info-row">攻速：${t.attackSpeed}/秒</div>
                <div class="td-info-skill">技能：${t.skill ? t.skill.name + ' — ' + t.skill.description : '无'}</div>
                ${t.level < MAX_TOWER_LEVEL ? 
                    (canUpgrade ? 
                        `<button id="td-info-upgrade" class="td-info-upgrade-btn">三合一升级 → Lv.${t.level + 1}</button>` :
                        `<div class="td-info-hint">需要：场上2个同级同名塔，或1个同级塔+手牌1张，或手牌2张同名卡</div>`
                    ) : ''
                }`;
            const close = document.getElementById('td-info-close');
            if (close) close.addEventListener('click', () => { this.selectedTower = null; this._hideTowerInfo(); });
            
            // 升级按钮
            const upBtn = document.getElementById('td-info-upgrade');
            if (upBtn) {
                upBtn.addEventListener('click', () => {
                    const sameLevelTowers = this.towers.filter(t2 => t2 !== t && t2.heritageId === t.heritageId && t2.level === t.level);
                    // 情况1：场上有2个同级同名塔，直接三合一（不消耗手牌）
                    if (sameLevelTowers.length >= 2) {
                        const consume = sameLevelTowers.slice(0, 2);
                        this.towers = this.towers.filter(t2 => !consume.includes(t2));
                        consume.forEach(t2 => this.occupiedCells.delete(`${t2.gridX},${t2.gridY}`));
                        t.upgrade();
                        this._toast(`场上三合一！${t.name} 升级至 Lv.${t.level}`, 'success');
                        this._renderHand();
                        this._showTowerInfo(t);
                        this._checkFieldMerge();
                        return;
                    }
                    // 情况2：场上有1个同级同名塔 + 手牌1张
                    if (sameLevelTowers.length >= 1) {
                        const cardIdx = this.cardSystem.hand.findIndex(c => c.heritageId === t.heritageId);
                        if (cardIdx >= 0) {
                            const card = this.cardSystem.hand[cardIdx];
                            const other = sameLevelTowers[0];
                            this.towers = this.towers.filter(t2 => t2 !== other);
                            this.occupiedCells.delete(`${other.gridX},${other.gridY}`);
                            t.upgrade();
                            this._toast(`三合一！${t.name} 升级至 Lv.${t.level}`, 'success');
                            this.cardSystem.playCard(cardIdx);
                            this.cardSystem.addToDiscard(card);
                            this._renderHand();
                            this._showTowerInfo(t);
                            this._checkFieldMerge();
                            return;
                        }
                    }
                    // 情况3（新增）：手2场1 —— 场上无其他同级同名塔，手牌有2张同名卡
                    if (sameLevelTowers.length === 0) {
                        const indices = [];
                        this.cardSystem.hand.forEach((c, i) => {
                            if (c.heritageId === t.heritageId) indices.push(i);
                        });
                        if (indices.length >= 2) {
                            indices.sort((a, b) => b - a);
                            // 消耗2张手牌
                            for (let k = 0; k < 2; k++) {
                                const card = this.cardSystem.playCard(indices[k]);
                                this.cardSystem.addToDiscard(card);
                            }
                            t.upgrade();
                            this._toast(`手2场1合并！${t.name} 升级至 Lv.${t.level}`, 'success');
                            this._renderHand();
                            this._showTowerInfo(t);
                            this._checkFieldMerge();
                            return;
                        }
                    }
                    this._toast('无法升级：需要场上2个同级同名塔，或1个同级塔+手牌1张，或手牌2张同名卡', 'error');
                });
            }
        }

        _hideTowerInfo() {
            const panel = document.getElementById('td-tower-info');
            if (panel) panel.classList.add('hidden');
        }

        // ===== UI 更新 =====
        _updateLivesUI() {
            const el = document.getElementById('td-lives');
            if (el) el.textContent = this.lives;
        }
        _updateWaveUI() {
            const el = document.getElementById('td-wave');
            if (el) el.textContent = `${Math.min(this.currentWave, this.totalWaves)}/${this.totalWaves}`;
        }
        _updatePopularityUI() {
            const fill = document.getElementById('td-popularity-fill');
            const text = document.getElementById('td-popularity-text');
            const drawBtn = document.getElementById('td-draw-btn');
            if (fill && this.cardSystem) {
                const ratio = Math.min(100, this.cardSystem.popularity / this.cardSystem.popularityPerCard * 100);
                fill.style.height = ratio + '%';
            }
            if (text && this.cardSystem) {
                text.textContent = `${this.cardSystem.popularity}/${this.cardSystem.popularityPerCard}`;
            }
            // 抽卡按钮状态
            if (drawBtn && this.cardSystem) {
                const canDraw = this.cardSystem.popularity >= this.cardSystem.popularityPerCard 
                    && this.cardSystem.hand.length < MAX_HAND;
                drawBtn.disabled = !canDraw;
            }
        }
        _updateBossBar(boss) {
            const bar = document.getElementById('td-boss-bar');
            if (!bar) return;
            if (boss) {
                bar.classList.remove('hidden');
                const name = document.getElementById('td-boss-name');
                const fill = document.getElementById('td-boss-hp-fill');
                if (name) name.textContent = boss.name;
                if (fill) fill.style.width = Math.max(0, boss.displayHp / boss.maxHp * 100) + '%';
            } else {
                bar.classList.add('hidden');
            }
        }

        _playDrawAnimation(card) {
            // 阶段六：抽牌音效
            if (window.AudioManager) window.AudioManager.playSound('card-draw');
            // 阶段五：统一使用 UiFx 抽牌动画（宣纸画卷展开 + 毛笔字 + 红色印章）
            if (window.UiFx && card) {
                window.UiFx.playDrawCard(card, null);
                return;
            }
            // 兜底：原逻辑（UiFx 不可用时）
            const anim = document.getElementById('td-draw-anim');
            if (!anim || !card) return;
            anim.classList.remove('hidden');
            anim.innerHTML = `
                <div class="td-draw-scroll">
                    <div class="td-draw-name">${card.name}</div>
                    <div class="td-draw-emoji">${card.emoji}</div>
                    <div class="td-draw-seal">印</div>
                </div>`;
            setTimeout(() => anim.classList.add('hidden'), 1200);
        }

        _addFloat(x, y, text, color) {
            this.floats.push({ x, y, text, color, t: 0 });
        }

        _toast(msg, type) {
            if (window.UI && window.UI.showToast) window.UI.showToast(msg, 2000, type || 'info');
            else console.log('[TD]', msg);
        }

        // ===== 控制 =====
        togglePause() {
            this.paused = !this.paused;
            const btn = document.getElementById('td-pause-btn');
            if (btn) btn.textContent = this.paused ? '继续' : '暂停';
        }

        toggleSpeed() {
            this.speed = this.speed === 1 ? 2 : 1;
            const btn = document.getElementById('td-speed-btn');
            if (btn) btn.textContent = this.speed + 'x';
        }

        // ===== 结束战斗 =====
        _endBattle(isVictory) {
            if (!this.running) return;
            this.running = false;
            // bug fix #3：取消实例上的 gameLoopId
            if (this.gameLoopId) {
                cancelAnimationFrame(this.gameLoopId);
                this.gameLoopId = null;
            }
            // 结算击杀奖励（确保 BOSS 被击杀时奖励发放；逃逸敌人不发奖）
            this.enemies.forEach(e => {
                if (!e.alive && e.killed && !e._rewarded) this._onEnemyDeath(e);
            });
            // 合并可能由分裂产生的待生成敌人（仅记录，不再更新）
            this.enemies = this.enemies.concat(this._pendingSpawns);
            this._pendingSpawns = [];
            this.showResult(isVictory, this.currentLevelId);
        }

        showResult(isVictory, levelId) {
            const modal = document.getElementById('td-result');
            if (!modal) return;

            // 阶段九：特殊关卡走专用结算（不触发主线 onLevelVictory / 永久遗物）
            if (this.specialMode && this.specialMode.running) {
                if (window.AudioManager) {
                    window.AudioManager.stopBGM();
                    window.AudioManager.playSound(isVictory ? 'victory' : 'defeat');
                }
                if (isVictory) this._specialOnVictory();
                this._showSpecialResult(isVictory);
                return;
            }

            // 阶段八：战斗结算，清理所有 Lottie 动画（关键 Bug 规避：避免动画残留）
            if (window.LottieFx) window.LottieFx.destroyAll();

            // 阶段六：结算音效 + 停止战斗 BGM
            if (window.AudioManager) {
                window.AudioManager.stopBGM();
                window.AudioManager.playSound(isVictory ? 'victory' : 'defeat');
            }

            // 阶段七：3星通关时先弹永久遗物获取面板，收下后再显示结算
            if (isVictory && window.RelicSystem) {
                // 提前计算星级（3星=通关+主灯未受损+限时内通关）
                const noDamage = !!this._levelNoDamage && this.lives >= INIT_LIVES;
                const timeSeconds = Math.round((Date.now() - (this._levelStartTime || Date.now())) / 1000);
                const lv = levelData(levelId);
                const star3Time = (lv ? lv.waves : 3) * 30 + 60; // 限时公式：波数*30+60秒
                let stars = 1;
                if (noDamage) {
                    stars = 2;
                    if (timeSeconds <= star3Time) stars = 3;
                }
                this._lastLevelStars = stars;
                this._lastLevelTime = timeSeconds;
                this._lastLevelStar3Time = star3Time;

                if (stars === 3) {
                    const relic = RelicSystem.rollPermanentRelic();
                    if (relic) {
                        this._showRelicRewardPanel(relic, () => {
                            this._renderResultContent(true, levelId);
                        });
                        return; // 等待玩家收下后再显示结算
                    }
                }
            }

            // 阶段七：失败时清空局内遗物（永久遗物保留）
            if (!isVictory && window.RelicSystem) {
                RelicSystem.resetRunRelics();
            }

            this._renderResultContent(isVictory, levelId);
        }

        /**
         * 阶段七：显示永久遗物获取面板
         * @param {Relic} relic - 永久遗物
         * @param {Function} onConfirm - 玩家点"收下"后的回调
         */
        _showRelicRewardPanel(relic, onConfirm) {
            const panel = document.getElementById('relic-reward-panel');
            const cardEl = document.getElementById('relic-reward-card');
            const confirmBtn = document.getElementById('relic-reward-confirm');
            if (!panel || !cardEl || !confirmBtn) {
                // DOM 缺失降级：直接应用并回调
                RelicSystem.applyRelic(relic.id, true);
                if (onConfirm) onConfirm();
                return;
            }

            // 渲染遗物卡片
            cardEl.className = `relic-reward-box rarity-${relic.rarity}`;
            cardEl.innerHTML = `
                <div class="relic-rarity-tag rarity-${relic.rarity}">${window.RARITY_LABEL ? RARITY_LABEL[relic.rarity] : relic.rarity}</div>
                <div class="relic-card-emoji">${relic.emoji}</div>
                <div class="relic-card-name">${relic.name}</div>
                <div class="relic-card-desc">${relic.description}</div>
            `;

            panel.classList.remove('hidden');
            if (window.AudioManager) AudioManager.playSound('relic-reward', 0.9);

            // 绑定"收下"按钮（一次性）
            const handler = () => {
                confirmBtn.removeEventListener('click', handler);
                RelicSystem.applyRelic(relic.id, true);
                panel.classList.add('hidden');
                if (window.AudioManager) AudioManager.playSound('relic-reward', 0.6);
                if (onConfirm) onConfirm();
            };
            confirmBtn.addEventListener('click', handler);
        }

        /**
         * 阶段十：通关数据上报——任务进度/成就检查/排行榜提交/星级记录
         * 星级规则：1星=通关；2星=通关且主灯未受损；3星=通关且主灯未受损且未漏怪
         */
        _reportLevelComplete(levelId) {
            try {
                const timeSeconds = Math.round((Date.now() - (this._levelStartTime || Date.now())) / 1000);
                const noDamage = !!this._levelNoDamage && this.lives >= INIT_LIVES;
                // 星级计算：1星=通关；2星=通关+主灯未受损；3星=通关+主灯未受损+限时内通关
                const lv = levelData(levelId);
                const star3Time = (lv ? lv.waves : 3) * 30 + 60;
                let stars = 1;
                if (noDamage) {
                    stars = 2;
                    if (timeSeconds <= star3Time) stars = 3;
                }
                this._lastLevelStars = stars; // 供 showResult / _renderResultContent 读取
                this._lastLevelTime = timeSeconds;
                this._lastLevelStar3Time = star3Time;

                // 1. 日常任务：通关进度
                if (window.DailyTasks) {
                    try { DailyTasks.updateProgress('complete-level', 1); } catch (e) { /* ignore */ }
                }
                // 2. 成就检查（含"不损失主灯通关""全部三星"等）
                if (window.Achievements) {
                    try { Achievements.checkAll(); } catch (e) { /* ignore */ }
                }
                // 2.1 标记无伤通关（用于 battle-no-damage 成就）
                if (noDamage && window.Achievements && typeof Achievements.markNoDamageClear === 'function') {
                    try { Achievements.markNoDamageClear(levelId); } catch (e) { /* ignore */ }
                }
                // 3. 排行榜：提交通关速度
                if (window.Leaderboard && typeof Leaderboard.submitLevelSpeed === 'function') {
                    try { Leaderboard.submitLevelSpeed(levelId, timeSeconds); } catch (e) { /* ignore */ }
                }
                // 4. 星级记录（仅取更高值）+ 星级奖励
                if (window.GameState && typeof window.GameState.setLevelStars === 'function') {
                    try {
                        const prevStars = window.GameState.getLevelStars ? window.GameState.getLevelStars(levelId) : 0;
                        window.GameState.setLevelStars(levelId, stars);
                        // 星级奖励：仅当本次星级 > 历史最高时发放差额奖励
                        const gained = stars - (prevStars || 0);
                        this._starBonus = { gained: 0, coins: 0, inspiration: 0, scrolls: 0, text: '' };
                        if (gained > 0) {
                            const bonusCoins = gained * 100;
                            const bonusInsp = gained * 15;
                            const bonusScrolls = stars >= 2 ? gained * 1 : 0;
                            if (bonusCoins > 0) window.GameState.addCoins(bonusCoins);
                            if (bonusInsp > 0) window.GameState.addInspiration(bonusInsp);
                            if (bonusScrolls > 0) window.GameState.addScrolls(bonusScrolls);
                            this._starBonus = {
                                gained, coins: bonusCoins, inspiration: bonusInsp, scrolls: bonusScrolls,
                                text: `⭐ 星级奖励：💰+${bonusCoins} ✨+${bonusInsp}${bonusScrolls > 0 ? ` 📜+${bonusScrolls}` : ''}`
                            };
                        }
                    } catch (e) { /* ignore */ }
                }
            } catch (e) { /* 留存上报不影响主流程 */ }
        }

        /**
         * 阶段七：渲染结算弹窗内容（从 showResult 拆出，供遗物回调复用）
         */
        _renderResultContent(isVictory, levelId) {
            const modal = document.getElementById('td-result');
            if (!modal) return;
            modal.classList.remove('hidden');
            const lv = levelData(levelId);
            let rewardHtml = '';
            if (isVictory) {
                // bug fix #6：奖励只通过 DataIntegration.onLevelVictory 发放
                if (window.DataIntegration && window.DataIntegration.onLevelVictory) {
                    window.DataIntegration.onLevelVictory(levelId);
                }
                // 阶段十：留存系统——通关数据上报（任务/成就/排行榜/星级）
                this._reportLevelComplete(levelId);
                const r = (lv && lv.reward) || {};
                const stars = this._lastLevelStars || 1;
                const starBonus = this._starBonus;
                const usedTime = this._lastLevelTime || 0;
                const star3Time = this._lastLevelStar3Time || 0;
                let starHtml = `<div class="td-result-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>`;
                let timeHtml = `<div class="td-result-time">用时 ${usedTime} 秒 ${stars >= 3 ? '✓' : `(3星需 ≤ ${star3Time} 秒)`}</div>`;
                let bonusHtml = '';
                if (starBonus && starBonus.gained > 0) {
                    bonusHtml = `<div class="td-result-star-bonus">${starBonus.text}</div>`;
                }
                rewardHtml = `
                    <div class="td-result-title td-win">胜利！</div>
                    ${starHtml}
                    ${timeHtml}
                    <div class="td-result-sub">通关「${lv ? lv.name : ''}」</div>
                    <div class="td-result-reward">
                        <div>💰 铜钱 +${r.coins || 0}</div>
                        <div>📜 卷轴 +${r.scrolls || 0}</div>
                        <div>✨ 灵感 +${r.inspiration || 0}</div>
                    </div>
                    ${bonusHtml}`;
            } else {
                // 失败安慰奖励（少量铜钱，非关卡奖励，不与 onLevelVictory 冲突）
                const consolation = 50;
                if (window.GameState) window.GameState.addCoins(consolation);
                rewardHtml = `
                    <div class="td-result-title td-lose">失败</div>
                    <div class="td-result-sub">主灯被毁，下次再战</div>
                    <div class="td-result-reward">
                        <div>💰 安慰铜钱 +${consolation}</div>
                    </div>`;
            }
            modal.innerHTML = `
                <div class="td-result-box">
                    ${rewardHtml}
                    <button id="td-result-confirm">确定</button>
                </div>`;
            const confirm = document.getElementById('td-result-confirm');
            if (confirm) confirm.addEventListener('click', () => {
                modal.classList.add('hidden');
                this.exit();
            });
        }

        // ===== 退出 =====
        exit() {
            this.running = false;
            if (this.gameLoopId) {
                cancelAnimationFrame(this.gameLoopId);
                this.gameLoopId = null;
            }
            // 阶段七：清空局内遗物 + 隐藏遗物相关面板
            if (window.RelicSystem) RelicSystem.resetRunRelics();
            const relicSelect = document.getElementById('relic-select-panel'); if (relicSelect) relicSelect.classList.add('hidden');
            const relicReward = document.getElementById('relic-reward-panel'); if (relicReward) relicReward.classList.add('hidden');
            const activeRelicsBar = document.getElementById('td-active-relics'); if (activeRelicsBar) activeRelicsBar.classList.add('hidden');
            // 阶段六：停止战斗 BGM，恢复经营 BGM
            if (window.AudioManager) {
                window.AudioManager.stopBGM();
                window.AudioManager.playBGM('bgm-management');
            }
            // #10 关卡天气：退出时清理天气特效
            if (window.SceneFx) window.SceneFx.clearWeather();
            this.paused = false;
            this.speed = 1;
            this.placementMode = false;
            this.placementCard = null;
            this.placementIndex = -1;
            this.selectedTower = null;
            // 阶段五：清理所有战斗特效粒子（防止内存泄漏）
            if (window.BattleFx) window.BattleFx.clear();
            if (window.EnemyFx) window.EnemyFx.clear();
            // 清理 UI 特效层（资源飞行等 DOM 特效）
            const fxLayer = document.getElementById('fx-ui-layer');
            if (fxLayer) fxLayer.innerHTML = '';
            // 清理抽牌动画
            const drawAnim = document.getElementById('td-draw-anim');
            if (drawAnim) { drawAnim.innerHTML = ''; drawAnim.classList.add('hidden'); }
            // 重置速度和暂停按钮显示
            const speedBtn = document.getElementById('td-speed-btn');
            if (speedBtn) speedBtn.textContent = '1x';
            const pauseBtn = document.getElementById('td-pause-btn');
            if (pauseBtn) pauseBtn.textContent = '暂停';
            this._hideTowerInfo();
            this._hidePrepBanner();
            const choice = document.getElementById('td-card-choice'); if (choice) choice.classList.add('hidden');
            const result = document.getElementById('td-result'); if (result) result.classList.add('hidden');
            const bossBar = document.getElementById('td-boss-bar'); if (bossBar) bossBar.classList.add('hidden');
            // 阶段九：清理无尽/特殊模式状态与 UI
            this._cleanupEndlessUI();
            this._cleanupSpecialBanner();
            // 阶段十一：PVP 模式退出时返回 PVP 面板而非关卡选择
            if (this.pvpMode) {
                this._cleanupPvp();
                const pvpPanel = document.getElementById('pvp-panel');
                if (pvpPanel) pvpPanel.classList.remove('hidden');
                return;
            }
            // 返回关卡选择
            this.showLevelSelect();
        }

        // ============================================================
        // ===== 阶段十一：PVP 模式（攻守轮换/同步对战/防守竞赛）=====
        // ============================================================

        /** 清理 PVP 状态 */
        _cleanupPvp() {
            this.pvpMode = null;
            this.pvpRound = 0;
            this.pvpOpponent = null;
            this.pvpAttackDeck = [];
            this.pvpDefenseFormation = []; // [已废弃]
            this.pvpTimeRemaining = 0;
            this.pvpMainLampHP = 0;
            this.pvpMainLampMaxHP = 0;
            this.pvpAiLampHP = 0;
            this.pvpAiLampMaxHP = 0;
            this.pvpAiSimTimer = 0;
            this.pvpAiWavesSurvived = 0;
            this.pvpPlayerWavesSurvived = 0;
            // 同步清理 PVP 模式状态，防止延迟回调误触发
            if (window.AttackDefenseMode) AttackDefenseMode.isActive = false;
            if (window.SyncBattleMode) SyncBattleMode.isActive = false;
            if (window.DefenseRaceMode) DefenseRaceMode.isActive = false;
            const hud = document.getElementById('pvp-hud');
            if (hud) hud.classList.add('hidden');
        }

        /**
         * 攻守轮换 - 回合1：玩家防守
         * 出战牌组自动布塔，AI 自动出怪进攻，限时180秒
         */
        startAttackDefense(opponent, battleDeck) {
            this._ensureDom();
            this._showView('battle');
            // 停止经营产出
            if (window._managementInstance && window._managementInstance.stopProduction) {
                window._managementInstance.stopProduction();
            }
            // 设置 PVP 状态
            this.pvpMode = 'attack-defense';
            this.pvpRound = 1;
            this.pvpOpponent = opponent;
            this.pvpAttackDeck = battleDeck || [];
            this.pvpTimeRemaining = this.pvpTimeLimit;

            // 重置战斗状态
            this.enemies = [];
            this.towers = [];
            this.projectiles = [];
            this.floats = [];
            this.occupiedCells = new Set();
            this.bossRef = null;
            this.selectedTower = null;
            this.placementMode = false;
            this.placementCard = null;
            this.hoverCell = null;
            this.paused = false;
            this.speed = 1;
            this._pendingSpawns = [];

            // 构建路径（复用关卡1直线）
            this._pvpBuildPath(1);

            // 玩家主灯 HP
            const playerProsperity = window.PvpSystem ? PvpSystem.calculateProsperity() : 500;
            this.pvpMainLampMaxHP = 1000 + Math.floor(playerProsperity * 0.5);
            this.pvpMainLampHP = this.pvpMainLampMaxHP;
            this.lives = 999; // PVP 不用 lives 判定，设高值避免误触发

            // 出战牌组自动布塔
            this._pvpAutoPlaceDeckTowers(battleDeck, false);

            // 构建 AI 进攻波次（基于对手繁荣度）
            this._pvpBuildWaves(opponent.prosperity, 'attack');

            // 准备阶段
            this.prepPhase = true;
            this.prepTimer = 5;

            // 卡牌系统（PVP 回合1不需要抽卡，阵型已预放置；设空牌库避免报错）
            this.cardSystem = new CardSystem();
            this.cardSystem.hand = [];

            // UI
            const nameEl = document.getElementById('td-level-name');
            if (nameEl) nameEl.textContent = `PVP 攻守轮换 · 回合1（防守）vs ${opponent.name}`;
            this._updateLivesUI();
            this._updateWaveUI();
            this._updatePopularityUI();
            this._renderHand();
            this._updateBossBar(null);
            this._showPrepBanner();
            this._showPvpHud();

            // 启动游戏循环
            this.running = true;
            this.lastTime = 0;
            this.gameLoopId = requestAnimationFrame((t) => this._gameLoop(t));

            if (window.AudioManager) window.AudioManager.playBGM('bgm-battle');
            this._toast(`回合1：出战牌组已就位，抵御 ${opponent.name} 的进攻！`, 'info');
        }

        /**
         * 攻守轮换 - 回合2：玩家进攻
         * AI 防御阵型预放置，玩家自动出怪进攻，限时180秒
         */
        startAttackDefenseRound2(opponent) {
            // 重置战斗状态（保留 PVP 模式）
            this.enemies = [];
            this.towers = [];
            this.projectiles = [];
            this.floats = [];
            this.occupiedCells = new Set();
            this.bossRef = null;
            this.selectedTower = null;
            this.placementMode = false;
            this.placementCard = null;
            this.hoverCell = null;
            this.paused = false;
            this.speed = 1;
            this._pendingSpawns = [];

            this.pvpRound = 2;
            this.pvpTimeRemaining = this.pvpTimeLimit;

            // 构建路径
            this._pvpBuildPath(1);

            // AI 主灯 HP
            this.pvpAiLampMaxHP = 1000 + Math.floor(opponent.prosperity * 0.5);
            this.pvpAiLampHP = this.pvpAiLampMaxHP;
            this.lives = 999;

            // AI 出战牌组自动布塔
            this._pvpAutoPlaceDeckTowers(opponent.attackDeck || [], true);

            // 构建玩家进攻波次（基于进攻卡组强度）
            this._pvpBuildWaves(this._pvpCalcAttackPower(), 'player-attack');

            this.prepPhase = true;
            this.prepTimer = 5;

            this.cardSystem = new CardSystem();
            this.cardSystem.hand = [];

            const nameEl = document.getElementById('td-level-name');
            if (nameEl) nameEl.textContent = `PVP 攻守轮换 · 回合2（进攻）vs ${opponent.name}`;
            this._updateLivesUI();
            this._updateWaveUI();
            this._updatePopularityUI();
            this._renderHand();
            this._updateBossBar(null);
            this._showPrepBanner();
            this._showPvpHud();

            this.running = true;
            this.lastTime = 0;
            this.gameLoopId = requestAnimationFrame((t) => this._gameLoop(t));

            this._toast(`回合2：进攻 ${opponent.name}！怪物自动出击`, 'info');
        }

        /** PVP 构建路径（复用关卡路径定义） */
        _pvpBuildPath(levelId) {
            const def = LEVEL_PATHS[levelId] || LEVEL_PATHS[1];
            let laneDefs;
            if (Array.isArray(def)) laneDefs = [def];
            else laneDefs = def.lanes;
            this.lanes = laneDefs.map(lane => lane.map(([c, r]) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 })));
            this.pathCells = new Set();
            laneDefs.forEach(lane => {
                for (let i = 0; i < lane.length - 1; i++) {
                    const [c1, r1] = lane[i];
                    const [c2, r2] = lane[i + 1];
                    const dc = Math.sign(c2 - c1);
                    const dr = Math.sign(r2 - r1);
                    let c = c1, r = r1;
                    this.pathCells.add(`${c},${r}`);
                    while (c !== c2 || r !== r2) {
                        c += dc; r += dr;
                        this.pathCells.add(`${c},${r}`);
                    }
                }
            });
            this.lamp = this.lanes[0][this.lanes[0].length - 1];
        }

        /**
         * 从出战牌组自动布置防御塔（替代手动防御阵型）
         * 策略：路径(row=5)两侧交错分布，覆盖完整列范围
         * @param {string[]} deck - 工坊/遗产ID列表
         * @param {boolean} isAi - 是否AI方（AI用随机等级，玩家用真实工坊等级）
         */
        _pvpAutoPlaceDeckTowers(deck, isAi) {
            if (!deck || deck.length === 0) return;
            // 预定义布塔位置：路径两侧交错，均匀覆盖列范围
            const preset = [
                [2,4],[2,6],[4,3],[4,7],[6,4],[6,6],[8,3],[8,7],
                [10,4],[10,6],[12,3],[12,7],[14,4],[14,6]
            ];
            let posIdx = 0;
            for (const wid of deck) {
                const ich = ichData(wid);
                if (!ich) continue;
                const level = isAi
                    ? (1 + Math.floor(Math.random() * 5))
                    : (window.DataIntegration ? DataIntegration.getTowerLevel(wid) : 1);
                const card = {
                    heritageId: ich.id, name: ich.name, emoji: ich.emoji,
                    towerType: ich.towerType, damage: ich.towerDamage,
                    range: ich.towerRange, attackSpeed: ich.towerAttackSpeed, skill: ich.skill
                };
                // 从预设位置找下一个可用格子
                let placed = false;
                while (posIdx < preset.length) {
                    const [c, r] = preset[posIdx++];
                    if (this.pathCells.has(`${c},${r}`)) continue;
                    if (this.occupiedCells.has(`${c},${r}`)) continue;
                    this.towers.push(new Tower(card, c, r, level || 1));
                    this.occupiedCells.add(`${c},${r}`);
                    placed = true;
                    break;
                }
                // 兜底：随机找位置
                if (!placed) {
                    for (let attempts = 0; attempts < 50; attempts++) {
                        const c = 1 + Math.floor(Math.random() * (GRID_COLS - 2));
                        const r = 1 + Math.floor(Math.random() * (GRID_ROWS - 2));
                        if (!this.pathCells.has(`${c},${r}`) && !this.occupiedCells.has(`${c},${r}`)) {
                            this.towers.push(new Tower(card, c, r, level || 1));
                            this.occupiedCells.add(`${c},${r}`);
                            break;
                        }
                    }
                }
            }
        }

        /** 预放置玩家防御阵型为 Tower 实例 */
        _pvpPlaceDefenseTowers(formation, isAi) {
            if (!formation || formation.length === 0) return;
            formation.forEach(t => {
                if (!t.workshopId) return;
                const ich = ichData(t.workshopId);
                if (!ich) return;
                const level = isAi ? (t.level || 1) : (window.DataIntegration ? DataIntegration.getTowerLevel(t.workshopId) : 1);
                const card = {
                    heritageId: ich.id,
                    name: ich.name,
                    emoji: ich.emoji,
                    towerType: ich.towerType,
                    damage: ich.towerDamage,
                    range: ich.towerRange,
                    attackSpeed: ich.towerAttackSpeed,
                    skill: ich.skill
                };
                const tower = new Tower(card, t.gridX, t.gridY, level || 1);
                this.towers.push(tower);
                this.occupiedCells.add(`${t.gridX},${t.gridY}`);
            });
        }

        /** 预放置 AI 防御阵型（基于对手 townLayout.buildings） */
        _pvpPlaceAiDefenseTowers(opponent) {
            const layout = opponent.townLayout || {};
            const buildings = layout.buildings || [];
            if (buildings.length === 0) return;
            // 从 AI 防御阵型获取（AI 玩家有 defenseFormation 字段）
            const aiFormation = opponent.defenseFormation || [];
            if (aiFormation.length > 0) {
                this._pvpPlaceDefenseTowers(aiFormation, true);
                return;
            }
            // 兜底：从 buildings 随机生成防御阵型
            const count = Math.min(8, buildings.length);
            for (let i = 0; i < count; i++) {
                const b = buildings[i];
                const ich = ichData(b.id || b.workshopId);
                if (!ich) continue;
                const card = {
                    heritageId: ich.id, name: ich.name, emoji: ich.emoji,
                    towerType: ich.towerType, damage: ich.towerDamage,
                    range: ich.towerRange, attackSpeed: ich.towerAttackSpeed, skill: ich.skill
                };
                // 随机位置（避开路径）
                let gx, gy, attempts = 0;
                do {
                    gx = Math.floor(Math.random() * 14) + 1;
                    gy = Math.floor(Math.random() * 8) + 1;
                    attempts++;
                } while (this.pathCells.has(`${gx},${gy}`) && attempts < 20);
                if (!this.pathCells.has(`${gx},${gy}`)) {
                    const tower = new Tower(card, gx, gy, b.level || 1);
                    this.towers.push(tower);
                    this.occupiedCells.add(`${gx},${gy}`);
                }
            }
        }

        /** 计算 PVP 玩家进攻卡组强度（用于生成怪物波次） */
        _pvpCalcAttackPower() {
            if (!this.pvpAttackDeck || this.pvpAttackDeck.length === 0) return 500;
            let total = 0;
            this.pvpAttackDeck.forEach(wid => {
                const ich = ichData(wid);
                if (ich) total += (ich.towerDamage || 10) * (ich.towerRange || 100) / 100;
                const lv = window.DataIntegration ? DataIntegration.getTowerLevel(wid) : 1;
                total += lv * 50;
            });
            return Math.floor(total);
        }

        /**
         * 构建 PVP 波次
         * @param {number} strength - 进攻方强度（繁荣度或攻击力）
         * @param {string} type - 'attack'(AI进攻玩家) | 'player-attack'(玩家进攻AI)
         */
        _pvpBuildWaves(strength, type) {
            const ed = window.GameData && window.GameData.ENEMY_DATA;
            if (!ed) { this.waves = []; this.totalWaves = 0; return; }
            const normalPool = ed.normal || [];
            const elitePool = ed.elite || [];
            // 波次数：5-8 波，强度越高波次越多
            const waveCount = Math.min(8, Math.max(5, Math.floor(strength / 200) + 5));
            // HP 倍率：强度越高怪物越强
            const hpMul = Math.max(0.6, Math.min(2.0, strength / 500));
            const waves = [];
            for (let w = 0; w < waveCount; w++) {
                const isLast = w === waveCount - 1;
                const entries = [];
                const count = 5 + w;
                for (let i = 0; i < count; i++) {
                    const isElite = w >= 3 && Math.random() < 0.2;
                    const pool = isElite ? elitePool : normalPool;
                    const m = pool[Math.floor(Math.random() * pool.length)];
                    entries.push({ kind: isElite ? 'elite' : 'normal', id: m.id, hpMul, delay: Math.max(500, 1000 - w * 50) });
                }
                waves.push(entries);
            }
            this.waves = waves;
            this.totalWaves = waves.length;
            this.currentWave = 0;
            this.spawnQueue = [];
            this.spawnTimer = 0;
            this.prepPhase = true;
            this.prepTimer = 5;
            this.waveBreakTimer = 0;
        }

        /** PVP 模式专用波次更新（替代 _updateWaves 的主线逻辑） */
        _updatePvpWaves(dt) {
            if (this.prepPhase) {
                this.prepTimer -= dt;
                this._updatePrepUI();
                if (this.prepTimer <= 0) {
                    this.prepPhase = false;
                    this._hidePrepBanner();
                    if (this.currentWave < this.totalWaves) {
                        this.spawnQueue = this.waves[this.currentWave].slice();
                        this.currentWave++;
                        // 防守竞赛：记录玩家已坚持波次
                        if (this.pvpMode === 'defense-race') {
                            this.pvpPlayerWavesSurvived = this.currentWave - 1;
                        }
                        this.spawnTimer = 0;
                        this._updateWaveUI();
                    }
                }
                return;
            }
            if (this.spawnQueue.length === 0) {
                const anyAlive = this.enemies.some(e => e.alive);
                if (!anyAlive) {
                    if (this.currentWave < this.totalWaves) {
                        this.prepPhase = true;
                        this.prepTimer = 5;
                        this._showPrepBanner();
                    }
                }
                return;
            }
            this.spawnTimer -= dt;
            if (this.spawnTimer <= 0) {
                const entry = this.spawnQueue.shift();
                this._pvpSpawnEnemy(entry);
                this.spawnTimer = (entry.delay || 800) / 1000;
            }
        }

        /** PVP 生成敌人 */
        _pvpSpawnEnemy(entry) {
            const data = enemyDataById(entry.id);
            if (!data) return;
            const lane = this.lanes[0];
            const opts = { hpMul: entry.hpMul || 1, isElite: entry.kind === 'elite', isBoss: entry.kind === 'boss' };
            const enemy = new Enemy(data, lane, opts);
            this.enemies.push(enemy);
        }

        /** PVP 时间倒计时 + 结束判定 */
        _updatePvpTimer(dt) {
            // 同步对战/防守竞赛：AI 后台模拟
            if (this.pvpMode === 'sync-battle') {
                this._updateSyncBattleAiSim(dt);
            } else if (this.pvpMode === 'defense-race') {
                this._updateDefenseRaceAiSim(dt);
            }

            // 限时倒计时（防守竞赛无限时，跳过）
            if (this.pvpMode !== 'defense-race') {
                this.pvpTimeRemaining -= dt;
                if (this.pvpTimeRemaining <= 0) {
                    this.pvpTimeRemaining = 0;
                    this._endPvpRound('timeout');
                    return;
                }
            }

            // 主灯 HP 归零判定
            if (this.pvpMode === 'attack-defense') {
                if (this.pvpRound === 1 && this.pvpMainLampHP <= 0) {
                    this._endPvpRound('lamp-broken');
                    return;
                } else if (this.pvpRound === 2 && this.pvpAiLampHP <= 0) {
                    this._endPvpRound('lamp-broken');
                    return;
                }
            } else if (this.pvpMode === 'sync-battle') {
                if (this.pvpMainLampHP <= 0) {
                    this._endPvpRound('playerDead');
                    return;
                } else if (this.pvpAiLampHP <= 0) {
                    this._endPvpRound('aiDead');
                    return;
                }
            } else if (this.pvpMode === 'defense-race') {
                // 防守竞赛：玩家主灯HP归零 = 玩家失败
                if (this.pvpMainLampHP <= 0) {
                    this._endPvpRound('playerDead');
                    return;
                }
                // AI主灯HP归零 = AI失败，玩家继续看能坚持多少波
                // 但为简化，AI归零后停止模拟，玩家继续直到自己归零
                // 所有波次出完且无敌人且AI已失败 → 结束
                if (this.pvpAiLampHP <= 0 && this.currentWave >= this.totalWaves && this.spawnQueue.length === 0 && this.enemies.length === 0) {
                    this._endPvpRound('cleared');
                    return;
                }
            }

            // 所有波次出完且无敌人 → 提前结束（攻守轮换/同步对战）
            if (this.pvpMode !== 'defense-race' &&
                this.currentWave >= this.totalWaves && this.spawnQueue.length === 0 && this.enemies.length === 0) {
                this._endPvpRound('cleared');
                return;
            }

            this._updatePvpHud();
        }

        /** 结束 PVP 回合/对战 */
        _endPvpRound(reason) {
            if (!this.running) return;
            this.running = false;
            if (this.gameLoopId) {
                cancelAnimationFrame(this.gameLoopId);
                this.gameLoopId = null;
            }
            if (this.pvpMode === 'attack-defense') {
                if (this.pvpRound === 1) {
                    // 回合1结束：计算 AI 摧毁比例
                    const aiScore = this.pvpMainLampMaxHP > 0
                        ? 1 - (this.pvpMainLampHP / this.pvpMainLampMaxHP) : 1;
                    this.pvpAiAttackScore = aiScore;
                    if (window.AttackDefenseMode) {
                        AttackDefenseMode.endRound(aiScore);
                    }
                    // 进入回合2（延迟以提供回合过渡）
                    setTimeout(() => {
                        // 防护：用户可能在此期间退出
                        if (!window.AttackDefenseMode || !AttackDefenseMode.isActive) return;
                        if (AttackDefenseMode.opponent) {
                            this.startAttackDefenseRound2(AttackDefenseMode.opponent);
                        }
                    }, 1500);
                    this._toast(`回合1结束！AI摧毁率 ${(aiScore*100).toFixed(0)}%`, 'info');
                } else {
                    // 回合2结束：计算玩家摧毁比例
                    const playerScore = this.pvpAiLampMaxHP > 0
                        ? 1 - (this.pvpAiLampHP / this.pvpAiLampMaxHP) : 1;
                    this.pvpPlayerAttackScore = playerScore;
                    if (window.AttackDefenseMode) {
                        AttackDefenseMode.setPlayerAttackScore(playerScore);
                        const result = AttackDefenseMode.endBattle();
                        this._showPvpResult('attack-defense', result);
                    }
                }
            } else if (this.pvpMode === 'sync-battle') {
                // 同步对战结算
                if (window.SyncBattleMode) {
                    // 同步当前 HP 到模式对象
                    SyncBattleMode.playerMainLampHP = this.pvpMainLampHP;
                    SyncBattleMode.aiMainLampHP = this.pvpAiLampHP;
                    const result = SyncBattleMode.endBattle(reason);
                    this._showPvpResult('sync-battle', result);
                }
            } else if (this.pvpMode === 'defense-race') {
                // 防守竞赛结算
                // 记录玩家坚持波次
                this.pvpPlayerWavesSurvived = Math.max(0, this.currentWave - 1);
                if (window.DefenseRaceMode) {
                    DefenseRaceMode.playerWavesSurvived = this.pvpPlayerWavesSurvived;
                    DefenseRaceMode.aiWavesSurvived = this.pvpAiWavesSurvived;
                    const result = DefenseRaceMode.endRace();
                    this._showPvpResult('defense-race', result);
                }
            }
        }

        /** 显示 PVP 结算 */
        _showPvpResult(mode, result) {
            if (window.AudioManager) {
                window.AudioManager.stopBGM();
                window.AudioManager.playSound(result.result === 'win' ? 'victory' : 'defeat');
            }
            this._cleanupPvp();
            this._hideAll();
            // 恢复经营产出
            if (window._managementInstance && window._managementInstance.startProduction) {
                window._managementInstance.startProduction();
            }
            if (window.AudioManager) window.AudioManager.playBGM('bgm-management');
            // 显示结算面板
            if (window._managementInstance && window._managementInstance.showPvpResult) {
                window._managementInstance.showPvpResult(mode, result);
            }
        }

        /** 显示 PVP HUD */
        _showPvpHud() {
            const hud = document.getElementById('pvp-hud');
            if (!hud) return;
            hud.classList.remove('hidden');
            this._updatePvpHud();
        }

        /** 更新 PVP HUD */
        _updatePvpHud() {
            const hud = document.getElementById('pvp-hud');
            if (!hud || !this.pvpMode) return;
            const min = Math.floor(this.pvpTimeRemaining / 60);
            const sec = Math.floor(this.pvpTimeRemaining % 60);
            const timeStr = `${min}:${String(sec).padStart(2, '0')}`;
            let html = '';
            if (this.pvpMode === 'attack-defense') {
                const roundText = this.pvpRound === 1 ? '回合1·防守' : '回合2·进攻';
                if (this.pvpRound === 1) {
                    const hpPct = (this.pvpMainLampHP / this.pvpMainLampMaxHP * 100).toFixed(0);
                    html = `<div class="pvp-hud-round">${roundText}</div>
                            <div class="pvp-hud-time">⏱ ${timeStr}</div>
                            <div class="pvp-hud-lamp">🏠主灯 ${this.pvpMainLampHP}/${this.pvpMainLampMaxHP} (${hpPct}%)</div>
                            <div class="pvp-hud-opp">vs ${this.pvpOpponent.name}</div>`;
                } else {
                    const hpPct = (this.pvpAiLampHP / this.pvpAiLampMaxHP * 100).toFixed(0);
                    html = `<div class="pvp-hud-round">${roundText}</div>
                            <div class="pvp-hud-time">⏱ ${timeStr}</div>
                            <div class="pvp-hud-lamp">🐲对手主灯 ${this.pvpAiLampHP}/${this.pvpAiLampMaxHP} (${hpPct}%)</div>
                            <div class="pvp-hud-opp">vs ${this.pvpOpponent.name}</div>`;
                }
            } else if (this.pvpMode === 'sync-battle') {
                const playerHpPct = (this.pvpMainLampHP / this.pvpMainLampMaxHP * 100).toFixed(0);
                const aiHpPct = (this.pvpAiLampHP / this.pvpAiLampMaxHP * 100).toFixed(0);
                html = `<div class="pvp-hud-round">同步对战</div>
                        <div class="pvp-hud-time">⏱ ${timeStr}</div>
                        <div class="pvp-hud-lamp">🏠你 ${this.pvpMainLampHP}(${playerHpPct}%)</div>
                        <div class="pvp-hud-lamp">🐲敌 ${this.pvpAiLampHP}(${aiHpPct}%)</div>
                        <div class="pvp-hud-opp">vs ${this.pvpOpponent.name}</div>`;
            } else if (this.pvpMode === 'defense-race') {
                html = `<div class="pvp-hud-round">防守竞赛</div>
                        <div class="pvp-hud-lamp">🏠主灯 ${this.pvpMainLampHP}/${this.pvpMainLampMaxHP}</div>
                        <div class="pvp-hud-lamp">📊你 ${this.pvpPlayerWavesSurvived}波</div>
                        <div class="pvp-hud-lamp">📊敌 ${this.pvpAiWavesSurvived}波</div>
                        <div class="pvp-hud-opp">vs ${this.pvpOpponent.name}</div>`;
            }
            hud.innerHTML = html;
        }

        // ============================================================
        // ===== 阶段十一 C2：同步对战（SyncBattle）=====
        // ============================================================

        /**
         * 同步对战：双方同时防守各自主灯，限时300秒，比较剩余HP
         * 出战牌组自动布塔，AI后台模拟防守
         */
        startSyncBattle(opponent, battleDeck, hpConfig) {
            this._ensureDom();
            this._showView('battle');
            if (window._managementInstance && window._managementInstance.stopProduction) {
                window._managementInstance.stopProduction();
            }
            this.pvpMode = 'sync-battle';
            this.pvpRound = 0;
            this.pvpOpponent = opponent;
            this.pvpTimeLimit = 300;
            this.pvpTimeRemaining = 300;
            this.pvpAiSimTimer = 0;

            // 重置战斗状态
            this.enemies = [];
            this.towers = [];
            this.projectiles = [];
            this.floats = [];
            this.occupiedCells = new Set();
            this.bossRef = null;
            this.selectedTower = null;
            this.placementMode = false;
            this.placementCard = null;
            this.hoverCell = null;
            this.paused = false;
            this.speed = 1;
            this._pendingSpawns = [];

            // 构建路径（复用关卡1直线）
            this._pvpBuildPath(1);

            // 双方主灯 HP
            this.pvpMainLampMaxHP = (hpConfig && hpConfig.playerHP) || 1000;
            this.pvpMainLampHP = this.pvpMainLampMaxHP;
            this.pvpAiLampMaxHP = (hpConfig && hpConfig.aiHP) || 1000;
            this.pvpAiLampHP = this.pvpAiLampMaxHP;
            this.lives = 999;

            // 出战牌组自动布塔
            this._pvpAutoPlaceDeckTowers(battleDeck, false);

            // 构建怪物波次（基于对手繁荣度，强度更高）
            this._pvpBuildWaves(opponent.prosperity * 1.2, 'attack');

            this.prepPhase = true;
            this.prepTimer = 5;

            this.cardSystem = new CardSystem();
            this.cardSystem.hand = [];

            const nameEl = document.getElementById('td-level-name');
            if (nameEl) nameEl.textContent = `PVP 同步对战 vs ${opponent.name}`;
            this._updateLivesUI();
            this._updateWaveUI();
            this._updatePopularityUI();
            this._renderHand();
            this._updateBossBar(null);
            this._showPrepBanner();
            this._showPvpHud();

            this.running = true;
            this.lastTime = 0;
            this.gameLoopId = requestAnimationFrame((t) => this._gameLoop(t));

            if (window.AudioManager) window.AudioManager.playBGM('bgm-battle');
            this._toast(`同步对战开始！双方同时防守，限时5分钟`, 'info');
        }

        /**
         * 同步对战 AI 后台模拟
         * 每秒扣减 AI 主灯 HP（基于怪物强度 / AI 防御强度）
         */
        _updateSyncBattleAiSim(dt) {
            this.pvpAiSimTimer += dt;
            if (this.pvpAiSimTimer < 1.0) return; // 每秒结算一次
            this.pvpAiSimTimer = 0;

            // AI 防御强度（基于对手繁荣度）
            const aiDefenseStrength = (this.pvpOpponent.prosperity || 500) * 0.8;
            // 怪物进攻强度（随时间递增）
            const elapsed = 300 - this.pvpTimeRemaining;
            const monsterStrength = 300 + elapsed * 3;
            // AI 每秒损失 = max(0, 怪物强度 - AI防御强度) * 系数
            const aiLoss = Math.max(0, monsterStrength - aiDefenseStrength) * 0.15;
            this.pvpAiLampHP = Math.max(0, this.pvpAiLampHP - Math.floor(aiLoss));
        }

        // ============================================================
        // ===== 阶段十一 C3：防守竞赛（DefenseRace）=====
        // ============================================================

        /**
         * 防守竞赛：双方同时防守无限波次，主灯HP归零即败，比较坚持波次
         * 出战牌组自动布塔，AI后台模拟波次
         */
        startDefenseRace(opponent, battleDeck, hpConfig) {
            this._ensureDom();
            this._showView('battle');
            if (window._managementInstance && window._managementInstance.stopProduction) {
                window._managementInstance.stopProduction();
            }
            this.pvpMode = 'defense-race';
            this.pvpRound = 0;
            this.pvpOpponent = opponent;
            this.pvpTimeLimit = 9999; // 无限时
            this.pvpTimeRemaining = 9999;
            this.pvpAiSimTimer = 0;
            this.pvpPlayerWavesSurvived = 0;
            this.pvpAiWavesSurvived = 0;

            // 重置战斗状态
            this.enemies = [];
            this.towers = [];
            this.projectiles = [];
            this.floats = [];
            this.occupiedCells = new Set();
            this.bossRef = null;
            this.selectedTower = null;
            this.placementMode = false;
            this.placementCard = null;
            this.hoverCell = null;
            this.paused = false;
            this.speed = 1;
            this._pendingSpawns = [];

            // 构建路径
            this._pvpBuildPath(1);

            // 玩家主灯 HP
            this.pvpMainLampMaxHP = (hpConfig && hpConfig.playerHP) || 1000;
            this.pvpMainLampHP = this.pvpMainLampMaxHP;
            this.pvpAiLampMaxHP = (hpConfig && hpConfig.aiHP) || 1000;
            this.pvpAiLampHP = this.pvpAiLampMaxHP;
            this.lives = 999;

            // 出战牌组自动布塔
            this._pvpAutoPlaceDeckTowers(battleDeck, false);

            // 构建无限波次（使用递增强度）
            this._pvpBuildEndlessWaves();

            this.prepPhase = true;
            this.prepTimer = 5;

            this.cardSystem = new CardSystem();
            this.cardSystem.hand = [];

            const nameEl = document.getElementById('td-level-name');
            if (nameEl) nameEl.textContent = `PVP 防守竞赛 vs ${opponent.name}`;
            this._updateLivesUI();
            this._updateWaveUI();
            this._updatePopularityUI();
            this._renderHand();
            this._updateBossBar(null);
            this._showPrepBanner();
            this._showPvpHud();

            this.running = true;
            this.lastTime = 0;
            this.gameLoopId = requestAnimationFrame((t) => this._gameLoop(t));

            if (window.AudioManager) window.AudioManager.playBGM('bgm-battle');
            this._toast(`防守竞赛开始！坚持更多波次即可获胜`, 'info');
        }

        /** 防守竞赛：构建无限递增波次 */
        _pvpBuildEndlessWaves() {
            const ed = window.GameData && window.GameData.ENEMY_DATA;
            if (!ed) { this.waves = []; this.totalWaves = 0; return; }
            const normalPool = ed.normal || [];
            const elitePool = ed.elite || [];
            const bossPool = ed.boss || [];
            // 生成 30 波（足够长，强度递增）
            const waves = [];
            for (let w = 0; w < 30; w++) {
                const entries = [];
                const count = 6 + w;
                const hpMul = 1.0 + w * 0.15; // 每波HP递增15%
                for (let i = 0; i < count; i++) {
                    let pool = normalPool;
                    let kind = 'normal';
                    if (w >= 5 && Math.random() < 0.25) { pool = elitePool; kind = 'elite'; }
                    if (w >= 10 && w % 5 === 0 && i === 0) { pool = bossPool; kind = 'boss'; }
                    const m = pool[Math.floor(Math.random() * pool.length)];
                    entries.push({ kind, id: m.id, hpMul, delay: Math.max(400, 900 - w * 20) });
                }
                waves.push(entries);
            }
            this.waves = waves;
            this.totalWaves = waves.length;
            this.currentWave = 0;
            this.spawnQueue = [];
            this.spawnTimer = 0;
            this.prepPhase = true;
            this.prepTimer = 5;
            this.waveBreakTimer = 0;
        }

        /**
         * 防守竞赛 AI 波次模拟
         * 每3秒结算一波AI防守结果
         */
        _updateDefenseRaceAiSim(dt) {
            this.pvpAiSimTimer += dt;
            if (this.pvpAiSimTimer < 3.0) return; // 每3秒结算一波
            this.pvpAiSimTimer = 0;

            const aiDefenseStrength = (this.pvpOpponent.prosperity || 500) * 0.8;
            // AI 当前波次强度
            const wave = this.pvpAiWavesSurvived;
            const waveStrength = 300 + wave * 80;
            // AI 防守成功概率
            const successRate = Math.max(0.1, Math.min(0.95, aiDefenseStrength / (aiDefenseStrength + waveStrength)));
            if (Math.random() < successRate) {
                this.pvpAiWavesSurvived++;
            } else {
                // 防守失败：AI 主灯损失
                const loss = Math.floor(waveStrength * 0.1);
                this.pvpAiLampHP = Math.max(0, this.pvpAiLampHP - loss);
            }
        }

        // ============================================================
        // ===== 阶段九：无尽模式（EndlessMode）=====
        // ============================================================
        _startEndless() {
            const cfg = (window.GameData && window.GameData.ENDLESS_CONFIG) || {};
            // 暂停经营产出
            if (window.GameState) {
                window.GameState.isEndlessMode = true;
                window.GameState.endlessRecord = window.GameState.endlessRecord || 0;
            }
            // 初始化无尽状态
            this.endlessMode = {
                running: true,
                wave: 0,
                maxWaveReached: 0,
                rewards: { coins: 0, scrolls: 0, inspiration: 0 },
                pendingQueue: []   // 超过 MAX_ENEMIES 时的待生成队列
            };
            // 初始化战斗（复用主线流程，但用虚拟关卡）
            this._ensureDom();
            this._showView('battle');
            this.currentLevelId = 0;       // 0 表示无尽模式
            this.endlessMode.wave = 0;

            // 重置局内遗物 + 应用永久遗物
            if (window.RelicSystem) {
                RelicSystem.resetRunRelics();
                RelicSystem.reapplyPermanentRelics();
            }

            // 初始资源
            const init = cfg.initialResources || { coins: 500, popularity: 100 };
            if (window.GameState) {
                window.GameState.addCoins(init.coins);
                window.GameState.addPopularity(init.popularity);
            }

            // 战斗状态重置
            this.enemies = [];
            this.towers = [];
            this.projectiles = [];
            this.floats = [];
            this.occupiedCells = new Set();
            this.lives = INIT_LIVES;
            this.bossRef = null;
            this.selectedTower = null;
            this.placementMode = false;
            this.placementCard = null;
            this.hoverCell = null;
            this.movingTower = null;
            this.paused = false;
            this.speed = 1;
            this.spawnCount = 0;
            this._pendingSpawns = [];

            // 路径用第 30 关（终极全图）
            this._buildPath(30);
            this.waves = [];
            this.totalWaves = Infinity;
            this.currentWave = 0;
            this.spawnQueue = [];
            this.spawnTimer = 0;
            this.prepPhase = true;
            this.prepTimer = 10;
            this.waveBreakTimer = 0;

            // 卡牌系统
            this.cardSystem = new CardSystem();
            for (let i = 0; i < 5; i++) this.cardSystem.drawCardWithoutMerge();

            // 生成第一波
            this._endlessBuildWave(1);

            // 显示无尽 HUD
            this._showEndlessHUD();

            // 关卡名显示
            const nameEl = document.getElementById('td-level-name');
            if (nameEl) nameEl.textContent = '无尽挑战';

            // 修复：补全 UI 刷新 + 渲染手牌（原漏调导致无卡牌可放）
            this._updateLivesUI();
            this._updateWaveUI();
            this._updatePopularityUI();
            this._renderHand();
            this._updateBossBar(null);
            this._showPrepBanner();
            this._updateActiveRelicsBar();

            this.running = true;
            this.lastTime = 0;
            this.gameLoopId = requestAnimationFrame((t) => this._gameLoop(t));
            if (window.AudioManager) window.AudioManager.playBGM('bgm-battle');
            this._toast('无尽挑战开始！每 5 波出现 BOSS，每 10 波可选遗物', 'info');
        }

        // 构建无尽模式第 waveNum 波
        _endlessBuildWave(waveNum) {
            const cfg = (window.GameData && window.GameData.ENDLESS_CONFIG) || {};
            const MAX = cfg.MAX_ENEMIES || 200;
            const entries = [];
            const isBossWave = waveNum % (cfg.bossInterval || 5) === 0;
            const hpMul = this._endlessGetHpMul(waveNum);
            const baseCount = (cfg.baseEnemyCount || 5) + Math.floor(waveNum / 3);
            const count = Math.min(cfg.maxPerWave || 30, baseCount);

            if (isBossWave) {
                // BOSS 数量随波次递增
                let bossCount = 1;
                if (waveNum >= 100 && cfg.multiBossWave100) bossCount = cfg.multiBossWave100;
                else if (waveNum >= 50 && cfg.multiBossWave50) bossCount = cfg.multiBossWave50;
                const bossPool = (window.GameData.ENEMY_DATA.boss || []).slice();
                for (let i = 0; i < bossCount; i++) {
                    const boss = bossPool[Math.floor(Math.random() * bossPool.length)];
                    entries.push({ kind: 'boss', id: boss.id, hpMul, delay: 1500 });
                }
                // 伴生小怪
                const adds = Math.min(10, 2 + Math.floor(waveNum / 5));
                for (let i = 0; i < adds; i++) entries.push({ kind: 'normal', hpMul, delay: 700 });
            } else if (waveNum <= 4) {
                // 前 4 波仅小怪
                for (let i = 0; i < count; i++) entries.push({ kind: 'normal', hpMul, delay: 800 });
            } else {
                // 5 波起小怪 + 精英混合
                const eliteChance = Math.min(0.4, 0.1 + waveNum * 0.01);
                for (let i = 0; i < count; i++) {
                    entries.push({ kind: Math.random() < eliteChance ? 'elite' : 'normal', hpMul, delay: 700 });
                }
            }

            // MAX_ENEMIES 控制：若场上敌人过多，先存入 pendingQueue
            const aliveCount = this.enemies.filter(e => e.alive).length;
            if (aliveCount + entries.length > MAX) {
                // 部分放入 pendingQueue，部分立即生成
                const allow = Math.max(0, MAX - aliveCount);
                const immediate = entries.slice(0, allow);
                const deferred = entries.slice(allow);
                this.waves.push(immediate);
                if (deferred.length > 0) this.endlessMode.pendingQueue.push(deferred);
            } else {
                this.waves.push(entries);
            }
            this.totalWaves = this.waves.length; // 用于循环判定
        }

        // 无尽模式 HP 倍率：1 + floor(wave/5)*0.2
        _endlessGetHpMul(waveNum) {
            const cfg = (window.GameData && window.GameData.ENDLESS_CONFIG) || {};
            const step = Math.floor(waveNum / (cfg.bossInterval || 5));
            return 1 + step * (cfg.hpStep || 0.2);
        }

        // 无尽模式波次清空回调（在 _updateWaves 中调用）
        _endlessOnWaveCleared() {
            if (!this.endlessMode || !this.endlessMode.running) return;
            const cfg = (window.GameData && window.GameData.ENDLESS_CONFIG) || {};
            this.endlessMode.wave++;
            const w = this.endlessMode.wave;
            if (w > this.endlessMode.maxWaveReached) this.endlessMode.maxWaveReached = w;

            // 阶段十：留存系统——无尽波次上报
            if (window.GameState && typeof window.GameState.setEndlessMaxWave === 'function') {
                try { window.GameState.setEndlessMaxWave(w); } catch (e) { /* ignore */ }
            }
            if (w >= 10 && window.DailyTasks) {
                try { DailyTasks.updateProgress('endless-wave-10', 10); } catch (e) { /* ignore */ }
            }
            if (window.Achievements) {
                try { Achievements.checkAll(); } catch (e) { /* ignore */ }
            }

            // 补充 pendingQueue 中的待生成敌人
            const MAX = cfg.MAX_ENEMIES || 200;
            const aliveCount = this.enemies.filter(e => e.alive).length;
            if (this.endlessMode.pendingQueue.length > 0 && aliveCount < (cfg.RESUME_THRESHOLD || 150)) {
                const deferred = this.endlessMode.pendingQueue.shift();
                this.waves.push(deferred);
            }

            // 波次奖励
            const wr = cfg.waveReward || { coins: 50, popularity: 10 };
            this.endlessMode.rewards.coins += wr.coins;
            this.endlessMode.rewards.popularity = (this.endlessMode.rewards.popularity || 0) + wr.popularity;
            if (window.GameState) {
                window.GameState.addCoins(wr.coins);
                window.GameState.addPopularity(wr.popularity);
            }

            // 每 10 波遗物三选一（修复：增加安全超时，防止回调未触发导致永久暂停）
            if (w % (cfg.relicInterval || 10) === 0 && window.RelicSystem) {
                this.paused = true;
                const resumeGame = () => {
                    this.paused = false;
                    this._endlessGenerateNext();
                };
                if (RelicSystem.showRelicChoice) {
                    RelicSystem.showRelicChoice(resumeGame);
                    // 安全兜底：5秒后自动恢复，防止 UI 未弹出导致卡死
                    setTimeout(() => {
                        if (this.paused && this.running) {
                            console.warn('[无尽模式] 遗物选择回调超时，自动恢复游戏');
                            resumeGame();
                        }
                    }, 5000);
                } else {
                    resumeGame();
                }
            } else {
                this._endlessGenerateNext();
            }

            // 每 10 波内存清理
            if (w % (cfg.cleanupInterval || 10) === 0) this._endlessCleanupStale();

            // BOSS 波预警
            const nextWave = w + 1;
            if (nextWave % (cfg.bossInterval || 5) === 0) this._endlessBossWarning();

            this._updateEndlessHUD();
        }

        _endlessGenerateNext() {
            const nextWave = this.endlessMode.wave + 1;
            this._endlessBuildWave(nextWave);
            // 进入下一波准备
            this.prepPhase = true;
            this.prepTimer = 8;
            this._showPrepBanner();
        }

        _endlessBossWarning() {
            const hud = document.getElementById('td-endless-hud');
            if (hud) {
                hud.classList.add('endless-boss-warning');
                setTimeout(() => hud.classList.remove('endless-boss-warning'), 2000);
            }
            this._toast('⚠ BOSS 波次即将到来！', 'warn');
        }

        _showEndlessHUD() {
            let hud = document.getElementById('td-endless-hud');
            if (!hud) {
                hud = document.createElement('div');
                hud.id = 'td-endless-hud';
                hud.className = 'endless-hud';
                const screen = document.getElementById('td-screen');
                if (screen) screen.appendChild(hud);
            }
            this._updateEndlessHUD();
            hud.classList.remove('hidden');
        }

        _updateEndlessHUD() {
            const hud = document.getElementById('td-endless-hud');
            if (!hud || !this.endlessMode) return;
            const w = this.endlessMode.wave;
            const max = this.endlessMode.maxWaveReached;
            const record = (window.GameState && window.GameState.endlessRecord) || 0;
            hud.innerHTML = `
                <div class="endless-wave-current">第 ${w} 波</div>
                <div class="endless-wave-max">历史最高：第 ${Math.max(max, record)} 波</div>`;
        }

        _cleanupEndlessUI() {
            const hud = document.getElementById('td-endless-hud');
            if (hud) hud.classList.add('hidden');
        }

        // 无尽模式内存清理
        _endlessCleanupStale() {
            // 清理已死亡的敌人（deathTimer<=0）
            this.enemies = this.enemies.filter(e => e.alive || (e.deathTimer && e.deathTimer > 0));
            // 清理超出屏幕的弹射物
            this.projectiles = this.projectiles.filter(p => p.x > -50 && p.x < CANVAS_W + 50 && p.y > -50 && p.y < CANVAS_H + 50);
            // 清理浮动文字
            this.floats = this.floats.filter(f => f.t < 1);
            // 粒子特效清理
            if (window.BattleFx) window.BattleFx.clear();
            if (window.EnemyFx) window.EnemyFx.clear();
        }

        // 无尽模式失败结算
        _endlessOnDefeat() {
            if (!this.endlessMode || !this.endlessMode.running) return;
            this.endlessMode.running = false;
            this.running = false;
            if (this.gameLoopId) { cancelAnimationFrame(this.gameLoopId); this.gameLoopId = null; }

            const maxWave = this.endlessMode.maxWaveReached;
            const rewards = this.endlessMode.rewards;
            // 记录最高波次
            if (window.GameState) {
                if (typeof window.GameState.setEndlessMaxWave === 'function') {
                    try { window.GameState.setEndlessMaxWave(maxWave); } catch (e) { /* ignore */ }
                } else if (maxWave > (window.GameState.endlessRecord || 0)) {
                    window.GameState.endlessRecord = maxWave;
                }
                window.GameState.save();
                window.GameState.isEndlessMode = false; // 恢复经营产出
            }
            // 阶段十：排行榜提交 + 成就检查
            if (window.Leaderboard && typeof window.Leaderboard.submitEndlessScore === 'function') {
                try { window.Leaderboard.submitEndlessScore(maxWave); } catch (e) { /* ignore */ }
            }
            if (window.Achievements) {
                try { Achievements.checkAll(); } catch (e) { /* ignore */ }
            }

            this._showEndlessResult(maxWave, rewards);
        }

        _showEndlessResult(maxWave, rewards) {
            // 复用 td-result 容器
            const modal = document.getElementById('td-result');
            if (!modal) return;
            modal.classList.remove('hidden');
            if (window.AudioManager) {
                window.AudioManager.stopBGM();
                window.AudioManager.playSound('defeat');
            }
            modal.innerHTML = `
                <div class="td-result-box endless-result">
                    <div class="td-result-title td-lose">无尽挑战结束</div>
                    <div class="td-result-sub">最高波次：第 ${maxWave} 波</div>
                    <div class="td-result-reward">
                        <div>💰 累计铜钱 +${rewards.coins || 0}</div>
                        <div>📈 累计人气 +${rewards.popularity || 0}</div>
                    </div>
                    <button id="td-endless-retry">再次挑战</button>
                    <button id="td-endless-exit">返回关卡选择</button>
                </div>`;
            const retry = document.getElementById('td-endless-retry');
            const exitBtn = document.getElementById('td-endless-exit');
            if (retry) retry.addEventListener('click', () => {
                modal.classList.add('hidden');
                this._startEndless();
            });
            if (exitBtn) exitBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
                this.exit();
            });
            this._cleanupEndlessUI();
        }

        // ============================================================
        // ===== 阶段九：特殊关卡（SpecialLevel）=====
        // ============================================================
        _startSpecial(specialId) {
            const cfg = (window.GameData && window.GameData.SPECIAL_LEVELS || {})[specialId];
            if (!cfg) return;
            this.specialMode = { id: specialId, cfg, running: true };

            // tower-restriction：设置塔种限制（仅设标记，不影响战斗初始化时序）
            if (specialId === 'tower-restriction') {
                this.specialMode.restrictedTypes = cfg.towerTypes || [];
            }

            // 进入对应地图关卡（startLevel 会弹遗物面板，选完后调用 _startLevelCore）
            // 特殊规则（boss-rush 重写波次、resource-restriction 减半资源）
            // 移至 _startLevelCore 中执行，避免被 _buildWaves 覆盖
            const mapIndex = cfg.mapLevelIndex || 15;
            this.startLevel(mapIndex);

            // 显示限制提示横幅
            this._showSpecialBanner(cfg);
        }

        _updateUIDeferred() {
            setTimeout(() => { if (window.GameState && window.GameState._updateUI) window.GameState._updateUI(); }, 50);
        }

        _applyBossRush(cfg) {
            // 重写波次：每个 BOSS 一波
            const bossOrder = cfg.bossOrder || [];
            const hpMul = cfg.bossHpMul || 0.8;
            this.waves = bossOrder.map(bossId => [{ kind: 'boss', id: bossId, hpMul }]);
            this.totalWaves = this.waves.length;
            this.currentWave = 0;
            this.spawnQueue = [];
            this.prepPhase = true;
            this.prepTimer = 8;
            this._showPrepBanner();
            this._toast('BOSS Rush：连续挑战 12 生肖 BOSS！', 'info');
        }

        _showSpecialBanner(cfg) {
            let banner = document.getElementById('special-restriction-banner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'special-restriction-banner';
                banner.className = 'special-banner hidden';
                const screen = document.getElementById('td-screen');
                if (screen) screen.appendChild(banner);
            }
            let restrictionText = cfg.description;
            if (cfg.id === 'tower-restriction') {
                restrictionText = `限制造型：只能使用 ${cfg.towerTypes.join('/')} 塔`;
            } else if (cfg.id === 'resource-restriction') {
                restrictionText = '资源限制：初始铜钱减半、人气获取减半';
            }
            banner.innerHTML = `${cfg.icon} ${restrictionText}`;
            banner.classList.remove('hidden');
        }

        _cleanupSpecialBanner() {
            const banner = document.getElementById('special-restriction-banner');
            if (banner) banner.classList.add('hidden');
            if (this.specialMode) {
                if (window.GameState) {
                    window.GameState.isResourceRestricted = false;
                    delete window.GameState._resourcePopularityMul;
                }
                this.specialMode = null;
            }
        }

        // 特殊关卡结算（胜利时发放独立奖励，不影响主线）
        _specialOnVictory() {
            if (!this.specialMode || !this.specialMode.running) return false;
            const cfg = this.specialMode.cfg;
            const r = cfg.reward || {};
            this.specialMode.running = false;
            if (window.GameState) {
                if (r.coins) window.GameState.addCoins(r.coins);
                if (r.scrolls) window.GameState.addScrolls(r.scrolls);
                if (r.inspiration) window.GameState.addInspiration(r.inspiration);
                // 记录特殊关卡完成
                if (!window.GameState.specialCompleted) window.GameState.specialCompleted = {};
                window.GameState.specialCompleted[cfg.id] = Date.now();
                window.GameState.save();
            }
            // 稀有遗物（boss-rush）
            if (r.relic === 'rare' && window.RelicSystem) {
                const relic = RelicSystem.rollPermanentRelic ? RelicSystem.rollPermanentRelic('rare') : null;
                if (relic) RelicSystem.applyRelic(relic.id, true);
            }
            this._toast(`特殊挑战完成！获得 铜钱${r.coins || 0} 卷轴${r.scrolls || 0} 灵感${r.inspiration || 0}`, 'success');
            return true;
        }

        // 特殊关卡结算 UI
        _showSpecialResult(isVictory) {
            const modal = document.getElementById('td-result');
            if (!modal) return;
            modal.classList.remove('hidden');
            const cfg = (this.specialMode && this.specialMode.cfg) || {};
            const r = cfg.reward || {};
            let html = '';
            if (isVictory) {
                html = `
                    <div class="td-result-box special-result">
                        <div class="td-result-title td-win">特殊挑战通关！</div>
                        <div class="td-result-sub">${cfg.name || ''}</div>
                        <div class="td-result-reward">
                            <div>💰 铜钱 +${r.coins || 0}</div>
                            <div>📜 卷轴 +${r.scrolls || 0}</div>
                            <div>✨ 灵感 +${r.inspiration || 0}</div>
                            ${r.relic === 'rare' ? '<div>💎 稀有永久遗物</div>' : ''}
                        </div>
                        <button id="td-special-exit">返回关卡选择</button>
                    </div>`;
            } else {
                html = `
                    <div class="td-result-box special-result">
                        <div class="td-result-title td-lose">挑战失败</div>
                        <div class="td-result-sub">${cfg.name || ''}</div>
                        <div class="td-result-reward"><div>下周可再次挑战</div></div>
                        <button id="td-special-exit">返回关卡选择</button>
                    </div>`;
            }
            modal.innerHTML = html;
            const exitBtn = document.getElementById('td-special-exit');
            if (exitBtn) exitBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
                this.exit();
            });
        }

        // 判断卡牌是否受特殊关卡塔种限制
        _isCardAllowedBySpecial(ichId) {
            if (!this.specialMode || !this.specialMode.running) return true;
            if (this.specialMode.id !== 'tower-restriction') return true;
            const ich = ichData(ichId);
            if (!ich) return true;
            const tt = ich.towerType || '';
            // 本周轮换的塔种（取第一个作为本周限制）
            const allowed = this.specialMode.restrictedTypes || [];
            if (allowed.length === 0) return true;
            const currentType = allowed[this._specialTypeIndex ? this._specialTypeIndex() : 0];
            if (!currentType) return true;
            return tt.indexOf(currentType) >= 0;
        }

        _specialTypeIndex() {
            // 按周轮换塔种索引
            const w = Math.floor((Date.now() - new Date('2026-01-01').getTime()) / (7 * 24 * 60 * 60 * 1000));
            return ((w % 4) + 4) % 4;
        }
    }

    window.TowerDefense = new TowerDefense();
})();
