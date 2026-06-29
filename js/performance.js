/*
 * performance.js - 性能优化系统
 * 功能：资源懒加载、对象池监控、视锥剔除工具、离屏Canvas缓存、内存监控
 * 日期：2026-06-26
 * 设计原则：
 *   1. 作为"监控+工具层"提供 API，不主动改写现有对象池/渲染逻辑
 *   2. 现有系统可"自愿"注册对象池到 Performance，由其统一监控/告警
 *   3. 内存监控仅统计占用大小，不收集用户敏感数据
 *   4. 所有告警仅 console.warn，不影响游戏流程
 */

(function () {
    'use strict';

    const MEMORY_WARN_MB = 200;          // 内存占用告警阈值
    const MEMORY_CHECK_INTERVAL_MS = 10000; // 内存检查间隔
    const FPS_DEGRADE_THRESHOLD = 30;    // FPS 降级阈值
    const CLEANUP_INTERVAL_MS = 30000;   // 定期清理间隔

    class Performance {
        constructor() {
            this._imageCache = new Map();     // 图片缓存 { name: HTMLImageElement }
            this._audioCache = new Map();     // 音频缓存 { name: HTMLAudioElement }
            this._offscreenCache = new Map(); // 离屏Canvas缓存 { key: { canvas, ts } }
            this._pools = new Map();          // 注册的对象池 { name: { getSize, getMax, clear } }
            this._degradeMode = false;        // 是否处于降级渲染模式
            this._memCheckTimer = null;
            this._cleanupTimer = null;
            this._lastFps = 60;
            this._listeners = [];             // 降级模式切换监听器
        }

        // ===== 资源懒加载 =====
        /**
         * 按需加载图片（带缓存，重复加载直接返回缓存）
         * @param {string} name - 资源名
         * @param {string} url - 资源 URL
         * @returns {Promise<HTMLImageElement>}
         */
        lazyLoadImage(name, url) {
            if (this._imageCache.has(name)) {
                return Promise.resolve(this._imageCache.get(name));
            }
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    this._imageCache.set(name, img);
                    resolve(img);
                };
                img.onerror = (e) => reject(new Error('图片加载失败: ' + url));
                img.src = url;
            });
        }

        /**
         * 按需加载音效
         * @param {string} name - 资源名
         * @param {string} url - 资源 URL
         * @returns {Promise<HTMLAudioElement>}
         */
        lazyLoadAudio(name, url) {
            if (this._audioCache.has(name)) {
                return Promise.resolve(this._audioCache.get(name));
            }
            return new Promise((resolve, reject) => {
                const audio = new Audio();
                audio.preload = 'auto';
                audio.oncanplaythrough = () => {
                    this._audioCache.set(name, audio);
                    resolve(audio);
                };
                audio.onerror = () => reject(new Error('音频加载失败: ' + url));
                audio.src = url;
            });
        }

        getCachedImage(name) { return this._imageCache.get(name); }
        getCachedAudio(name) { return this._audioCache.get(name); }

        /**
         * 批量预加载关卡所需资源
         * @param {object} manifest - { images: {name:url}, audios: {name:url} }
         * @param {function} [onProgress] - 进度回调(0~1)
         * @returns {Promise}
         */
        preloadLevelResources(manifest, onProgress) {
            const images = manifest.images || {};
            const audios = manifest.audios || {};
            const allImages = Object.keys(images).map(k => ({ name: k, url: images[k] }));
            const allAudios = Object.keys(audios).map(k => ({ name: k, url: audios[k] }));
            const total = allImages.length + allAudios.length;
            let done = 0;
            const tick = () => { if (onProgress) onProgress(total > 0 ? done / total : 1); };

            const tasks = [];
            allImages.forEach(item => tasks.push(
                this.lazyLoadImage(item.name, item.url).then(() => { done++; tick(); })
            ));
            allAudios.forEach(item => tasks.push(
                this.lazyLoadAudio(item.name, item.url).then(() => { done++; tick(); })
            ));
            return Promise.all(tasks);
        }

        // ===== 对象池注册/监控 =====
        /**
         * 注册对象池到 Performance，供统一监控/清理
         * @param {string} name - 池名（如 'particle', 'enemy', 'projectile'）
         * @param {object} iface - { getSize(), getMax(), clear() }
         */
        registerObjectPool(name, iface) {
            if (!iface || typeof iface.getSize !== 'function') {
                console.warn('[Performance] 注册对象池失败，缺少 getSize 接口:', name);
                return;
            }
            this._pools.set(name, iface);
        }

        unregisterObjectPool(name) {
            this._pools.delete(name);
        }

        getPoolStats() {
            const stats = {};
            this._pools.forEach((iface, name) => {
                try {
                    stats[name] = {
                        size: iface.getSize(),
                        max: iface.getMax ? iface.getMax() : null
                    };
                } catch (e) {
                    stats[name] = { size: -1, max: null, error: e.message };
                }
            });
            return stats;
        }

        /**
         * 触发所有注册池的清理（场景切换时调用）
         */
        clearAllPools() {
            this._pools.forEach((iface, name) => {
                try {
                    if (typeof iface.clear === 'function') iface.clear();
                } catch (e) {
                    console.warn('[Performance] 清理对象池失败:', name, e);
                }
            });
        }

        // ===== 视锥剔除工具 =====
        /**
         * 判断对象是否在可视区域内
         * @param {object} obj - { x, y, w, h } 或 { x, y, r }
         * @param {object} viewport - { x, y, w, h }
         * @returns {boolean} true=可见（不剔除）
         */
        shouldCull(obj, viewport) {
            if (!obj || !viewport) return false;
            if (obj.r !== undefined) {
                // 圆形对象
                const cx = obj.x, cy = obj.y, r = obj.r;
                return cx + r < viewport.x || cx - r > viewport.x + viewport.w
                    || cy + r < viewport.y || cy - r > viewport.y + viewport.h;
            }
            // 矩形对象
            return obj.x + (obj.w || 0) < viewport.x
                || obj.x > viewport.x + viewport.w
                || obj.y + (obj.h || 0) < viewport.y
                || obj.y > viewport.y + viewport.h;
        }

        // ===== 离屏 Canvas 缓存 =====
        /**
         * 创建/获取离屏 Canvas 缓存（用于静态背景等）
         * @param {string} key - 缓存键
         * @param {number} w
         * @param {number} h
         * @param {function} drawFn - (ctx) => void 首次创建时绘制
         * @returns {HTMLCanvasElement}
         */
        getOffscreenCache(key, w, h, drawFn) {
            const cached = this._offscreenCache.get(key);
            if (cached && cached.canvas.width === w && cached.canvas.height === h) {
                return cached.canvas;
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (typeof drawFn === 'function') {
                drawFn(ctx);
            }
            this._offscreenCache.set(key, { canvas, ts: Date.now() });
            return canvas;
        }

        invalidateOffscreenCache(key) {
            if (key) {
                this._offscreenCache.delete(key);
            } else {
                this._offscreenCache.clear();
            }
        }

        // ===== 内存管理 =====
        startMemoryMonitor() {
            if (this._memCheckTimer) return;
            this._memCheckTimer = setInterval(() => this._checkMemory(), MEMORY_CHECK_INTERVAL_MS);
        }

        stopMemoryMonitor() {
            if (this._memCheckTimer) {
                clearInterval(this._memCheckTimer);
                this._memCheckTimer = null;
            }
        }

        _checkMemory() {
            if (!performance.memory) return; // 非 Chrome 不支持
            const usedMB = performance.memory.usedJSHeapSize / 1024 / 1024;
            if (usedMB > MEMORY_WARN_MB) {
                console.warn('[Performance] 内存占用过高:', Math.round(usedMB) + 'MB > ' + MEMORY_WARN_MB + 'MB',
                    '对象池状态:', this.getPoolStats());
            }
        }

        getMemoryUsage() {
            if (!performance.memory) return null;
            return {
                usedMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
                totalMB: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
                limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
            };
        }

        // ===== 定期清理 =====
        startAutoCleanup() {
            if (this._cleanupTimer) return;
            this._cleanupTimer = setInterval(() => this._autoCleanup(), CLEANUP_INTERVAL_MS);
        }

        stopAutoCleanup() {
            if (this._cleanupTimer) {
                clearInterval(this._cleanupTimer);
                this._cleanupTimer = null;
            }
        }

        _autoCleanup() {
            // 清理过期的离屏缓存（30 分钟未访问）
            const now = Date.now();
            const expireMs = 30 * 60 * 1000;
            for (const [key, entry] of this._offscreenCache.entries()) {
                if (now - entry.ts > expireMs) {
                    this._offscreenCache.delete(key);
                }
            }
            // 清理过期粒子（通过注册的池接口）
            this._pools.forEach((iface, name) => {
                try {
                    if (typeof iface.cleanupExpired === 'function') iface.cleanupExpired();
                } catch (e) { /* ignore */ }
            });
        }

        /**
         * 场景切换时清理无用资源
         * @param {string} fromScene - 离开的场景
         * @param {string} toScene - 进入的场景
         */
        onSceneSwitch(fromScene, toScene) {
            console.log('[Performance] 场景切换:', fromScene, '->', toScene);
            // 经营 → 塔防：清理经营侧离屏缓存
            // 塔防 → 经营：清理塔防侧对象池过期粒子
            // 这里只清理通用缓存，具体池由各自系统在 destroy 时主动清理
            if (fromScene === 'management' && toScene === 'tower-defense') {
                this.invalidateOffscreenCache('bg-management');
            } else if (fromScene === 'tower-defense' && toScene === 'management') {
                this.invalidateOffscreenCache('bg-td');
            }
        }

        // ===== 降级渲染 =====
        /**
         * 报告当前 FPS（由渲染循环定期调用）
         * @param {number} fps
         */
        reportFps(fps) {
            this._lastFps = fps;
            const wasDegrade = this._degradeMode;
            this._degradeMode = fps < FPS_DEGRADE_THRESHOLD;
            if (this._degradeMode !== wasDegrade) {
                console.log('[Performance] 降级渲染模式:', this._degradeMode ? '开启（FPS=' + fps + '）' : '关闭');
                this._listeners.forEach(fn => {
                    try { fn(this._degradeMode); } catch (e) { /* ignore */ }
                });
            }
        }

        isDegradeMode() { return this._degradeMode; }
        getLastFps() { return this._lastFps; }

        /**
         * 监听降级模式切换
         * @param {function} fn - (isDegrade:boolean) => void
         */
        onDegradeChange(fn) {
            if (typeof fn === 'function') this._listeners.push(fn);
        }

        // ===== 分包加载（H5 阶段仅元数据，迁移微信小游戏后实际分包） =====
        /**
         * 分包元数据：用于迁移到微信小游戏时配置 subpackages
         */
        getSubpackageManifest() {
            return {
                management: { root: 'js/management.js', desc: '经营模块' },
                towerDefense: { root: 'js/tower-defense.js', desc: '塔防模块' },
                pvp: { root: 'js/pvp-system.js', desc: 'PVP模块' },
                effects: { root: 'js/effects-engine.js', desc: '特效模块' }
            };
        }

        // ===== 总览 =====
        getSummary() {
            return {
                memory: this.getMemoryUsage(),
                pools: this.getPoolStats(),
                fps: this._lastFps,
                degradeMode: this._degradeMode,
                imageCacheCount: this._imageCache.size,
                audioCacheCount: this._audioCache.size,
                offscreenCacheCount: this._offscreenCache.size
            };
        }
    }

    // ===== 暴露单例 =====
    const instance = new Performance();
    window.Performance = instance;
    instance.startMemoryMonitor();
    instance.startAutoCleanup();

    console.log('[Performance] 性能优化系统已加载');
})();
