/*
 * data-integration.js - 经营与塔防数据联通
 * 功能：桥接 GameState（经营存档）与塔防战斗系统，提供可用防御塔、塔等级、
 *       传承人查询，以及关卡胜利后的奖励发放与图鉴/关卡解锁。
 * 日期：2026-06-23
 */

const DataIntegration = {
    /**
     * 获取当前可用作防御塔的非遗 ID 列表（去重）
     * 来源：GameState.workshops 中已建造的工坊
     * @returns {string[]} heritageId 数组
     */
    getAvailableTowers() {
        const workshops = (window.GameState && window.GameState.workshops) || [];
        const ids = [];
        workshops.forEach(w => {
            if (w && w.id && !ids.includes(w.id)) {
                ids.push(w.id);
            }
        });
        return ids;
    },

    /**
     * 获取某类非遗工坊的最高等级（用于决定防御塔初始等级）
     * @param {string} heritageId - 非遗 ID
     * @returns {number} 等级（未建造返回 0）
     */
    getTowerLevel(heritageId) {
        const workshops = (window.GameState && window.GameState.workshops) || [];
        let maxLevel = 0;
        workshops.forEach(w => {
            if (w && w.id === heritageId) {
                const lv = w.level || 1;
                if (lv > maxLevel) maxLevel = lv;
            }
        });
        return maxLevel;
    },

    /**
     * 获取拥有传承人的非遗 ID 列表（传承人可增强对应防御塔）
     * @returns {string[]} heritageId 数组
     */
    getMasters() {
        const workshops = (window.GameState && window.GameState.workshops) || [];
        const ids = [];
        workshops.forEach(w => {
            if (w && w.hasMaster && w.id && !ids.includes(w.id)) {
                ids.push(w.id);
            }
        });
        return ids;
    },

    /**
     * 关卡胜利处理：发放奖励、解锁图鉴、解锁下一关
     * 注意：奖励仅在首次通关时发放，避免重复（completeLevel 内部对完成记录去重）
     * @param {number} levelId - 关卡 ID（1-12）
     */
    onLevelVictory(levelId) {
        const gs = window.GameState;
        if (!gs) {
            console.warn('DataIntegration.onLevelVictory: GameState 不存在');
            return;
        }

        const alreadyCompleted = (gs.completedLevels || []).includes(levelId);

        // 标记完成 + 解锁下一关（completeLevel 内部去重）
        gs.completeLevel(levelId);

        // 仅首次通关发放奖励，避免重复
        if (!alreadyCompleted) {
            const levels = (window.GameData && window.GameData.LEVELS) || [];
            const levelData = levels.find(l => l.id === levelId);

            if (levelData && levelData.reward) {
                const r = levelData.reward;
                if (r.coins) gs.addCoins(r.coins);
                if (r.scrolls) gs.addScrolls(r.scrolls);
                if (r.inspiration) gs.addInspiration(r.inspiration);
            }

            // 解锁对应非遗图鉴（按时辰匹配：关卡 name 即时辰，如"子时"）
            const ichList = (window.GameData && window.GameData.ICH_LIST) || [];
            if (levelData) {
                const ich = ichList.find(i => i.hour === levelData.name);
                if (ich) {
                    // 阶段四：首次解锁时触发动画
                    const ichAlready = gs.isCollectionUnlocked('ich', ich.id);
                    gs.unlockCollection('ich', ich.id);
                    if (!ichAlready && window.Management && window.Management.triggerUnlockAnimation) {
                        window.Management.triggerUnlockAnimation('ich', ich.id);
                    }
                }
                // 解锁 BOSS 图鉴
                if (levelData.boss) {
                    const monsterAlready = gs.isCollectionUnlocked('monster', levelData.boss);
                    gs.unlockCollection('monster', levelData.boss);
                    if (!monsterAlready && window.Management && window.Management.triggerUnlockAnimation) {
                        window.Management.triggerUnlockAnimation('monster', levelData.boss, { blocking: false });
                    }
                }
            }

            // 解锁新地图地块：当前 16x16 网格已全开放，
            // 此处通过解锁下一关（=解锁更高 unlockLevel 的工坊类型）体现进度扩展。
        }

        // 同步资源栏 UI
        if (typeof gs._updateUI === 'function') {
            gs._updateUI();
        }
        if (window.UI && typeof window.UI.updateResources === 'function') {
            window.UI.updateResources({
                coins: gs.coins,
                inspiration: gs.inspiration,
                scrolls: gs.scrolls,
                popularity: gs.popularity
            });
        }

        gs.save();
    }
};

window.DataIntegration = DataIntegration;
