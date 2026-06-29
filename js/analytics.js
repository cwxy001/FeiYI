/*
 * analytics.js - 数据埋点分析系统
 * 功能：事件埋点、漏斗分析、留存统计、性能监控
 * 日期：2026-06-26
 * 注意：所有上报异步批量保存，不影响游戏性能
 * 迁移说明：localStorage 替换为 wx.setStorageSync；FPS 采样方式不变
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'feiyi-analytics';
    const MAX_EVENTS = 500;              // 最多保留事件条数
    const SAVE_INTERVAL_MS = 30000;      // 批量保存间隔
    const FPS_SAMPLE_INTERVAL_MS = 5000; // FPS 采样间隔
    const MAX_PERF_SAMPLES = 144;        // 性能样本上限（约 12 分钟 5s 采样）

    // 漏斗步骤（按顺序推进）
    const FUNNEL_STEPS = [
        'enter_game',
        'first_build',
        'first_level',
        'first_win',
        'first_draw',
        'first_merge'
    ];

    // 合法事件类型（用于校验，未列出的也允许记录但会打 warn）
    const VALID_EVENTS = new Set([
        'game_start', 'build_place', 'build_upgrade', 'level_start',
        'level_complete', 'level_fail', 'card_draw', 'merge_upgrade',
        'pvp_start', 'pvp_win', 'pvp_lose', 'ad_watch',
        'relic_select', 'endless_wave'
    ]);

    class Analytics {
        constructor() {
            this.events = [];             // 事件数组 [{name, params, ts}]
            this.funnel = {};             // { step: ts } 仅记录首次发生时间
            this.funnelStepIndex = 0;     // 当前已推进到的步骤序号
            this.dailyLogins = [];        // 每日登录日期数组 ['YYYY-MM-DD']
            this.firstLoginDate = '';     // 首次登录日期
            this.perf = {
                loadTime: 0,              // 页面加载耗时（ms）
                fpsSamples: [],           // FPS 采样数组
                memorySamples: []         // 内存占用采样数组（MB，Chrome 支持）
            };
            this._dirty = false;          // 是否有未保存的数据
            this._saveTimer = null;
            this._fpsTimer = null;
            this._fpsLastTs = 0;
            this._fpsFrameCount = 0;
            this._fpsAccumDt = 0;

            this._load();
            this._initPerfMonitoring();
            this._trackDailyLogin();
        }

        // ===== 持久化 =====
        _load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                this.events = Array.isArray(data.events) ? data.events : [];
                this.funnel = data.funnel || {};
                this.funnelStepIndex = this._calcFunnelIndex(this.funnel);
                this.dailyLogins = Array.isArray(data.dailyLogins) ? data.dailyLogins : [];
                this.firstLoginDate = data.firstLoginDate || '';
                this.perf = Object.assign(this.perf, data.perf || {});
            } catch (e) {
                console.warn('[Analytics] 读取存档失败:', e);
            }
        }

        _save(force) {
            // 批量保存：标记 dirty，由定时器落盘；force=true 立即保存
            this._dirty = true;
            if (force) {
                this._flushSave();
            }
        }

        _flushSave() {
            if (!this._dirty) return;
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    events: this.events,
                    funnel: this.funnel,
                    dailyLogins: this.dailyLogins,
                    firstLoginDate: this.firstLoginDate,
                    perf: this.perf
                }));
                this._dirty = false;
            } catch (e) {
                // 存储溢出时丢弃最旧的一半事件
                if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                    console.warn('[Analytics] 存储溢出，丢弃旧事件');
                    this.events = this.events.slice(Math.floor(this.events.length / 2));
                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            events: this.events,
                            funnel: this.funnel,
                            dailyLogins: this.dailyLogins,
                            firstLoginDate: this.firstLoginDate,
                            perf: this.perf
                        }));
                        this._dirty = false;
                    } catch (e2) {
                        console.warn('[Analytics] 二次保存失败:', e2);
                    }
                } else {
                    console.warn('[Analytics] 保存失败:', e);
                }
            }
        }

        _startSaveTimer() {
            if (this._saveTimer) return;
            this._saveTimer = setInterval(() => this._flushSave(), SAVE_INTERVAL_MS);
            // 页面隐藏时也尝试保存
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this._flushSave();
            });
        }

        // ===== 事件埋点 =====
        /**
         * 记录事件
         * @param {string} eventName - 事件名
         * @param {object} [params] - 附加参数
         */
        trackEvent(eventName, params) {
            if (!eventName) return;
            if (!VALID_EVENTS.has(eventName)) {
                console.warn('[Analytics] 未注册的事件类型:', eventName);
            }
            this.events.push({
                name: eventName,
                params: params || {},
                ts: Date.now()
            });
            // 超出上限丢弃最旧的
            if (this.events.length > MAX_EVENTS) {
                this.events = this.events.slice(this.events.length - MAX_EVENTS);
            }
            this._save(false);
        }

        // ===== 漏斗分析 =====
        _calcFunnelIndex(funnel) {
            let idx = 0;
            for (let i = 0; i < FUNNEL_STEPS.length; i++) {
                if (funnel[FUNNEL_STEPS[i]]) idx = i + 1; else break;
            }
            return idx;
        }

        /**
         * 记录漏斗步骤（仅首次记录，后续重复调用忽略）
         * @param {string} step - 漏斗步骤名
         */
        trackFunnel(step) {
            if (!FUNNEL_STEPS.includes(step)) {
                console.warn('[Analytics] 未知漏斗步骤:', step);
                return;
            }
            if (this.funnel[step]) return; // 已记录过，忽略
            this.funnel[step] = Date.now();
            this.funnelStepIndex = this._calcFunnelIndex(this.funnel);
            this._save(true); // 漏斗是关键转化点，立即保存
            console.log('[Analytics] 漏斗推进:', step, '(', this.funnelStepIndex + '/' + FUNNEL_STEPS.length, ')');
        }

        getFunnelStatus() {
            return FUNNEL_STEPS.map(s => ({
                step: s,
                ts: this.funnel[s] || 0,
                completed: !!this.funnel[s]
            }));
        }

        // ===== 留存统计 =====
        _todayStr() {
            const d = new Date();
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        _trackDailyLogin() {
            const today = this._todayStr();
            if (this.dailyLogins.length === 0 || this.dailyLogins[this.dailyLogins.length - 1] !== today) {
                this.dailyLogins.push(today);
                // 仅保留最近 60 天
                if (this.dailyLogins.length > 60) {
                    this.dailyLogins = this.dailyLogins.slice(-60);
                }
            }
            if (!this.firstLoginDate) {
                this.firstLoginDate = today;
            }
            this._save(false);
        }

        /**
         * 计算次日/3日/7日/30日留存
         * @returns {object} {day1, day3, day7, day30} 0~1 之间
         */
        getRetention() {
            if (!this.firstLoginDate || this.dailyLogins.length === 0) {
                return { day1: 0, day3: 0, day7: 0, day30: 0, totalLogins: 0 };
            }
            const first = new Date(this.firstLoginDate).getTime();
            if (isNaN(first)) {
                return { day1: 0, day3: 0, day7: 0, day30: 0, totalLogins: this.dailyLogins.length };
            }
            const dayMs = 24 * 60 * 60 * 1000;
            const hasLoginOnDay = (offset) => {
                const target = this._todayStrFromTs(first + offset * dayMs);
                return this.dailyLogins.includes(target);
            };
            return {
                day1: hasLoginOnDay(1) ? 1 : 0,
                day3: hasLoginOnDay(3) ? 1 : 0,
                day7: hasLoginOnDay(7) ? 1 : 0,
                day30: hasLoginOnDay(30) ? 1 : 0,
                totalLogins: this.dailyLogins.length
            };
        }

        _todayStrFromTs(ts) {
            const d = new Date(ts);
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

        // ===== 性能监控 =====
        _initPerfMonitoring() {
            // 页面加载耗时（仅一次）
            try {
                if (window.performance && performance.timing) {
                    const t = performance.timing;
                    const loadMs = t.loadEventEnd - t.navigationStart;
                    this.perf.loadTime = loadMs > 0 ? loadMs : (performance.now ? performance.now() : 0);
                } else if (window.performance && performance.now) {
                    this.perf.loadTime = performance.now();
                }
            } catch (e) { /* ignore */ }

            // FPS 采样（每 5 秒计算一次平均 FPS）
            this._startFpsSampling();
        }

        _startFpsSampling() {
            if (this._fpsTimer) return;
            this._fpsLastTs = performance.now();
            this._fpsFrameCount = 0;

            const tick = () => {
                const now = performance.now();
                const dt = now - this._fpsLastTs;
                this._fpsFrameCount++;
                this._fpsAccumDt += dt;
                this._fpsLastTs = now;

                // 每 5 秒采样一次
                if (this._fpsAccumDt >= FPS_SAMPLE_INTERVAL_MS) {
                    const fps = Math.round((this._fpsFrameCount * 1000) / this._fpsAccumDt);
                    this.perf.fpsSamples.push({ ts: Date.now(), fps });
                    if (this.perf.fpsSamples.length > MAX_PERF_SAMPLES) {
                        this.perf.fpsSamples = this.perf.fpsSamples.slice(-MAX_PERF_SAMPLES);
                    }
                    // 内存占用（仅 Chrome 支持 performance.memory）
                    if (performance.memory) {
                        this.perf.memorySamples.push({
                            ts: Date.now(),
                            usedMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
                            totalMB: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
                        });
                        if (this.perf.memorySamples.length > MAX_PERF_SAMPLES) {
                            this.perf.memorySamples = this.perf.memorySamples.slice(-MAX_PERF_SAMPLES);
                        }
                    }
                    this._fpsFrameCount = 0;
                    this._fpsAccumDt = 0;
                    this._save(false);
                }
                this._fpsTimer = requestAnimationFrame(tick);
            };
            this._fpsTimer = requestAnimationFrame(tick);
        }

        getPerfSummary() {
            const fpsSamples = this.perf.fpsSamples;
            const memSamples = this.perf.memorySamples;
            const avgFps = fpsSamples.length > 0
                ? Math.round(fpsSamples.reduce((s, x) => s + x.fps, 0) / fpsSamples.length)
                : 0;
            const minFps = fpsSamples.length > 0
                ? Math.min(...fpsSamples.map(x => x.fps))
                : 0;
            const lastMem = memSamples.length > 0 ? memSamples[memSamples.length - 1] : null;
            return {
                loadTime: this.perf.loadTime,
                avgFps,
                minFps,
                sampleCount: fpsSamples.length,
                lastMemory: lastMem
            };
        }

        // ===== 导出/清空 =====
        exportData() {
            this._flushSave();
            return JSON.stringify({
                exportedAt: new Date().toISOString(),
                events: this.events,
                funnel: this.getFunnelStatus(),
                retention: this.getRetention(),
                perf: this.perf,
                perfSummary: this.getPerfSummary()
            }, null, 2);
        }

        clearData() {
            this.events = [];
            this.funnel = {};
            this.funnelStepIndex = 0;
            this.dailyLogins = [];
            this.firstLoginDate = '';
            this.perf = { loadTime: 0, fpsSamples: [], memorySamples: [] };
            this._dirty = true;
            this._flushSave();
            // 重新记录今天的登录
            this._trackDailyLogin();
            console.log('[Analytics] 数据已清空');
        }

        // ===== 调试/查询 =====
        getEventCount() { return this.events.length; }
        getRecentEvents(n) {
            return this.events.slice(-Math.max(1, n || 10));
        }
    }

    // ===== 暴露单例 =====
    const instance = new Analytics();
    window.Analytics = instance;
    instance._startSaveTimer();

    console.log('[Analytics] 数据埋点系统已加载，事件数:', instance.events.length,
        '漏斗进度:', instance.funnelStepIndex + '/' + FUNNEL_STEPS.length);
})();
