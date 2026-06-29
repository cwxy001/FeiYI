/*
 * retention-system.js - 阶段十：留存系统（日常任务 + 成就系统）
 * 功能：
 *  - DailyTasks：每日随机 3 个任务 + 每周累计活跃度奖励
 *  - Achievements：经营/战斗/收集/特殊 4 类成就，解锁后领取奖励
 * 依赖：game-state.js（数据持久化）、relic-system.js（遗物奖励）、ui.js（toast）
 * 日期：2026-06-25
 */
(function () {
    'use strict';

    // ===== 日常任务池（8 种模板） =====
    const TASK_POOL = [
        { id: 'build-workshop',    name: '能工巧匠', description: '建造1个工坊',     target: 1,  activityReward: 20, icon: '🏗️' },
        { id: 'complete-level',    name: '闯关达人', description: '通关1次关卡',     target: 1,  activityReward: 20, icon: '⚔️' },
        { id: 'upgrade-workshop',  name: '精益求精', description: '升级工坊1次',     target: 1,  activityReward: 20, icon: '⬆️' },
        { id: 'recruit-master',    name: '寻访传人', description: '招募1个传承人',   target: 1,  activityReward: 20, icon: '👤' },
        { id: 'draw-cards',        name: '抽卡祈福', description: '抽卡3次',         target: 3,  activityReward: 30, icon: '🃏' },
        { id: 'merge-cards',       name: '三生万物', description: '三合一升级1次',   target: 1,  activityReward: 30, icon: '🔀' },
        { id: 'endless-wave-10',   name: '无尽征途', description: '无尽模式到达第10波', target: 10, activityReward: 40, icon: '🌊' },
        { id: 'defeat-enemies',    name: '降妖除魔', description: '击败50个敌人',     target: 50, activityReward: 30, icon: '👹' }
    ];

    // ===== 每周累计活跃度奖励（4 档） =====
    const WEEKLY_REWARDS = [
        { tier: 1, threshold: 100, reward: { coins: 500 },                              label: '铜钱 500' },
        { tier: 2, threshold: 300, reward: { scrolls: 5 },                              label: '卷轴 5' },
        { tier: 3, threshold: 500, reward: { inspiration: 50 },                         label: '灵感 50' },
        { tier: 4, threshold: 700, reward: { relic: 'rare' },                           label: '稀有遗物 1 个' }
    ];

    // ===== 永久遗物 ID 按稀有度分类（用于遗物奖励发放） =====
    const PERMANENT_RELIC_BY_RARITY = {
        rare:      ['heirloom-pendant', 'popularity-gourd', 'building-atlas'],
        legendary: ['lucky-charm']
    };
    // 遗物全部已拥有时的折算铜钱
    const RELIC_FALLBACK_COINS = { rare: 800, legendary: 2000 };

    // ===== 工具函数 =====

    /** 获取某时间戳当天 0 点的时间戳 */
    function _dayStart(ts) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    /** 获取某时间戳所在周周一 0 点的时间戳 */
    function _weekStart(ts) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        // getDay: 0=周日, 1=周一...; 周一作为一周起点
        const day = d.getDay();
        const diff = (day === 0 ? 6 : day - 1); // 距周一的天数
        d.setDate(d.getDate() - diff);
        return d.getTime();
    }

    /** 显示 toast（兼容 UI.showToast） */
    function _toast(msg, type) {
        if (window.UI && typeof window.UI.showToast === 'function') {
            window.UI.showToast(msg, 2000, type || 'info');
        }
    }

    /**
     * 发放遗物奖励：从永久池中按稀有度随机发放未拥有的；全部已拥有则折算铜钱
     * @param {string} rarity - rare / legendary
     * @returns {string} 实际发放结果描述
     */
    function _grantRelicReward(rarity) {
        const gs = window.GameState;
        const candidates = (PERMANENT_RELIC_BY_RARITY[rarity] || []).filter(id => {
            return !(gs && gs.hasRelic(id));
        });

        if (candidates.length > 0 && window.RelicSystem) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            // 应用永久遗物
            window.RelicSystem.applyRelic(pick, true);
            const relic = window.RelicSystem.getRelicById(pick);
            return `稀有遗物「${relic ? relic.name : pick}」`;
        }

        // 全部已拥有，折算铜钱
        const coins = RELIC_FALLBACK_COINS[rarity] || 800;
        if (gs) gs.addCoins(coins);
        return `铜钱 ${coins}（遗物已集齐）`;
    }

    /**
     * 发放奖励对象 { coins, scrolls, inspiration, relic }
     * @returns {string} 奖励描述
     */
    function _grantReward(reward) {
        const gs = window.GameState;
        const parts = [];
        if (!reward) return '';
        if (reward.coins) { if (gs) gs.addCoins(reward.coins); parts.push(`铜钱 +${reward.coins}`); }
        if (reward.scrolls) { if (gs) gs.addScrolls(reward.scrolls); parts.push(`卷轴 +${reward.scrolls}`); }
        if (reward.inspiration) { if (gs) gs.addInspiration(reward.inspiration); parts.push(`灵感 +${reward.inspiration}`); }
        if (reward.relic) { parts.push(_grantRelicReward(reward.relic)); }
        return parts.join('，');
    }

    // ===== 日常任务系统 =====
    const DailyTasks = {
        /** 初始化：检查刷新 */
        init() {
            this.checkRefresh();
            console.log('[DailyTasks] 初始化完成，当前任务数:', (window.GameState.dailyTasks || []).length);
        },

        /** 检查是否需要刷新（每日 + 每周） */
        checkRefresh() {
            const gs = window.GameState;
            const now = Date.now();

            // 每日刷新：当天 0 点与上次刷新日期不同
            const todayStart = _dayStart(now);
            const lastDaily = gs.lastDailyRefreshDate || 0;
            if (_dayStart(lastDaily) !== todayStart) {
                this.refreshDailyTasks();
            }

            // 每周刷新：本周周一 0 点与上次不同
            const thisWeekStart = _weekStart(now);
            const lastWeekly = gs.lastWeeklyRefreshDate || 0;
            if (_weekStart(lastWeekly) !== thisWeekStart) {
                gs.weeklyActivity = 0;
                gs.weeklyRewardsClaimed = [];
                gs.lastWeeklyRefreshDate = thisWeekStart;
                gs.save();
                console.log('[DailyTasks] 每周活跃度已重置');
            }
        },

        /** 刷新每日任务：从池中随机抽取 3 个不重复任务 */
        refreshDailyTasks() {
            const gs = window.GameState;
            const pool = TASK_POOL.slice();
            const picked = [];
            const count = Math.min(3, pool.length);
            for (let i = 0; i < count; i++) {
                const idx = Math.floor(Math.random() * pool.length);
                const tpl = pool.splice(idx, 1)[0];
                picked.push({
                    taskId: tpl.id,
                    name: tpl.name,
                    description: tpl.description,
                    target: tpl.target,
                    progress: 0,
                    completed: false,
                    claimed: false,
                    activityReward: tpl.activityReward,
                    icon: tpl.icon
                });
            }
            gs.dailyTasks = picked;
            gs.lastDailyRefreshDate = _dayStart(Date.now());
            gs.save();
            console.log('[DailyTasks] 每日任务已刷新:', picked.map(t => t.name).join('、'));
        },

        /**
         * 更新任务进度
         * @param {string} taskId - 任务模板 ID
         * @param {number} amount - 增量
         */
        updateProgress(taskId, amount) {
            const gs = window.GameState;
            const tasks = gs.dailyTasks || [];
            let changed = false;
            for (const t of tasks) {
                if (t.taskId !== taskId) continue;
                if (t.completed) continue; // 已完成则跳过，不重复计算
                t.progress = Math.min(t.progress + amount, t.target);
                if (t.progress >= t.target) {
                    t.completed = true;
                }
                changed = true;
                break;
            }
            if (changed) {
                gs.save();
                // 更新 UI（任务面板打开时）
                if (window.Management && typeof window.Management.renderDailyTasks === 'function') {
                    const panel = document.getElementById('daily-tasks-panel');
                    if (panel && !panel.classList.contains('hidden')) {
                        window.Management.renderDailyTasks();
                    }
                }
                if (window.Management && typeof window.Management.updateTaskBadge === 'function') {
                    window.Management.updateTaskBadge();
                }
            }
        },

        /**
         * 领取单个任务奖励
         * @param {string} taskId - 任务模板 ID
         * @returns {boolean} 是否领取成功
         */
        claimReward(taskId) {
            const gs = window.GameState;
            const tasks = gs.dailyTasks || [];
            const t = tasks.find(x => x.taskId === taskId);
            if (!t || !t.completed || t.claimed) return false;

            t.claimed = true;
            // 增加活跃度
            gs.weeklyActivity += t.activityReward;
            // 给予资源奖励（铜钱 100、人气 10）
            gs.addCoins(100);
            gs.addPopularity(10);
            gs.save();

            const desc = `铜钱 +100，人气 +10，活跃度 +${t.activityReward}`;
            _toast(`「${t.name}」奖励：${desc}`, 'success');

            // 飘浮文字效果
            if (window.Management && typeof window.Management._floatText === 'function') {
                window.Management._floatText(`+${t.activityReward} 活跃度`, '#FFD700');
            }
            return true;
        },

        /**
         * 领取周累计活跃度奖励
         * @param {number} tier - 等级 1-4
         * @returns {boolean} 是否领取成功
         */
        claimWeeklyReward(tier) {
            const gs = window.GameState;
            const wr = WEEKLY_REWARDS.find(w => w.tier === tier);
            if (!wr) return false;
            if (gs.weeklyActivity < wr.threshold) {
                _toast('活跃度不足', 'info');
                return false;
            }
            if ((gs.weeklyRewardsClaimed || []).includes(tier)) {
                _toast('该档奖励已领取', 'info');
                return false;
            }
            gs.weeklyRewardsClaimed.push(tier);
            gs.save();
            const desc = _grantReward(wr.reward);
            _toast(`周活跃度奖励（${wr.label}）：${desc}`, 'success');
            return true;
        },

        /** 获取当前每日任务列表 */
        getDailyTasks() {
            return window.GameState.dailyTasks || [];
        },

        /** 获取本周活跃度进度信息 */
        getWeeklyProgress() {
            const gs = window.GameState;
            const current = gs.weeklyActivity || 0;
            let nextThreshold = null;
            for (const wr of WEEKLY_REWARDS) {
                if (current < wr.threshold) { nextThreshold = wr.threshold; break; }
            }
            return { current, nextThreshold, rewards: WEEKLY_REWARDS, claimed: gs.weeklyRewardsClaimed || [] };
        },

        /** 获取距下次每日刷新的倒计时描述 */
        getRefreshCountdown() {
            const now = Date.now();
            const tomorrow = _dayStart(now) + 24 * 60 * 60 * 1000;
            const diff = tomorrow - now;
            const hours = Math.floor(diff / (60 * 60 * 1000));
            const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
            return `距离下次刷新：${hours} 小时 ${minutes} 分钟`;
        }
    };

    // ===== 成就系统 =====

    /** 构造成就检查函数（延迟绑定 GameState，保持幂等） */
    function _gs() { return window.GameState; }
    function _workshopCount() { return (_gs().workshops || []).length; }
    function _masterCount() {
        // 拥有传承人的工坊数
        return (_gs().workshops || []).filter(w => w.master).length;
    }
    function _decorCount() { return (_gs().decorations || []).length; }
    function _completedLevelCount() { return (_gs().completedLevels || []).length; }
    function _endlessMaxWave() { return _gs().endlessRecord || 0; }
    function _mergeCount() { return _gs().totalMergeCount || 0; }
    function _coinsEarned() { return _gs().totalCoinsEarned || 0; }
    function _consecutiveLogin() { return _gs().consecutiveLoginDays || 0; }
    function _ichUnlocked() { return (_gs().collection && _gs().collection.ich ? _gs().collection.ich.length : 0); }
    function _collectionTotal() {
        const c = _gs().collection || {};
        return (c.ich ? c.ich.length : 0) + (c.material ? c.material.length : 0) + (c.monster ? c.monster.length : 0);
    }
    function _relicCount() { return (_gs().permanentRelics || []).length; }
    function _relicTotal() {
        // 永久遗物总数（rare 3 + epic 1 + legendary 1 = 5）
        return 5;
    }
    function _allLevelsThreeStar() {
        const stars = _gs().levelStars || {};
        // 30 关全部 3 星
        for (let i = 1; i <= 30; i++) {
            if ((stars[i] || 0) < 3) return false;
        }
        return true;
    }
    function _hasNoDamageClear() {
        // 至少有一关标记为无伤通关（存储于 achievementProgress）
        const ap = _gs().achievementProgress || {};
        return !!ap.noDamageLevel;
    }

    /** 成就定义列表 */
    const ACHIEVEMENT_LIST = [
        // ===== 经营成就 =====
        { id: 'biz-build-10',     name: '初具规模',   description: '建造10个工坊',     category: 'business',   condition: '工坊数≥10',      icon: '🏗️', checkFn: () => _workshopCount() >= 10,  reward: { coins: 1000 } },
        { id: 'biz-build-20',     name: '匠心独运',   description: '建造20个工坊',     category: 'business',   condition: '工坊数≥20',      icon: '🏭', checkFn: () => _workshopCount() >= 20,  reward: { scrolls: 5 } },
        { id: 'biz-build-all',    name: '万匠齐工',   description: '建造全部工坊',     category: 'business',   condition: '工坊数≥24',      icon: '🏯', checkFn: () => _workshopCount() >= 24,  reward: { inspiration: 100 } },
        { id: 'biz-output-10k',   name: '日进斗金',   description: '累计产出10000铜钱', category: 'business',   condition: '累计铜钱≥10000', icon: '💰', checkFn: () => _coinsEarned() >= 10000,  reward: { scrolls: 3 } },
        { id: 'biz-output-100k',  name: '富甲一方',   description: '累计产出100000铜钱',category: 'business',   condition: '累计铜钱≥100000',icon: '🏦', checkFn: () => _coinsEarned() >= 100000, reward: { relic: 'rare' } },
        { id: 'biz-master-5',     name: '寻师访友',   description: '招募5个传承人',    category: 'business',   condition: '传承人≥5',       icon: '👤', checkFn: () => _masterCount() >= 5,     reward: { coins: 800 } },
        { id: 'biz-master-all',   name: '桃李满天下', description: '招募全部传承人',   category: 'business',   condition: '传承人≥24',      icon: '🎓', checkFn: () => _masterCount() >= 24,    reward: { inspiration: 80 } },
        { id: 'biz-decor-10',     name: '锦上添花',   description: '放置10个装饰',     category: 'business',   condition: '装饰数≥10',      icon: '🏮', checkFn: () => _decorCount() >= 10,     reward: { coins: 600 } },
        { id: 'biz-decor-all',    name: '美轮美奂',   description: '放置全部装饰',     category: 'business',   condition: '装饰数≥6',       icon: '🎑', checkFn: () => _decorCount() >= 6,      reward: { scrolls: 3 } },

        // ===== 战斗成就 =====
        { id: 'battle-clear-1',      name: '初战告捷', description: '通关1关',          category: 'battle', condition: '通关数≥1',     icon: '⚔️', checkFn: () => _completedLevelCount() >= 1,  reward: { coins: 500 } },
        { id: 'battle-clear-12',     name: '身经百战', description: '通关12关',         category: 'battle', condition: '通关数≥12',    icon: '🛡️', checkFn: () => _completedLevelCount() >= 12, reward: { scrolls: 5 } },
        { id: 'battle-clear-30',     name: '功德圆满', description: '通关30关',         category: 'battle', condition: '通关数≥30',    icon: '🏆', checkFn: () => _completedLevelCount() >= 30, reward: { inspiration: 100 } },
        { id: 'battle-endless-10',   name: '无尽探索', description: '无尽模式到达10波', category: 'battle', condition: '最高波次≥10',  icon: '🌊', checkFn: () => _endlessMaxWave() >= 10,     reward: { coins: 800 } },
        { id: 'battle-endless-50',   name: '无尽征伐', description: '无尽模式到达50波', category: 'battle', condition: '最高波次≥50',  icon: '🌀', checkFn: () => _endlessMaxWave() >= 50,     reward: { relic: 'rare' } },
        { id: 'battle-endless-100',  name: '无尽传说', description: '无尽模式到达100波',category: 'battle', condition: '最高波次≥100', icon: '🐉', checkFn: () => _endlessMaxWave() >= 100,    reward: { relic: 'legendary' } },
        { id: 'battle-merge-10',     name: '融会贯通', description: '三合一升级10次',   category: 'battle', condition: '合并次数≥10',  icon: '🔀', checkFn: () => _mergeCount() >= 10,         reward: { coins: 600 } },
        { id: 'battle-merge-50',     name: '炉火纯青', description: '三合一升级50次',   category: 'battle', condition: '合并次数≥50',  icon: '✨', checkFn: () => _mergeCount() >= 50,         reward: { scrolls: 5 } },
        { id: 'battle-merge-100',    name: '出神入化', description: '三合一升级100次',  category: 'battle', condition: '合并次数≥100', icon: '🌟', checkFn: () => _mergeCount() >= 100,        reward: { inspiration: 80 } },
        { id: 'battle-no-damage',    name: '固若金汤', description: '不损失主灯通关',   category: 'battle', condition: '单关主灯无损伤',icon: '🏰', checkFn: () => _hasNoDamageClear(),         reward: { relic: 'rare' } },

        // ===== 收集成就 =====
        { id: 'collect-ich-10',     name: '初窥门径', description: '图鉴解锁10项',     category: 'collection', condition: '图鉴解锁≥10',  icon: '📖', checkFn: () => _collectionTotal() >= 10, reward: { coins: 500 } },
        { id: 'collect-ich-30',     name: '博览群书', description: '图鉴解锁30项',     category: 'collection', condition: '图鉴解锁≥30',  icon: '📚', checkFn: () => _collectionTotal() >= 30, reward: { scrolls: 5 } },
        { id: 'collect-ich-all',    name: '包罗万象', description: '图鉴全部解锁',     category: 'collection', condition: '图鉴解锁=总数', icon: '🗂️', checkFn: () => {
            // 总数动态计算：ich(24) + material + monster
            const total = _collectionTotal();
            const maxTotal = _maxCollectionTotal();
            return total >= maxTotal && maxTotal > 0;
        }, reward: { inspiration: 100 } },
        { id: 'collect-relic-5',    name: '初识遗珍', description: '遗物收集5个',      category: 'collection', condition: '遗物数≥5',     icon: '📿', checkFn: () => _relicCount() >= 5,  reward: { coins: 600 } },
        { id: 'collect-relic-15',   name: '遗珍鉴赏', description: '遗物收集15个',     category: 'collection', condition: '遗物数≥15',    icon: '🔮', checkFn: () => _relicCount() >= 15, reward: { scrolls: 5 } },
        { id: 'collect-relic-all',  name: '遗珍尽收', description: '遗物全部收集',     category: 'collection', condition: '遗物数=总数',   icon: '💎', checkFn: () => _relicCount() >= _relicTotal(), reward: { relic: 'legendary' } },

        // ===== 特殊成就 =====
        { id: 'special-first-clear', name: '破冰之旅',   description: '首次通关',         category: 'special', condition: '完成首次通关',     icon: '🚀', checkFn: () => _completedLevelCount() >= 1,  reward: { coins: 500 } },
        { id: 'special-all-3star',   name: '完美无瑕',   description: '全部关卡三星',     category: 'special', condition: '全部30关3星',      icon: '⭐', checkFn: () => _allLevelsThreeStar(),       reward: { relic: 'legendary' } },
        { id: 'special-login-7',     name: '七日之约',   description: '连续登录7天',      category: 'special', condition: '连续登录≥7天',     icon: '📅', checkFn: () => _consecutiveLogin() >= 7,    reward: { scrolls: 3 } },
        { id: 'special-login-30',    name: '月度勤勉',   description: '连续登录30天',     category: 'special', condition: '连续登录≥30天',    icon: '🗓️', checkFn: () => _consecutiveLogin() >= 30,   reward: { relic: 'rare' } }
    ];

    /** 图鉴总条目数（ich 24 + material + monster 动态） */
    function _maxCollectionTotal() {
        let total = 0;
        const gd = window.GameData || {};
        if (gd.ICH_LIST) total += gd.ICH_LIST.length;
        // material / monster 图鉴总数：从 GameData 推断（若无则用已完成关卡的 boss + ich）
        // 这里用 LEVELS 中 boss 数 + ICH_LIST 数作为近似总数下限
        if (gd.LEVELS) total += gd.LEVELS.length; // 每关一个 boss 图鉴
        return total;
    }

    const Achievements = {
        /** 初始化 */
        init() {
            console.log('[Achievements] 初始化完成，成就总数:', ACHIEVEMENT_LIST.length, '已解锁:', (_gs().unlockedAchievements || []).length);
        },

        /**
         * 检查所有成就解锁条件（幂等：已解锁的跳过）
         * 解锁时加入 unlockedAchievements，显示通知
         */
        checkAll() {
            const gs = _gs();
            if (!gs) return;
            const unlocked = gs.unlockedAchievements || [];
            let newlyUnlocked = 0;
            for (const ach of ACHIEVEMENT_LIST) {
                if (unlocked.includes(ach.id)) continue; // 已解锁跳过
                try {
                    if (ach.checkFn()) {
                        unlocked.push(ach.id);
                        newlyUnlocked++;
                        this._showNotification(ach);
                    }
                } catch (e) {
                    console.warn('[Achievements] 检查失败:', ach.id, e);
                }
            }
            if (newlyUnlocked > 0) {
                gs.unlockedAchievements = unlocked;
                gs.save();
                // 更新成就面板（打开时）
                if (window.Management && typeof window.Management.renderAchievements === 'function') {
                    const panel = document.getElementById('achievements-panel');
                    if (panel && !panel.classList.contains('hidden')) {
                        window.Management.renderAchievements();
                    }
                }
            }
        },

        /**
         * 领取成就奖励
         * @param {string} achievementId
         * @returns {boolean}
         */
        claimReward(achievementId) {
            const gs = _gs();
            const ach = ACHIEVEMENT_LIST.find(a => a.id === achievementId);
            if (!ach) return false;
            if (!(gs.unlockedAchievements || []).includes(achievementId)) {
                _toast('成就未解锁', 'info');
                return false;
            }
            if ((gs.claimedAchievements || []).includes(achievementId)) {
                _toast('奖励已领取', 'info');
                return false;
            }
            gs.claimedAchievements.push(achievementId);
            gs.save();
            const desc = _grantReward(ach.reward);
            _toast(`成就「${ach.name}」奖励：${desc}`, 'success');
            return true;
        },

        /** 按分类获取成就列表 */
        getAchievementsByCategory(category) {
            return ACHIEVEMENT_LIST.filter(a => a.category === category);
        },

        /** 获取全部成就 */
        getAllAchievements() {
            return ACHIEVEMENT_LIST;
        },

        /** 已解锁成就数量 */
        getUnlockedCount() {
            return (_gs().unlockedAchievements || []).length;
        },

        /** 总成就数量 */
        getTotalCount() {
            return ACHIEVEMENT_LIST.length;
        },

        /** 成就是否已解锁 */
        isUnlocked(id) {
            return (_gs().unlockedAchievements || []).includes(id);
        },

        /** 成就奖励是否已领取 */
        isClaimed(id) {
            return (_gs().claimedAchievements || []).includes(id);
        },

        /**
         * 标记某关无伤通关（用于 battle-no-damage 成就）
         * @param {number|string} levelId
         */
        markNoDamageClear(levelId) {
            const gs = _gs();
            if (!gs.achievementProgress) gs.achievementProgress = {};
            gs.achievementProgress.noDamageLevel = levelId;
            gs.save();
        },

        /** 显示成就解锁通知（右侧滑入，3 秒后滑出） */
        _showNotification(ach) {
            if (window.AudioManager) {
                try { window.AudioManager.playSound('relic-reward', 0.8); } catch (e) {}
            }
            const container = document.getElementById('achievement-notification');
            if (!container) {
                _toast(`🏆 成就解锁：${ach.name}`, 'success');
                return;
            }
            const el = document.createElement('div');
            el.className = 'achievement-notification-card';
            el.innerHTML = `
                <div class="ach-notif-icon">${ach.icon}</div>
                <div class="ach-notif-body">
                    <div class="ach-notif-title">🏆 成就解锁</div>
                    <div class="ach-notif-name">${ach.name}</div>
                    <div class="ach-notif-desc">${ach.description}</div>
                </div>
            `;
            container.appendChild(el);
            // 触发滑入动画
            requestAnimationFrame(() => el.classList.add('show'));
            // 3 秒后滑出并移除
            setTimeout(() => {
                el.classList.remove('show');
                setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
            }, 3000);
        }
    };

    // ===== 暴露全局对象 =====
    window.DailyTasks = DailyTasks;
    window.Achievements = Achievements;
    // 暴露常量供 UI 层使用
    window.RETENTION_CONST = { TASK_POOL, WEEKLY_REWARDS, ACHIEVEMENT_LIST };

    console.log('[retention-system.js] 已加载：DailyTasks + Achievements');
})();
