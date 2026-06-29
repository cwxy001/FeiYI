/*
 * asset-loader.js - 美术资产加载器（阶段八）
 * 功能：统一管理图片资源预加载、加载进度条、emoji 回退映射
 * 日期：2026-06-25
 *
 * 架构说明：
 *  - AssetLoader 单例：images Map / manifest / 进度跟踪 / 回退 emoji
 *  - preloadAll()：注册 12 建筑 + 25 敌人 + 10 UI 图标清单并预加载
 *  - 失败回退：所有 drawImage 调用前用 has() 检查，失败回退 Canvas/emoji（console.warn）
 *  - 加载进度条：全屏覆盖，深褐背景 + 金色填充 + 百分比文字
 *
 * 依赖：
 *  - index.html 需在 relic-system.js 之后引入本文件
 *  - 业务代码通过 window.AssetLoader 调用
 *
 * 关键修复：
 *  - 失败也 resolve（不阻塞游戏启动）
 *  - 加载超 5 秒显示"简化模式"按钮
 *  - 资产未就绪时游戏以回退模式运行，加载完成后自动切换
 */

(function () {
    'use strict';

    // ===== 默认资源清单（preloadAll 中注册） =====
    // 24 建筑（原12 + 阶段九新增12）
    const BUILDING_IDS = [
        'paper-cut', 'shadow-play', 'embroidery', 'ceramics', 'lion-dance', 'peking-opera',
        'martial-arts', 'tea-art', 'four-treasures', 'cuisine', 'tcm', 'ultimate',
        'tie-dye', 'wood-carving', 'sugar-painting', 'kite', 'oil-umbrella', 'lantern-art',
        'lacquerware', 'kesi', 'guqin', 'bronze-mirror', 'new-year-painting', 'clay-figurine'
    ];

    // 25 敌人（普通7 + 精英5 + BOSS12，含十二生肖）
    const ENEMY_IDS = [
        'rat-soldier', 'lamp-ghost', 'ox-minion', 'moon-rabbit', 'phantom-snake', 'monkey-demon', 'hellhound',
        'tiger-demon', 'dragon-guard', 'horse-elite', 'sheep-priest', 'golden-guard',
        'boss-rat', 'boss-ox', 'boss-tiger', 'boss-rabbit', 'boss-dragon', 'boss-snake',
        'boss-horse', 'boss-sheep', 'boss-monkey', 'boss-rooster', 'boss-dog', 'boss-pig'
    ];

    // 10 UI 图标
    const UI_ICONS = ['coin', 'inspiration', 'scroll', 'popularity', 'build', 'battle', 'collection', 'pause', 'speed', 'exit'];

    // ===== emoji 回退映射（图片加载失败时使用） =====
    const BUILDING_EMOJI = {
        'paper-cut': '✂️', 'shadow-play': '🎭', 'embroidery': '🧵', 'ceramics': '🏺',
        'lion-dance': '🦁', 'peking-opera': '🎭', 'martial-arts': '🥋', 'tea-art': '🍵',
        'four-treasures': '🖌️', 'cuisine': '🍜', 'tcm': '🌿', 'ultimate': '🏛️',
        'tie-dye': '🌀', 'wood-carving': '🪵', 'sugar-painting': '🍭', 'kite': '🪁',
        'oil-umbrella': '☂️', 'lantern-art': '🏮', 'lacquerware': '🪔', 'kesi': '🧶',
        'guqin': '🎼', 'bronze-mirror': '🪞', 'new-year-painting': '🎨', 'clay-figurine': '🧸'
    };
    const ENEMY_EMOJI = {
        'rat-soldier': '🐀', 'lamp-ghost': '🏮', 'ox-minion': '🐂', 'moon-rabbit': '🐇',
        'phantom-snake': '🐍', 'monkey-demon': '🐒', 'hellhound': '🐕',
        'tiger-demon': '🐯', 'dragon-guard': '🐉', 'horse-elite': '🐴',
        'sheep-priest': '🐑', 'golden-guard': '🦅',
        'boss-rat': '🐀', 'boss-ox': '🐂', 'boss-tiger': '🐯', 'boss-rabbit': '🐇',
        'boss-dragon': '🐉', 'boss-snake': '🐍', 'boss-horse': '🐴', 'boss-sheep': '🐑',
        'boss-monkey': '🐒', 'boss-rooster': '🐔', 'boss-dog': '🐕', 'boss-pig': '🐗'
    };
    const UI_EMOJI = {
        'coin': '💰', 'inspiration': '✨', 'scroll': '📜', 'popularity': '⭐',
        'build': '🏗️', 'battle': '⚔️', 'collection': '📖', 'pause': '⏸️', 'speed': '⏩', 'exit': '🚪'
    };

    class AssetLoader {
        constructor() {
            this.images = new Map();       // name -> Image
            this._loadedOk = new Set();    // 成功加载的资源名
            this.manifest = {};            // name -> url
            this.loadedCount = 0;
            this.totalCount = 0;
            this.isLoading = false;
            this._fallbackEmojis = Object.assign(
                {},
                this._prefixMap(BUILDING_EMOJI, 'building-'),
                this._prefixMap(ENEMY_EMOJI, 'enemy-'),
                this._prefixMap(UI_EMOJI, 'ui-')
            );
            this._progressEl = null;
            this._progressBarEl = null;
            this._progressTextEl = null;
            this._loadingScreenEl = null;
            this._slowTimerId = null;
            this._onProgressCb = null;
        }

        // 把 {id:emoji} 转为 {prefix+id: emoji}
        _prefixMap(map, prefix) {
            const r = {};
            for (const k in map) r[prefix + k] = map[k];
            return r;
        }

        /**
         * 批量加载图片清单
         * @param {object} manifest - { name: url, ... }
         * @returns {Promise} 全部完成（含失败）后 resolve
         */
        loadManifest(manifest) {
            const names = Object.keys(manifest);
            this.totalCount = names.length;
            this.loadedCount = 0;
            this.isLoading = true;

            if (this.totalCount === 0) {
                this.isLoading = false;
                return Promise.resolve();
            }

            return new Promise((resolve) => {
                let pending = this.totalCount;
                const onFinish = (name) => {
                    this.loadedCount++;
                    this._updateProgress();
                    pending--;
                    if (pending <= 0) {
                        this.isLoading = false;
                        resolve();
                    }
                };

                names.forEach((name) => {
                    const img = new Image();
                    img.onload = () => {
                        this._loadedOk.add(name);
                        onFinish(name);
                    };
                    img.onerror = () => {
                        // 失败：保留占位 Image 但标记未成功，console.warn 不抛错
                        console.warn(`[AssetLoader] 图片加载失败，回退到 emoji: ${name} (${manifest[name]})`);
                        onFinish(name);
                    };
                    img.src = manifest[name];
                    this.images.set(name, img);
                });
            });
        }

        /** 获取图片 Image 对象（可能未加载成功），失败返回 null */
        get(name) {
            const img = this.images.get(name);
            if (!img) return null;
            if (!this._loadedOk.has(name)) return null;
            return img;
        }

        /** 检查图片是否已成功加载 */
        has(name) {
            return this._loadedOk.has(name);
        }

        /** 返回加载进度 0-1 */
        getLoadProgress() {
            if (this.totalCount === 0) return 1;
            return Math.min(1, this.loadedCount / this.totalCount);
        }

        /** 设置回退 emoji */
        setFallback(name, emoji) {
            this._fallbackEmojis[name] = emoji;
        }

        /** 获取回退 emoji */
        getFallback(name) {
            return this._fallbackEmojis[name] || '❓';
        }

        /** 预加载所有资源（建筑/敌人/UI） */
        preloadAll() {
            const manifest = {};
            const v = '?v=67'; // 缓存版本号
            BUILDING_IDS.forEach((id) => {
                manifest['building-' + id] = `assets/images/buildings/${id}.png${v}`;
            });
            ENEMY_IDS.forEach((id) => {
                manifest['enemy-' + id] = `assets/images/enemies/${id}.png${v}`;
            });
            UI_ICONS.forEach((id) => {
                manifest['ui-' + id] = `assets/images/ui/${id}.png${v}`;
            });
            this.manifest = manifest;

            // 5 秒后显示"简化模式"按钮
            this._slowTimerId = setTimeout(() => {
                this._showSlowHint();
            }, 5000);

            return this.loadManifest(manifest).then(() => {
                if (this._slowTimerId) {
                    clearTimeout(this._slowTimerId);
                    this._slowTimerId = null;
                }
            });
        }

        // ===== 加载进度条 UI =====
        /** 初始化进度条 DOM 引用 */
        initProgressUI() {
            this._loadingScreenEl = document.getElementById('loading-screen');
            this._progressBarEl = document.getElementById('loading-bar');
            this._progressTextEl = document.getElementById('loading-text');
            return !!this._loadingScreenEl;
        }

        /** 设置进度回调（每加载一张调用） */
        onProgress(cb) {
            this._onProgressCb = cb;
        }

        _updateProgress() {
            const p = this.getLoadProgress();
            const pct = Math.round(p * 100);
            if (this._progressBarEl) {
                this._progressBarEl.style.width = pct + '%';
            }
            if (this._progressTextEl) {
                this._progressTextEl.textContent = pct + '%';
            }
            if (this._onProgressCb) {
                try { this._onProgressCb(p); } catch (e) { /* 忽略 */ }
            }
        }

        /** 显示"加载较慢"提示按钮 */
        _showSlowHint() {
            if (!this._loadingScreenEl) return;
            let btn = document.getElementById('loading-skip-btn');
            if (btn) return;
            btn = document.createElement('button');
            btn.id = 'loading-skip-btn';
            btn.textContent = '加载较慢，可先使用简化模式进入';
            btn.onclick = () => {
                // 隐藏进度条，游戏以回退模式继续
                this._hideLoadingScreen();
                if (window._managementInstance && !window._managementInstance._initialized) {
                    window._managementInstance.init();
                }
            };
            this._loadingScreenEl.appendChild(btn);
        }

        /** 淡出并隐藏加载进度条 */
        hideLoadingScreen() {
            this._hideLoadingScreen();
        }

        _hideLoadingScreen() {
            if (!this._loadingScreenEl) return;
            this._loadingScreenEl.classList.add('loading-done');
            setTimeout(() => {
                if (this._loadingScreenEl && this._loadingScreenEl.parentNode) {
                    this._loadingScreenEl.parentNode.removeChild(this._loadingScreenEl);
                }
                this._loadingScreenEl = null;
            }, 500);
        }
    }

    // 单例
    const instance = new AssetLoader();
    window.AssetLoader = instance;
})();
