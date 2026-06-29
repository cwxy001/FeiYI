/*
 * ad-system.js - 广告变现系统（个人开发者版，H5 阶段用倒计时模拟）
 * 功能：激励视频广告模拟、5 种奖励场景、每日次数限制、双倍产出 buff
 * 日期：2026-06-26
 * 迁移说明：H5 阶段用 3 秒倒计时模拟广告播放；迁移微信小游戏后，
 *           将 _simulateAdPlay 内部替换为 wx.createRewardedVideoAd().onClose 回调
 *           localStorage 调用替换为 wx.setStorageSync / wx.getStorageSync
 */

(function () {
    'use strict';

    // ===== 奖励场景配置 =====
    const REWARD_CONFIG = {
        'double-production':  { name: '双倍产出',   dailyLimit: 1, desc: '看广告后30分钟内经营产出x2' },
        'restore-pvp-token':  { name: '恢复进攻令', dailyLimit: 3, desc: '看广告恢复1个PVP进攻令' },
        'gain-popularity':    { name: '获得人气',   dailyLimit: 3, desc: '看广告获得100人气' },
        'free-draw':          { name: '免费抽卡',   dailyLimit: 2, desc: '看广告免费抽1张卡（不消耗人气）' }
        // 'revive' 不走每日限制，按"每关1次"管理，配置中省略
    };

    const DAILY_TOTAL_LIMIT = 10;          // 每日全局广告上限
    const AD_PLAY_DURATION = 3000;         // 单次广告播放时长（毫秒）
    const DOUBLE_PRODUCTION_MS = 30 * 60 * 1000; // 双倍产出持续 30 分钟
    const STORAGE_KEY = 'feiyi-ad-system';

    class AdSystem {
        constructor() {
            this.adCount = 0;              // 今日已观看广告数（全局）
            this.adLimit = DAILY_TOTAL_LIMIT;
            this.lastResetDate = '';       // 上次重置日期（toDateString 字符串）
            this.rewardCounts = {          // 各奖励今日已观看次数
                'double-production': 0,
                'restore-pvp-token': 0,
                'gain-popularity': 0,
                'free-draw': 0
            };
            this.doubleProductionEndTime = 0; // 双倍产出 buff 结束时间戳（0 表示无 buff）
            this._reviveUsedThisLevel = false; // 当前关卡是否已使用复活（每关重置）
            this._playing = false;            // 广告是否正在播放（游戏循环应暂停）
            this._overlayCanvas = null;       // 广告弹窗 overlay canvas
            this._overlayCtx = null;
            this._rafId = null;               // 弹窗渲染 rAF id
            this._playStartTs = 0;
            this._pendingReward = null;       // { type, onSuccess, onFail }

            this._load();
            this._checkDailyReset();
        }

        // ===== 持久化 =====
        _load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                this.adCount = data.adCount || 0;
                this.lastResetDate = data.lastResetDate || '';
                this.rewardCounts = Object.assign(this.rewardCounts, data.rewardCounts || {});
                this.doubleProductionEndTime = data.doubleProductionEndTime || 0;
            } catch (e) {
                console.warn('[AdSystem] 读取存档失败:', e);
            }
        }

        _save() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    adCount: this.adCount,
                    lastResetDate: this.lastResetDate,
                    rewardCounts: this.rewardCounts,
                    doubleProductionEndTime: this.doubleProductionEndTime
                }));
            } catch (e) {
                console.warn('[AdSystem] 保存存档失败:', e);
            }
        }

        // ===== 每日重置 =====
        _todayStr() {
            // 用本地日期字符串作为重置判定（H5 简化方案，0 点跨天即重置）
            const d = new Date();
            return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
        }

        _checkDailyReset() {
            const today = this._todayStr();
            if (this.lastResetDate !== today) {
                this.resetDaily();
            }
        }

        resetDaily() {
            this.adCount = 0;
            this.rewardCounts = {
                'double-production': 0,
                'restore-pvp-token': 0,
                'gain-popularity': 0,
                'free-draw': 0
            };
            this.lastResetDate = this._todayStr();
            this._save();
            console.log('[AdSystem] 每日广告次数已重置');
        }

        // ===== 查询接口 =====
        canWatchAd() {
            this._checkDailyReset();
            return this.adCount < this.adLimit;
        }

        getAdCount() {
            this._checkDailyReset();
            return this.adCount;
        }

        getRemainingAd() {
            this._checkDailyReset();
            return Math.max(0, this.adLimit - this.adCount);
        }

        /**
         * 检查指定奖励今日是否还能观看
         * @param {string} rewardType
         * @returns {{canWatch:boolean, reason:string}}
         */
        canWatchReward(rewardType) {
            this._checkDailyReset();
            if (this._playing) return { canWatch: false, reason: '广告正在播放中' };
            if (!this.canWatchAd()) return { canWatch: false, reason: '今日广告次数已用完' };
            const cfg = REWARD_CONFIG[rewardType];
            if (!cfg) return { canWatch: false, reason: '未知奖励类型' };
            const used = this.rewardCounts[rewardType] || 0;
            if (used >= cfg.dailyLimit) {
                return { canWatch: false, reason: `${cfg.name}今日次数已用完（${used}/${cfg.dailyLimit}）` };
            }
            return { canWatch: true, reason: '' };
        }

        getRewardRemaining(rewardType) {
            this._checkDailyReset();
            const cfg = REWARD_CONFIG[rewardType];
            if (!cfg) return 0;
            return Math.max(0, cfg.dailyLimit - (this.rewardCounts[rewardType] || 0));
        }

        isPlaying() { return this._playing; }

        // ===== 双倍产出 buff =====
        isDoubleProductionActive() {
            return this.doubleProductionEndTime > Date.now();
        }

        getDoubleProductionRemainingMs() {
            return Math.max(0, this.doubleProductionEndTime - Date.now());
        }

        // ===== 复活续命（每关1次） =====
        canReviveThisLevel() {
            return !this._reviveUsedThisLevel;
        }

        resetReviveForNewLevel() {
            // 关卡开始时调用，重置本关复活标记
            this._reviveUsedThisLevel = false;
        }

        _markReviveUsed() {
            this._reviveUsedThisLevel = true;
        }

        // ===== 主入口：播放广告并发奖 =====
        /**
         * 播放激励视频广告，播放完成后发放奖励
         * @param {string} rewardType - 奖励类型 ID
         * @param {function} [onSuccess] - 奖励发放成功回调
         * @param {function} [onFail] - 播放失败/取消回调
         */
        showRewardAd(rewardType, onSuccess, onFail) {
            // 复活类型不参与每日全局/单类限制，但每关只能用1次
            if (rewardType === 'revive') {
                if (this._playing) {
                    if (typeof onFail === 'function') onFail('广告正在播放中');
                    return;
                }
                if (this._reviveUsedThisLevel) {
                    if (typeof onFail === 'function') onFail('本关已使用过复活续命');
                    return;
                }
                this._pendingReward = { type: 'revive', onSuccess, onFail };
                this._startAdPlay();
                return;
            }

            const check = this.canWatchReward(rewardType);
            if (!check.canWatch) {
                if (typeof onFail === 'function') onFail(check.reason);
                if (window.UI && typeof UI.showToast === 'function') {
                    UI.showToast(check.reason, 2000, 'warn');
                }
                return;
            }
            this._pendingReward = { type: rewardType, onSuccess, onFail };
            this._startAdPlay();
        }

        // ===== 广告播放（H5 倒计时模拟） =====
        _startAdPlay() {
            this._playing = true;
            this._playStartTs = Date.now();
            this._createOverlay();
            this._renderLoop();
            // 暂停游戏相关循环（由各系统检查 isPlaying() 自行处理）
            console.log('[AdSystem] 广告开始播放，游戏暂停');
        }

        _endAdPlay(success) {
            this._playing = false;
            this._destroyOverlay();
            if (this._rafId) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
            console.log('[AdSystem] 广告播放结束，游戏恢复');

            if (!success) {
                if (this._pendingReward && typeof this._pendingReward.onFail === 'function') {
                    this._pendingReward.onFail('广告未完整播放');
                }
                this._pendingReward = null;
                return;
            }

            // 播放完成，发奖
            const reward = this._pendingReward;
            this._pendingReward = null;
            if (!reward) return;

            // 复活类型不走每日计数
            if (reward.type !== 'revive') {
                this.adCount += 1;
                if (REWARD_CONFIG[reward.type]) {
                    this.rewardCounts[reward.type] = (this.rewardCounts[reward.type] || 0) + 1;
                }
                this._save();
            }

            this._grantReward(reward.type, reward.onSuccess, reward.onFail);
        }

        _grantReward(type, onSuccess, onFail) {
            try {
                switch (type) {
                    case 'double-production': {
                        // 重置或延长 30 分钟 buff（不叠加，直接覆盖为 +30min）
                        this.doubleProductionEndTime = Date.now() + DOUBLE_PRODUCTION_MS;
                        this._save();
                        this._notifySuccess('双倍产出已激活，30分钟内经营产出x2', onSuccess);
                        break;
                    }
                    case 'restore-pvp-token': {
                        if (window.GameState) {
                            GameState.pvpAttackTokens = Math.min(99, (GameState.pvpAttackTokens || 0) + 1);
                            GameState.save();
                            // 同步 PVP 系统内存值
                            if (window.PvpSystem && PvpSystem.attackTokens !== undefined) {
                                PvpSystem.attackTokens = GameState.pvpAttackTokens;
                                if (typeof PvpSystem._renderTokens === 'function') PvpSystem._renderTokens();
                            }
                            this._notifySuccess('恢复1个进攻令', onSuccess);
                        } else {
                            this._notifySuccess('恢复1个进攻令', onSuccess);
                        }
                        break;
                    }
                    case 'gain-popularity': {
                        if (window.GameState) {
                            GameState.addPopularity(100);
                            this._notifySuccess('获得100人气', onSuccess);
                        } else {
                            this._notifySuccess('获得100人气', onSuccess);
                        }
                        break;
                    }
                    case 'free-draw': {
                        // 抽卡逻辑由塔防系统负责（AdSystem 不直接持有 CardSystem 引用）
                        // 调用 onSuccess 让调用方执行抽卡
                        this._notifySuccess('免费抽卡奖励已发放', onSuccess);
                        break;
                    }
                    case 'revive': {
                        this._markReviveUsed();
                        // 复活逻辑由塔防系统在 onSuccess 中执行（恢复50%主灯血量）
                        this._notifySuccess('复活续命已激活', onSuccess);
                        break;
                    }
                    default:
                        if (typeof onFail === 'function') onFail('未知奖励类型');
                }
                // 埋点
                if (window.Analytics && typeof Analytics.trackEvent === 'function') {
                    Analytics.trackEvent('ad_watch', { reward_type: type });
                }
            } catch (e) {
                console.error('[AdSystem] 发放奖励失败:', e);
                if (typeof onFail === 'function') onFail('奖励发放异常: ' + e.message);
            }
        }

        _notifySuccess(msg, onSuccess) {
            if (window.UI && typeof UI.showToast === 'function') {
                UI.showToast(msg, 2200, 'success');
            }
            if (typeof onSuccess === 'function') onSuccess(msg);
        }

        // ===== Canvas 弹窗（用户选择 Canvas 绘制，非 DOM） =====
        _createOverlay() {
            // 已存在则跳过
            if (this._overlayCanvas) return;
            const canvas = document.createElement('canvas');
            canvas.id = 'ad-overlay-canvas';
            canvas.style.cssText = [
                'position:fixed',
                'inset:0',
                'width:100%',
                'height:100%',
                'z-index:99999',
                'pointer-events:auto',
                'background:rgba(0,0,0,0.85)'
            ].join(';');
            document.body.appendChild(canvas);
            this._overlayCanvas = canvas;
            this._overlayCtx = canvas.getContext('2d');
            this._resizeOverlay();
            // 窗口尺寸变化时同步
            this._resizeHandler = () => this._resizeOverlay();
            window.addEventListener('resize', this._resizeHandler);
        }

        _resizeOverlay() {
            if (!this._overlayCanvas) return;
            const dpr = window.devicePixelRatio || 1;
            const w = window.innerWidth;
            const h = window.innerHeight;
            this._overlayCanvas.width = w * dpr;
            this._overlayCanvas.height = h * dpr;
            this._overlayCanvas.style.width = w + 'px';
            this._overlayCanvas.style.height = h + 'px';
            this._overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        _destroyOverlay() {
            if (this._resizeHandler) {
                window.removeEventListener('resize', this._resizeHandler);
                this._resizeHandler = null;
            }
            if (this._overlayCanvas && this._overlayCanvas.parentNode) {
                this._overlayCanvas.parentNode.removeChild(this._overlayCanvas);
            }
            this._overlayCanvas = null;
            this._overlayCtx = null;
        }

        _renderLoop() {
            if (!this._playing || !this._overlayCtx) return;
            this._drawFrame();
            const elapsed = Date.now() - this._playStartTs;
            if (elapsed >= AD_PLAY_DURATION) {
                this._endAdPlay(true);
                return;
            }
            this._rafId = requestAnimationFrame(() => this._renderLoop());
        }

        _drawFrame() {
            const ctx = this._overlayCtx;
            if (!ctx) return;
            const w = window.innerWidth;
            const h = window.innerHeight;

            // 重置变换矩阵后再清屏（避免 dpr 缩放残留）
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this._overlayCanvas.width, this._overlayCanvas.height);
            ctx.restore();

            // 半透明背景（已在 canvas style 上设置，这里再画一层确保）
            ctx.fillStyle = 'rgba(0,0,0,0.85)';
            ctx.fillRect(0, 0, w, h);

            // 居中广告框
            const boxW = Math.min(420, w * 0.85);
            const boxH = Math.min(280, h * 0.55);
            const boxX = (w - boxW) / 2;
            const boxY = (h - boxH) / 2;

            // 金色边框 + 暗色背景
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(boxX, boxY, boxW, boxH);
            ctx.lineWidth = 3;
            ctx.strokeStyle = '#FFD700';
            ctx.strokeRect(boxX, boxY, boxW, boxH);

            // 标题
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 22px "Noto Serif SC", serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('广告播放中...', w / 2, boxY + 50);

            // 奖励类型显示
            const rewardName = this._pendingReward
                ? (REWARD_CONFIG[this._pendingReward.type]?.name || (this._pendingReward.type === 'revive' ? '复活续命' : this._pendingReward.type))
                : '';
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px "Noto Serif SC", serif';
            ctx.fillText('奖励：' + rewardName, w / 2, boxY + 90);

            // 倒计时数字
            const elapsed = Date.now() - this._playStartTs;
            const remaining = Math.max(0, Math.ceil((AD_PLAY_DURATION - elapsed) / 1000));
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 64px "Noto Serif SC", serif';
            ctx.fillText(String(remaining), w / 2, boxY + boxH / 2 + 10);

            // 进度条
            const progress = Math.min(1, elapsed / AD_PLAY_DURATION);
            const barW = boxW * 0.8;
            const barX = (w - barW) / 2;
            const barY = boxY + boxH - 50;
            ctx.fillStyle = '#333';
            ctx.fillRect(barX, barY, barW, 8);
            ctx.fillStyle = '#FFD700';
            ctx.fillRect(barX, barY, barW * progress, 8);

            // 底部提示
            ctx.fillStyle = '#888';
            ctx.font = '12px "Noto Serif SC", serif';
            ctx.fillText('请勿关闭，广告播放完成后将自动发放奖励', w / 2, boxY + boxH - 20);

            // 重置文字对齐，避免污染其它绘制
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }

        // ===== 调试/工具 =====
        /**
         * 调试用：跳过广告播放直接发奖（仅开发环境）
         */
        _debugSkipAd() {
            if (!this._pendingReward) return;
            this._endAdPlay(true);
        }

        /**
         * 调试用：重置所有广告数据
         */
        debugReset() {
            this.adCount = 0;
            this.rewardCounts = {
                'double-production': 0,
                'restore-pvp-token': 0,
                'gain-popularity': 0,
                'free-draw': 0
            };
            this.lastResetDate = this._todayStr();
            this.doubleProductionEndTime = 0;
            this._reviveUsedThisLevel = false;
            this._save();
            console.log('[AdSystem] 调试重置完成');
        }

        /**
         * 获取广告系统当前状态摘要（用于调试面板）
         */
        getStatus() {
            this._checkDailyReset();
            return {
                adCount: this.adCount,
                adLimit: this.adLimit,
                remaining: this.getRemainingAd(),
                rewardCounts: { ...this.rewardCounts },
                reviveUsedThisLevel: this._reviveUsedThisLevel,
                doubleProductionActive: this.isDoubleProductionActive(),
                doubleProductionRemainingMs: this.getDoubleProductionRemainingMs(),
                isPlaying: this._playing
            };
        }
    }

    // ===== 暴露单例 =====
    const instance = new AdSystem();
    window.AdSystem = instance;

    // 每分钟检查一次跨天重置（轻量定时器）
    setInterval(() => {
        try { instance._checkDailyReset(); } catch (e) { /* ignore */ }
    }, 60000);

    console.log('[AdSystem] 广告系统已加载，今日已观看:', instance.adCount, '/', instance.adLimit);
})();
