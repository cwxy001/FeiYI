/*
 * pvp-core.test.js - PVP系统核心逻辑单元测试
 * 覆盖：进攻令恢复、匹配机制、AI玩家生成、PVP评级计算
 * 环境：jsdom（提供 window/localStorage），mock GameState/GameData
 */

import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';

// ============ Mock 全局环境 ============
// 在加载 pvp-system.js 前，需要 window.GameState / window.GameData 就绪

function setupMockGameState(overrides = {}) {
    const defaults = {
        coins: 99999,
        inspiration: 9999,
        scrolls: 999,
        popularity: 0,
        workshops: [
            { id: 'w1', level: 3 },
            { id: 'w2', level: 2 },
            { id: 'w3', level: 4 },
            { id: 'w4', level: 1 },
            { id: 'w5', level: 2 },
            { id: 'w6', level: 5 },
            { id: 'w7', level: 1 },
            { id: 'w8', level: 2 }
        ],
        decorations: [{ beauty: 100 }, { beauty: 50 }],
        pvpAttackTokens: 5,
        pvpLastTokenRecoverTime: 0,
        pvpAttackDeck: [],
        pvpDefenseFormation: [],
        pvpBattleLog: { 'attack-defense': [], 'sync-battle': [], 'defense-race': [] },
        pvpStats: {
            'attack-defense': { win: 0, lose: 0 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        },
        pvpCurrentMode: null,
        addCoins: function (n) { this.coins += n; },
        addInspiration: function (n) { this.inspiration += n; },
        addScrolls: function (n) { this.scrolls += n; },
        savePvpData: function () {}
    };
    const gs = Object.assign({}, defaults, overrides);
    // 保留方法引用
    gs.addCoins = defaults.addCoins;
    gs.addInspiration = defaults.addInspiration;
    gs.addScrolls = defaults.addScrolls;
    gs.savePvpData = defaults.savePvpData;
    window.GameState = gs;
}

function setupMockGameData() {
    // 构造 12 个工坊供 AI 进攻卡组生成使用
    const ichList = [];
    for (let i = 1; i <= 12; i++) {
        ichList.push({ id: `ich-${i}`, name: `非遗${i}`, emoji: '✨' });
    }
    window.GameData = { ICH_LIST: ichList };
}

// 加载被测模块（在 mock 之后）
let PvpSystem, AIPlayerSystem;
beforeEach(async () => {
    // jsdom 已提供 localStorage
    localStorage.clear();
    setupMockGameData();
    setupMockGameState();

    // 动态加载 pvp-system.js（每次测试重新加载，确保隔离）
    // 由于文件直接挂载到 window，需用 fs 读取再 eval，或用 vitest 的 import
    // 这里采用直接 import 方式（vitest 支持 ESM）
    vi.resetModules();
    const mod = await import('../js/pvp-system.js');
    PvpSystem = window.PvpSystem;
    AIPlayerSystem = window.AIPlayerSystem;
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
});

// ============ AI玩家生成测试 ============
describe('AIPlayerSystem 生成', () => {
    beforeEach(() => {
        AIPlayerSystem.aiPlayers = [];
        AIPlayerSystem.generateAIPlayers();
    });

    it('应生成100个AI玩家', () => {
        expect(AIPlayerSystem.aiPlayers.length).toBe(100);
    });

    it('AI玩家ID格式为ai-001..ai-100且不重复', () => {
        const ids = AIPlayerSystem.aiPlayers.map(a => a.id);
        expect(new Set(ids).size).toBe(100);
        expect(AIPlayerSystem.aiPlayers[0].id).toBe('ai-001');
        expect(AIPlayerSystem.aiPlayers[99].id).toBe('ai-100');
    });

    it('AI玩家名字全部不重复', () => {
        const names = AIPlayerSystem.aiPlayers.map(a => a.name);
        expect(new Set(names).size).toBe(100);
    });

    it('繁荣度分布大致符合 10%高/30%中/60%低', () => {
        const high = AIPlayerSystem.aiPlayers.filter(a => a.prosperity >= 5000).length;
        const mid = AIPlayerSystem.aiPlayers.filter(a => a.prosperity >= 2000 && a.prosperity < 5000).length;
        const low = AIPlayerSystem.aiPlayers.filter(a => a.prosperity < 2000).length;
        // 允许较大容差（随机性），验证大致比例
        expect(high).toBeGreaterThan(3);    // 10% → ~10，容差到3
        expect(mid).toBeGreaterThan(15);    // 30% → ~30，容差到15
        expect(low).toBeGreaterThan(30);    // 60% → ~60，容差到30
        expect(high + mid + low).toBe(100);
    });

    it('每个AI玩家都有合法的防御阵型（3-8塔）', () => {
        AIPlayerSystem.aiPlayers.forEach(ai => {
            expect(ai.defenseFormation.length).toBeGreaterThanOrEqual(3);
            expect(ai.defenseFormation.length).toBeLessThanOrEqual(8);
        });
    });

    it('每个AI玩家都有合法的进攻卡组（5-8工坊）', () => {
        AIPlayerSystem.aiPlayers.forEach(ai => {
            expect(ai.attackDeck.length).toBeGreaterThanOrEqual(5);
            expect(ai.attackDeck.length).toBeLessThanOrEqual(8);
        });
    });

    it('每个AI玩家防御阵型位置不重叠', () => {
        AIPlayerSystem.aiPlayers.forEach(ai => {
            const pos = new Set();
            ai.defenseFormation.forEach(t => {
                const key = `${t.gridX},${t.gridY}`;
                expect(pos.has(key)).toBe(false);
                pos.add(key);
                // 不超出边界
                expect(t.gridX).toBeGreaterThanOrEqual(0);
                expect(t.gridX).toBeLessThan(16);
                expect(t.gridY).toBeGreaterThanOrEqual(0);
                expect(t.gridY).toBeLessThan(16);
            });
        });
    });

    it('每个AI玩家都有pvpStats和pvpRating', () => {
        AIPlayerSystem.aiPlayers.forEach(ai => {
            expect(ai.pvpStats).toBeDefined();
            expect(ai.pvpStats['attack-defense']).toBeDefined();
            expect(ai.pvpStats['sync-battle']).toBeDefined();
            expect(ai.pvpStats['defense-race']).toBeDefined();
            expect(['S', 'A', 'B', 'C', 'D']).toContain(ai.pvpRating);
        });
    });
});

// ============ 进攻令恢复测试 ============
describe('PvpSystem 进攻令恢复', () => {
    beforeEach(() => {
        PvpSystem.init();
    });

    it('初始进攻令为5/5，checkTokenRecovery后lastTokenRecoverTime重置为now', () => {
        const before = Date.now();
        PvpSystem.checkTokenRecovery();
        const after = Date.now();
        expect(PvpSystem.attackTokens).toBe(5);
        expect(PvpSystem.lastTokenRecoverTime).toBeGreaterThanOrEqual(before);
        expect(PvpSystem.lastTokenRecoverTime).toBeLessThanOrEqual(after);
    });

    it('消耗1个令后变为4，再过1小时恢复为5', () => {
        // 先满状态checkTokenRecovery让时间戳=now
        PvpSystem.checkTokenRecovery();
        const now = Date.now();
        // 模拟消耗
        window.GameState.pvpAttackTokens = 5;
        PvpSystem.syncFromGameState();
        expect(PvpSystem.consumeToken()).toBe(true);
        expect(PvpSystem.attackTokens).toBe(4);
        // lastTokenRecoverTime应被设为消耗时的now（因之前是满状态）
        expect(PvpSystem.lastTokenRecoverTime).toBeGreaterThanOrEqual(now);

        // 快进1小时
        const recoverTime = PvpSystem.lastTokenRecoverTime;
        vi.spyOn(Date, 'now').mockReturnValue(recoverTime + 3600000 + 1); // +1ms确保跨过整点
        PvpSystem.checkTokenRecovery();
        expect(PvpSystem.attackTokens).toBe(5);
        // 满后重新计时
        expect(PvpSystem.lastTokenRecoverTime).toBe(recoverTime + 3600000 + 1);
    });

    it('整小时对齐：经过2.5小时只恢复2个，余量保留', () => {
        // 设为3个令，记录恢复时间
        window.GameState.pvpAttackTokens = 3;
        const baseTime = Date.now();
        window.GameState.pvpLastTokenRecoverTime = baseTime;
        PvpSystem.syncFromGameState();
        // 快进2.5小时
        vi.spyOn(Date, 'now').mockReturnValue(baseTime + 2.5 * 3600000);
        PvpSystem.checkTokenRecovery();
        expect(PvpSystem.attackTokens).toBe(5); // 3+2=5，但不超过上限
        // 由于达到上限，lastTokenRecoverTime应重置为now
        expect(PvpSystem.lastTokenRecoverTime).toBe(baseTime + 2.5 * 3600000);
    });

    it('未达上限时余量保留：2个令+2.3小时→3个令，余量0.3小时保留', () => {
        window.GameState.pvpAttackTokens = 2;
        const baseTime = Date.now();
        window.GameState.pvpLastTokenRecoverTime = baseTime;
        PvpSystem.syncFromGameState();
        // 快进2.3小时
        vi.spyOn(Date, 'now').mockReturnValue(baseTime + 2.3 * 3600000);
        PvpSystem.checkTokenRecovery();
        expect(PvpSystem.attackTokens).toBe(4); // 2+2=4（Math.floor(2.3)=2）
        // 余量0.3小时保留：lastTokenRecoverTime = baseTime + 2*3600000
        expect(PvpSystem.lastTokenRecoverTime).toBe(baseTime + 2 * 3600000);
    });

    it('进攻令不能超过上限', () => {
        window.GameState.pvpAttackTokens = 5;
        window.GameState.pvpLastTokenRecoverTime = Date.now() - 10 * 3600000; // 10小时前
        PvpSystem.syncFromGameState();
        PvpSystem.checkTokenRecovery();
        expect(PvpSystem.attackTokens).toBe(5); // 不超过5
    });

    it('进攻令为0时消耗失败', () => {
        window.GameState.pvpAttackTokens = 0;
        const baseTime = Date.now();
        window.GameState.pvpLastTokenRecoverTime = baseTime;
        PvpSystem.syncFromGameState();
        expect(PvpSystem.consumeToken()).toBe(false);
        expect(PvpSystem.attackTokens).toBe(0);
    });

    it('防守竞赛制不消耗进攻令', () => {
        // 先消耗到0
        window.GameState.pvpAttackTokens = 0;
        window.GameState.pvpLastTokenRecoverTime = Date.now();
        PvpSystem.syncFromGameState();
        // matchOpponent defense-race 不需要进攻令
        AIPlayerSystem.init();
        const result = PvpSystem.matchOpponent('defense-race');
        expect(result.success).toBe(true);
        expect(result.opponent).toBeDefined();
    });
});

// ============ 匹配机制测试 ============
describe('PvpSystem 匹配机制', () => {
    beforeEach(() => {
        AIPlayerSystem.init();
        PvpSystem.init();
    });

    it('攻守轮换制进攻令不足时匹配失败', () => {
        window.GameState.pvpAttackTokens = 0;
        window.GameState.pvpLastTokenRecoverTime = Date.now();
        PvpSystem.syncFromGameState();
        const result = PvpSystem.matchOpponent('attack-defense');
        expect(result.success).toBe(false);
        expect(result.reason).toContain('进攻令');
    });

    it('匹配到的对手繁荣度在玩家±50%范围内', () => {
        const playerProsperity = PvpSystem.calculateProsperity();
        const result = PvpSystem.matchOpponent('attack-defense');
        expect(result.success).toBe(true);
        const opp = result.opponent;
        // 允许±50%（扩大范围后的上限）
        expect(opp.prosperity).toBeGreaterThanOrEqual(playerProsperity * 0.5);
        expect(opp.prosperity).toBeLessThanOrEqual(playerProsperity * 1.5);
    });

    it('匹配成功后设置matchedOpponent和currentMode', () => {
        const result = PvpSystem.matchOpponent('sync-battle');
        expect(result.success).toBe(true);
        expect(PvpSystem.matchedOpponent).toBeDefined();
        expect(PvpSystem.currentMode).toBe('sync-battle');
    });

    it('匹配不消耗进攻令（消耗在进入战斗时）', () => {
        const before = PvpSystem.attackTokens;
        PvpSystem.matchOpponent('attack-defense');
        expect(PvpSystem.attackTokens).toBe(before);
    });

    it('计算繁荣度 = 建筑数×100 + 总等级×50 + 装饰景观值', () => {
        // mock: 8工坊(等级3+2+4+1+2+5+1+2=20) + 2装饰(100+50=150)
        // = 10×100 + 20×50 + 150 = 1000 + 1000 + 150 = 2150
        expect(PvpSystem.calculateProsperity()).toBe(2150);
    });
});

// ============ PVP评级测试 ============
describe('PvpSystem 评级计算', () => {
    beforeEach(() => {
        PvpSystem.init();
    });

    it('无对战记录时为D', () => {
        expect(PvpSystem.getPvpRating()).toBe('D');
    });

    it('胜率>=80%为S', () => {
        window.GameState.pvpStats = {
            'attack-defense': { win: 8, lose: 2 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        };
        PvpSystem.syncFromGameState();
        expect(PvpSystem.getPvpRating()).toBe('S');
    });

    it('胜率>=65%为A', () => {
        window.GameState.pvpStats = {
            'attack-defense': { win: 7, lose: 3 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        };
        PvpSystem.syncFromGameState();
        expect(PvpSystem.getPvpRating()).toBe('A'); // 70%
    });

    it('胜率>=50%为B', () => {
        window.GameState.pvpStats = {
            'attack-defense': { win: 5, lose: 5 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        };
        PvpSystem.syncFromGameState();
        expect(PvpSystem.getPvpRating()).toBe('B'); // 50%
    });

    it('胜率>=35%为C', () => {
        window.GameState.pvpStats = {
            'attack-defense': { win: 4, lose: 6 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        };
        PvpSystem.syncFromGameState();
        expect(PvpSystem.getPvpRating()).toBe('C'); // 40%
    });

    it('胜率<35%为D', () => {
        window.GameState.pvpStats = {
            'attack-defense': { win: 3, lose: 7 },
            'sync-battle': { win: 0, lose: 0 },
            'defense-race': { win: 0, lose: 0 }
        };
        PvpSystem.syncFromGameState();
        expect(PvpSystem.getPvpRating()).toBe('D'); // 30%
    });

    it('三模式胜场合计计算总胜率', () => {
        window.GameState.pvpStats = {
            'attack-defense': { win: 3, lose: 1 },
            'sync-battle': { win: 3, lose: 1 },
            'defense-race': { win: 2, lose: 0 }
        };
        PvpSystem.syncFromGameState();
        // 8胜2负 = 80% → S
        expect(PvpSystem.getPvpRating()).toBe('S');
    });
});

// ============ 卡组/防御阵型校验测试 ============
describe('PvpSystem 卡组与防御阵型校验', () => {
    beforeEach(() => {
        PvpSystem.init();
    });

    it('进攻卡组少于5个失败', () => {
        const r = PvpSystem.setAttackDeck(['w1', 'w2', 'w3', 'w4']);
        expect(r.success).toBe(false);
        expect(r.reason).toContain('5-8');
    });

    it('进攻卡组多于8个失败', () => {
        const r = PvpSystem.setAttackDeck(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w1']);
        expect(r.success).toBe(false);
    });

    it('进攻卡组含不存在的工坊ID失败', () => {
        const r = PvpSystem.setAttackDeck(['w1', 'w2', 'w3', 'w4', 'wX']);
        expect(r.success).toBe(false);
        expect(r.reason).toContain('不存在');
    });

    it('进攻卡组含重复ID失败', () => {
        const r = PvpSystem.setAttackDeck(['w1', 'w1', 'w2', 'w3', 'w4']);
        expect(r.success).toBe(false);
        expect(r.reason).toContain('重复');
    });

    it('合法进攻卡组设置成功', () => {
        const r = PvpSystem.setAttackDeck(['w1', 'w2', 'w3', 'w4', 'w5']);
        expect(r.success).toBe(true);
        expect(PvpSystem.attackDeck.length).toBe(5);
    });

    it('防御阵型少于3个失败', () => {
        const r = PvpSystem.setDefenseFormation([
            { workshopId: 'w1', gridX: 0, gridY: 0 },
            { workshopId: 'w2', gridX: 1, gridY: 1 }
        ]);
        expect(r.success).toBe(false);
        expect(r.reason).toContain('3-10');
    });

    it('防御阵型多于10个失败', () => {
        const formation = [];
        for (let i = 0; i < 11; i++) formation.push({ workshopId: 'w1', gridX: i, gridY: 0 });
        const r = PvpSystem.setDefenseFormation(formation);
        expect(r.success).toBe(false);
    });

    it('防御阵型位置重叠失败', () => {
        const r = PvpSystem.setDefenseFormation([
            { workshopId: 'w1', gridX: 0, gridY: 0 },
            { workshopId: 'w2', gridX: 0, gridY: 0 },
            { workshopId: 'w3', gridX: 1, gridY: 1 }
        ]);
        expect(r.success).toBe(false);
        expect(r.reason).toContain('重叠');
    });

    it('防御阵型超出边界失败', () => {
        const r = PvpSystem.setDefenseFormation([
            { workshopId: 'w1', gridX: 16, gridY: 0 },
            { workshopId: 'w2', gridX: 1, gridY: 1 },
            { workshopId: 'w3', gridX: 2, gridY: 2 }
        ]);
        expect(r.success).toBe(false);
        expect(r.reason).toContain('边界');
    });

    it('合法防御阵型设置成功', () => {
        const r = PvpSystem.setDefenseFormation([
            { workshopId: 'w1', gridX: 0, gridY: 0 },
            { workshopId: 'w2', gridX: 1, gridY: 1 },
            { workshopId: 'w3', gridX: 2, gridY: 2 }
        ]);
        expect(r.success).toBe(true);
        expect(PvpSystem.defenseFormation.length).toBe(3);
    });
});

// ============ 对战结果记录测试 ============
describe('PvpSystem 对战结果记录', () => {
    beforeEach(() => {
        PvpSystem.init();
        AIPlayerSystem.init();
    });

    it('记录胜利：胜场+1，日志+1', () => {
        PvpSystem.recordBattleResult('attack-defense', 'win', { coins: 300, inspiration: 30, scrolls: 2 }, '匠心坊主张三');
        expect(PvpSystem.pvpStats['attack-defense'].win).toBe(1);
        expect(PvpSystem.battleLog['attack-defense'].length).toBe(1);
        expect(PvpSystem.battleLog['attack-defense'][0].result).toBe('win');
        expect(PvpSystem.battleLog['attack-defense'][0].opponent).toBe('匠心坊主张三');
    });

    it('记录失败：败场+1', () => {
        PvpSystem.recordBattleResult('sync-battle', 'lose', {}, '茶道王五');
        expect(PvpSystem.pvpStats['sync-battle'].lose).toBe(1);
    });

    it('平局不计入胜负，但记录日志', () => {
        PvpSystem.recordBattleResult('defense-race', 'draw', {}, '陶艺师李四');
        expect(PvpSystem.pvpStats['defense-race'].win).toBe(0);
        expect(PvpSystem.pvpStats['defense-race'].lose).toBe(0);
        expect(PvpSystem.battleLog['defense-race'].length).toBe(1);
    });

    it('日志按模式分类存储', () => {
        PvpSystem.recordBattleResult('attack-defense', 'win', {}, 'A');
        PvpSystem.recordBattleResult('sync-battle', 'lose', {}, 'B');
        PvpSystem.recordBattleResult('defense-race', 'draw', {}, 'C');
        expect(PvpSystem.battleLog['attack-defense'].length).toBe(1);
        expect(PvpSystem.battleLog['sync-battle'].length).toBe(1);
        expect(PvpSystem.battleLog['defense-race'].length).toBe(1);
    });

    it('日志最多保留20条（按模式）', () => {
        for (let i = 0; i < 25; i++) {
            PvpSystem.recordBattleResult('attack-defense', 'win', {}, `对手${i}`);
        }
        expect(PvpSystem.battleLog['attack-defense'].length).toBe(20);
    });

    it('奖励按范围生成', () => {
        const r1 = PvpSystem.generateReward('attack-defense');
        expect(r1.coins).toBeGreaterThanOrEqual(200);
        expect(r1.coins).toBeLessThanOrEqual(500);
        expect(r1.scrolls).toBe(2);

        const r2 = PvpSystem.generateReward('sync-battle');
        expect(r2.coins).toBeGreaterThanOrEqual(300);
        expect(r2.coins).toBeLessThanOrEqual(600);
        expect(r2.scrolls).toBe(3);

        const r3 = PvpSystem.generateReward('defense-race');
        expect(r3.coins).toBeGreaterThanOrEqual(200);
        expect(r3.coins).toBeLessThanOrEqual(400);
    });
});
