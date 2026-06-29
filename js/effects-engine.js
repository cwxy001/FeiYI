/*
 * effects-engine.js - 粒子特效引擎（阶段五）
 * 功能：粒子系统核心、建筑常态动画、战斗特效、敌人特效、场景特效、升级/UI/DOM 特效
 * 日期：2026-06-23
 *
 * 架构说明：
 *  - ParticleSystem 可绑定任意 ctx，对象池复用，全局上限 500 粒子
 *  - BuildingFx 挂在经营地图 canvas（通过 IsometricMap.tileToScreen 转换坐标）
 *  - BattleFx / EnemyFx 挂在战斗 td-canvas（60px 网格像素坐标）
 *  - SceneFx / UiFx / DomFx 使用独立 overlay canvas + DOM（最高层级）
 *
 * 关键 Bug 规避：
 *  1. Canvas draw 前用 setTransform(1,0,0,1,0,0) 重置变换矩阵，避免累加 scale
 *  2. BuildingFx._normalizeType 统一键名（paper-cut/papercut/剪纸 → paper-cut）
 *  3. SceneFx resize 监听器保存引用，destroy 时移除
 *  4. SceneFx 的 setTimeout 保存到 _pendingTimeouts，clearWeather 时清理
 *  5. 粒子数量不超过 500 上限
 *
 * 依赖：
 *  - index.html 需在 tower-defense.js 之后引入本文件
 *  - BuildingFx 依赖 window.IsometricMap.tileToScreen / ctx
 *  - BattleFx 依赖 tower-defense.js 的 td-canvas ctx
 *  - UiFx 资源飞行依赖 index.html 中的 #coins-value 等资源栏元素
 */

(function () {
    'use strict';

    const MAX_PARTICLES = 500;

    // ===== Particle 类 =====
    class Particle {
        constructor() {
            this.active = false;
            this.x = 0; this.y = 0;
            this.vx = 0; this.vy = 0;
            this.life = 0; this.maxLife = 1;
            this.color = '#fff';
            this.size = 3;
            this.alpha = 1;
            this.gravity = 0;
            this.shape = 'circle'; // circle | rect | line
            this.rotation = 0;
            this.rotationSpeed = 0;
            this.fade = true;
        }

        reset(x, y, config) {
            config = config || {};
            this.x = x; this.y = y;
            this.vx = config.vx || 0;
            this.vy = config.vy || 0;
            this.life = config.life || 1;
            this.maxLife = this.life;
            this.color = config.color || '#fff';
            this.size = config.size || 3;
            this.alpha = config.alpha !== undefined ? config.alpha : 1;
            this.gravity = config.gravity || 0;
            this.shape = config.shape || 'circle';
            this.rotation = config.rotation || 0;
            this.rotationSpeed = config.rotationSpeed || 0;
            this.fade = config.fade !== undefined ? config.fade : true;
            this.active = true;
        }

        update(dt) {
            if (!this.active) return;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vy += this.gravity * dt;
            this.rotation += this.rotationSpeed * dt;
            this.life -= dt;
            if (this.fade) {
                this.alpha = Math.max(0, this.life / this.maxLife);
            }
            if (this.life <= 0) this.active = false;
        }

        draw(ctx) {
            if (!this.active) return;
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, this.alpha));
            ctx.fillStyle = this.color;
            if (this.shape === 'rect') {
                ctx.translate(this.x, this.y);
                ctx.rotate(this.rotation);
                ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
            } else if (this.shape === 'line') {
                ctx.strokeStyle = this.color;
                ctx.lineWidth = this.size;
                ctx.beginPath();
                ctx.moveTo(this.x, this.y);
                ctx.lineTo(this.x - this.vx * 0.05, this.y - this.vy * 0.05);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    // ===== ParticleSystem 类（对象池） =====
    class ParticleSystem {
        constructor(maxParticles) {
            this.maxParticles = Math.min(maxParticles || MAX_PARTICLES, MAX_PARTICLES);
            this.pool = [];
            for (let i = 0; i < this.maxParticles; i++) this.pool.push(new Particle());
            this.ctx = null;
        }

        setContext(ctx) { this.ctx = ctx; }

        /** 批量发射粒子。configFn 可以是函数（返回每个粒子配置）或配置对象 */
        emit(x, y, count, configFn) {
            for (let i = 0; i < count; i++) {
                const p = this._acquire();
                if (!p) break; // 池满
                const cfg = typeof configFn === 'function' ? configFn(i) : configFn;
                const ox = cfg.offsetX || 0;
                const oy = cfg.offsetY || 0;
                p.reset(x + ox, y + oy, cfg);
            }
        }

        _acquire() {
            for (let i = 0; i < this.pool.length; i++) {
                if (!this.pool[i].active) return this.pool[i];
            }
            return null;
        }

        update(dt) {
            for (let i = 0; i < this.pool.length; i++) {
                if (this.pool[i].active) this.pool[i].update(dt);
            }
        }

        draw(ctx) {
            const c = ctx || this.ctx;
            if (!c) return;
            for (let i = 0; i < this.pool.length; i++) {
                if (this.pool[i].active) this.pool[i].draw(c);
            }
        }

        clear() {
            for (let i = 0; i < this.pool.length; i++) this.pool[i].active = false;
        }

        get count() {
            let n = 0;
            for (let i = 0; i < this.pool.length; i++) if (this.pool[i].active) n++;
            return n;
        }
    }

    // ===== FxEngine 全局管理器 =====
    const FxEngine = {
        systems: {},
        register(name, system) { this.systems[name] = system; },
        unregister(name) { delete this.systems[name]; },
        update(dt) {
            for (const k in this.systems) {
                if (this.systems[k] && this.systems[k].update) this.systems[k].update(dt);
            }
        },
        draw(ctx) {
            for (const k in this.systems) {
                if (this.systems[k] && this.systems[k].draw) this.systems[k].draw(ctx);
            }
        },
        clearAll() {
            for (const k in this.systems) {
                if (this.systems[k] && this.systems[k].clear) this.systems[k].clear();
            }
        }
    };

    // ===== BuildingFx 建筑常态动画 =====
    const BuildingFx = {
        _system: null,
        _buildings: {}, // {id: {gridX, gridY, width, height, type, timer, interval}}
        _rafId: null,
        _lastTime: 0,

        /** 统一键名：paper-cut/papercut/剪纸/剪纸坊 → paper-cut */
        _normalizeType(type) {
            if (!type) return type;
            const t = String(type).toLowerCase().trim();
            const map = {
                'paper-cut': 'paper-cut', 'papercut': 'paper-cut', '剪纸': 'paper-cut', '剪纸坊': 'paper-cut',
                'shadow-play': 'shadow-play', 'shadowplay': 'shadow-play', '皮影': 'shadow-play', '皮影戏': 'shadow-play', '皮影戏坊': 'shadow-play',
                'embroidery': 'embroidery', '刺绣': 'embroidery', '刺绣坊': 'embroidery',
                'ceramics': 'ceramics', '陶瓷': 'ceramics', '陶瓷坊': 'ceramics',
                'lion-dance': 'lion-dance', 'liondance': 'lion-dance', '舞狮': 'lion-dance', '舞狮坊': 'lion-dance',
                'peking-opera': 'peking-opera', 'pekingopera': 'peking-opera', '京剧': 'peking-opera', '京剧坊': 'peking-opera',
                'martial-arts': 'martial-arts', 'martialarts': 'martial-arts', '武术': 'martial-arts', '武术坊': 'martial-arts',
                'tea-art': 'tea-art', 'teaart': 'tea-art', '茶艺': 'tea-art', '茶艺坊': 'tea-art',
                'four-treasures': 'four-treasures', 'fourtreasures': 'four-treasures', '文房四宝': 'four-treasures', '文房四宝坊': 'four-treasures', '文房': 'four-treasures',
                'cuisine': 'cuisine', '美食': 'cuisine', '非遗美食': 'cuisine', '非遗美食坊': 'cuisine',
                'tcm': 'tcm', '中医': 'tcm', '中医坊': 'tcm',
                'ultimate': 'ultimate', '终极融合': 'ultimate', '终极融合坊': 'ultimate', '终极': 'ultimate'
            };
            return map[t] || map[type] || t;
        },

        _configs: {
            // 1. 剪纸坊：红色纸片飘落
            'paper-cut': { count: 1, interval: 0.5, factory: () => ({
                offsetX: (Math.random() - 0.5) * 50,
                offsetY: -10,
                vx: (Math.random() - 0.5) * 15,
                vy: 8 + Math.random() * 8,
                life: 2.5 + Math.random(),
                color: '#DC143C',
                size: 3 + Math.random() * 2,
                shape: 'rect',
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 3,
                gravity: 3
            })},
            // 2. 皮影戏坊：光影闪烁
            'shadow-play': { count: 1, interval: 0.4, factory: () => ({
                offsetX: (Math.random() - 0.5) * 40,
                offsetY: (Math.random() - 0.5) * 30,
                vx: (Math.random() - 0.5) * 10,
                vy: -5 + Math.random() * 10,
                life: 1.2 + Math.random() * 0.5,
                color: Math.random() < 0.5 ? '#000000' : '#FFFFFF',
                size: 4 + Math.random() * 3,
                alpha: 0.2 + Math.random() * 0.4,
                shape: 'circle'
            })},
            // 3. 刺绣坊：金线闪光
            'embroidery': { count: 1, interval: 0.45, factory: () => ({
                offsetX: (Math.random() - 0.5) * 40,
                offsetY: (Math.random() - 0.5) * 25,
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() - 0.5) * 20,
                life: 0.6 + Math.random() * 0.4,
                color: '#FFD700',
                size: 1.5 + Math.random(),
                shape: 'line',
                rotation: Math.random() * Math.PI
            })},
            // 4. 陶瓷坊：窑火升腾
            'ceramics': { count: 1, interval: 0.3, factory: () => ({
                offsetX: (Math.random() - 0.5) * 20,
                offsetY: 5,
                vx: (Math.random() - 0.5) * 10,
                vy: -30 - Math.random() * 20,
                life: 0.8 + Math.random() * 0.4,
                color: Math.random() < 0.5 ? '#FF4500' : '#FF8C00',
                size: 3 + Math.random() * 2,
                shape: 'circle',
                fade: true
            })},
            // 5. 舞狮坊：金色尘土飞扬
            'lion-dance': { count: 1, interval: 0.4, factory: () => ({
                offsetX: (Math.random() - 0.5) * 45,
                offsetY: 10,
                vx: (Math.random() - 0.5) * 25,
                vy: -15 - Math.random() * 15,
                life: 1 + Math.random() * 0.5,
                color: '#DAA520',
                size: 2 + Math.random() * 2,
                shape: 'circle',
                gravity: 8
            })},
            // 6. 京剧坊：脸谱色彩变换
            'peking-opera': { count: 1, interval: 0.6, factory: () => {
                const colors = ['#DC143C', '#1E90FF', '#FFD700', '#228B22', '#8A2BE2'];
                return {
                    offsetX: (Math.random() - 0.5) * 40,
                    offsetY: (Math.random() - 0.5) * 30,
                    vx: (Math.random() - 0.5) * 8,
                    vy: -5 + Math.random() * 10,
                    life: 1.5 + Math.random(),
                    color: colors[Math.floor(Math.random() * colors.length)],
                    size: 4 + Math.random() * 2,
                    shape: 'circle',
                    alpha: 0.6
                };
            }},
            // 7. 武术坊：气流旋涡
            'martial-arts': { count: 1, interval: 0.25, factory: () => {
                const angle = Math.random() * Math.PI * 2;
                const dist = 15 + Math.random() * 10;
                return {
                    offsetX: Math.cos(angle) * dist,
                    offsetY: Math.sin(angle) * dist,
                    vx: -Math.sin(angle) * 25,
                    vy: Math.cos(angle) * 25,
                    life: 1 + Math.random() * 0.5,
                    color: 'rgba(255,255,255,0.5)',
                    size: 2 + Math.random(),
                    shape: 'circle'
                };
            }},
            // 8. 茶艺坊：茶烟袅袅
            'tea-art': { count: 1, interval: 0.6, factory: () => ({
                offsetX: (Math.random() - 0.5) * 15,
                offsetY: 0,
                vx: (Math.random() - 0.5) * 5,
                vy: -20 - Math.random() * 10,
                life: 1.8 + Math.random() * 0.5,
                color: 'rgba(152,251,152,0.4)',
                size: 5 + Math.random() * 3,
                shape: 'circle'
            })},
            // 9. 文房四宝坊：墨滴飘散
            'four-treasures': { count: 1, interval: 0.5, factory: () => ({
                offsetX: (Math.random() - 0.5) * 35,
                offsetY: (Math.random() - 0.5) * 25,
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() - 0.5) * 20,
                life: 1.2 + Math.random() * 0.5,
                color: '#1a1a1a',
                size: 2 + Math.random() * 2,
                shape: 'circle'
            })},
            // 10. 非遗美食坊：蒸汽升腾
            'cuisine': { count: 1, interval: 0.5, factory: () => ({
                offsetX: (Math.random() - 0.5) * 20,
                offsetY: 0,
                vx: (Math.random() - 0.5) * 6,
                vy: -25 - Math.random() * 10,
                life: 1.5 + Math.random() * 0.5,
                color: 'rgba(255,255,255,0.4)',
                size: 6 + Math.random() * 3,
                shape: 'circle'
            })},
            // 11. 中医坊：药草飘散
            'tcm': { count: 1, interval: 0.6, factory: () => ({
                offsetX: (Math.random() - 0.5) * 40,
                offsetY: -10,
                vx: (Math.random() - 0.5) * 12,
                vy: 6 + Math.random() * 8,
                life: 2 + Math.random(),
                color: '#228B22',
                size: 3 + Math.random() * 2,
                shape: 'rect',
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 2,
                gravity: 2
            })},
            // 12. 终极融合坊：五彩光芒汇聚
            'ultimate': { count: 2, interval: 0.3, factory: () => {
                const angle = Math.random() * Math.PI * 2;
                const dist = 35 + Math.random() * 15;
                return {
                    offsetX: Math.cos(angle) * dist,
                    offsetY: Math.sin(angle) * dist,
                    vx: -Math.cos(angle) * 35,
                    vy: -Math.sin(angle) * 35,
                    life: 0.8 + Math.random() * 0.3,
                    color: `hsl(${Math.floor(Math.random() * 360)}, 100%, 60%)`,
                    size: 2 + Math.random() * 2,
                    shape: 'circle'
                };
            }}
        },

        init() {
            if (this._system) return;
            this._system = new ParticleSystem(MAX_PARTICLES);
        },

        /** 注册建筑常态动画。type 支持多种变体（paper-cut/papercut/剪纸） */
        register(buildingId, gridX, gridY, width, height, type) {
            this.init();
            const normType = this._normalizeType(type);
            this._buildings[buildingId] = {
                gridX, gridY,
                width: width || 1, height: height || 1,
                type: normType,
                timer: 0,
                interval: (this._configs[normType] && this._configs[normType].interval) || 0.2
            };
        },

        unregister(buildingId) {
            delete this._buildings[buildingId];
        },

        /** 启动 rAF 循环驱动粒子更新 + 地图重绘 */
        start() {
            this.init();
            if (this._rafId) return;
            this._lastTime = 0;
            const loop = (t) => {
                if (!this._rafId) return;
                if (this._lastTime === 0) this._lastTime = t;
                let dt = (t - this._lastTime) / 1000;
                this._lastTime = t;
                if (dt > 0.05) dt = 0.05;
                this.update(dt);
                // 触发地图重绘（render hook 会调用 BuildingFx.draw）
                if (window.IsometricMap && window.IsometricMap.render) {
                    window.IsometricMap.render();
                }
                this._rafId = requestAnimationFrame(loop);
            };
            this._rafId = requestAnimationFrame(loop);
        },

        stop() {
            if (this._rafId) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
        },

        update(dt) {
            if (!this._system) return;
            for (const id in this._buildings) {
                const b = this._buildings[id];
                b.timer += dt;
                if (b.timer >= b.interval) {
                    b.timer = 0;
                    this._emit(b);
                }
            }
            this._system.update(dt);
        },

        _emit(b) {
            const cfg = this._configs[b.type];
            if (!cfg) return;
            const pos = this._buildingCenter(b);
            if (!pos) return;
            this._system.emit(pos.x, pos.y, cfg.count, cfg.factory);
        },

        /** 计算建筑中心的屏幕坐标 */
        _buildingCenter(b) {
            if (!window.IsometricMap || !window.IsometricMap.tileToScreen) return null;
            const cx = b.gridX + b.width / 2;
            const cy = b.gridY + b.height / 2;
            const s = window.IsometricMap.tileToScreen(cx, cy);
            return { x: s.x, y: s.y - 15 }; // 略上移到建筑中部
        },

        draw(ctx) {
            if (!this._system || !ctx) return;
            // 关键 Bug 规避：setTransform 重置变换矩阵，避免累加 scale
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            this._system.draw(ctx);
            ctx.restore();
        },

        clear() {
            this._buildings = {};
            if (this._system) this._system.clear();
        }
    };

    // ===== BattleFx 战斗特效 =====
    const BattleFx = {
        _system: null,

        init() {
            if (this._system) return;
            this._system = new ParticleSystem(MAX_PARTICLES);
        },

        _normalizeType(type) {
            return BuildingFx._normalizeType(type);
        },

        /** 塔攻击时触发。towerType 为建筑 ID（如 paper-cut），(x,y) 塔位置，(tx,ty) 目标位置 */
        play(towerType, x, y, tx, ty) {
            this.init();
            const type = this._normalizeType(towerType);
            const fn = this._effects[type];
            if (fn) fn.call(this, x, y, tx, ty);
        },

        _effects: {
            // 1. 剪纸塔：红色纸片旋转飞出
            'paper-cut': function (x, y, tx, ty) {
                this._system.emit(x, y, 8, () => ({
                    vx: (tx - x) * 1.5 + (Math.random() - 0.5) * 80,
                    vy: (ty - y) * 1.5 + (Math.random() - 0.5) * 80,
                    life: 0.4,
                    color: '#DC143C',
                    size: 4,
                    shape: 'rect',
                    rotation: Math.random() * Math.PI * 2,
                    rotationSpeed: 15
                }));
            },
            // 2. 皮影塔：黑色影子飞出
            'shadow-play': function (x, y, tx, ty) {
                this._system.emit(x, y, 6, () => ({
                    vx: (tx - x) * 1.8,
                    vy: (ty - y) * 1.8,
                    life: 0.35,
                    color: '#000000',
                    size: 5,
                    shape: 'circle',
                    alpha: 0.7
                }));
            },
            // 3. 刺绣塔：金色丝线缠绕
            'embroidery': function (x, y, tx, ty) {
                this._system.emit(x, y, 5, () => ({
                    vx: (tx - x) * 1.5 + (Math.random() - 0.5) * 30,
                    vy: (ty - y) * 1.5 + (Math.random() - 0.5) * 30,
                    life: 0.5,
                    color: '#FFD700',
                    size: 2,
                    shape: 'line'
                }));
            },
            // 4. 陶瓷塔：碎片爆炸
            'ceramics': function (x, y, tx, ty) {
                this._system.emit(tx, ty, 12, () => {
                    const a = Math.random() * Math.PI * 2;
                    const s = 80 + Math.random() * 80;
                    return {
                        vx: Math.cos(a) * s,
                        vy: Math.sin(a) * s,
                        life: 0.5,
                        color: '#8B4513',
                        size: 3 + Math.random() * 2,
                        shape: 'rect',
                        rotation: Math.random() * Math.PI * 2,
                        rotationSpeed: 10,
                        gravity: 100
                    };
                });
            },
            // 5. 舞狮塔：金色光芒冲撞
            'lion-dance': function (x, y, tx, ty) {
                this._system.emit(x, y, 10, () => ({
                    vx: (tx - x) * 1.6 + (Math.random() - 0.5) * 40,
                    vy: (ty - y) * 1.6 + (Math.random() - 0.5) * 40,
                    life: 0.45,
                    color: '#FFD700',
                    size: 4,
                    shape: 'circle'
                }));
            },
            // 6. 京剧塔：红蓝金交替光效
            'peking-opera': function (x, y, tx, ty) {
                const colors = ['#DC143C', '#1E90FF', '#FFD700'];
                this._system.emit(x, y, 9, (i) => ({
                    vx: (tx - x) * 1.4 + (Math.random() - 0.5) * 50,
                    vy: (ty - y) * 1.4 + (Math.random() - 0.5) * 50,
                    life: 0.5,
                    color: colors[i % 3],
                    size: 5,
                    shape: 'circle'
                }));
            },
            // 7. 武术塔：白色拳影连击
            'martial-arts': function (x, y, tx, ty) {
                this._system.emit(tx, ty, 6, () => ({
                    vx: (Math.random() - 0.5) * 60,
                    vy: (Math.random() - 0.5) * 60,
                    life: 0.2,
                    color: '#FFFFFF',
                    size: 6,
                    shape: 'circle',
                    alpha: 0.8
                }));
            },
            // 8. 茶艺塔：绿色光晕扩散
            'tea-art': function (x, y, tx, ty) {
                this._system.emit(x, y, 8, () => {
                    const a = Math.random() * Math.PI * 2;
                    return {
                        vx: Math.cos(a) * 40,
                        vy: Math.sin(a) * 40,
                        life: 0.6,
                        color: '#90EE90',
                        size: 4,
                        shape: 'circle',
                        alpha: 0.6
                    };
                });
            },
            // 9. 文房塔：墨点飞射
            'four-treasures': function (x, y, tx, ty) {
                this._system.emit(x, y, 7, () => ({
                    vx: (tx - x) * 1.5 + (Math.random() - 0.5) * 40,
                    vy: (ty - y) * 1.5 + (Math.random() - 0.5) * 40,
                    life: 0.4,
                    color: '#1a1a1a',
                    size: 3,
                    shape: 'circle'
                }));
            },
            // 10. 美食塔：金色粒子上升
            'cuisine': function (x, y, tx, ty) {
                this._system.emit(tx, ty, 8, () => ({
                    vx: (Math.random() - 0.5) * 30,
                    vy: -60 - Math.random() * 30,
                    life: 0.7,
                    color: '#FFD700',
                    size: 3,
                    shape: 'circle'
                }));
            },
            // 11. 中医塔：绿色治疗射线
            'tcm': function (x, y, tx, ty) {
                this._system.emit(x, y, 6, () => ({
                    vx: (tx - x) * 1.3,
                    vy: (ty - y) * 1.3,
                    life: 0.5,
                    color: '#228B22',
                    size: 3,
                    shape: 'line'
                }));
            },
            // 12. 终极融合塔：五彩爆发
            'ultimate': function (x, y, tx, ty) {
                this._system.emit(tx, ty, 20, () => {
                    const a = Math.random() * Math.PI * 2;
                    const s = 60 + Math.random() * 100;
                    return {
                        vx: Math.cos(a) * s,
                        vy: Math.sin(a) * s,
                        life: 0.8,
                        color: `hsl(${Math.floor(Math.random() * 360)}, 100%, 60%)`,
                        size: 3 + Math.random() * 2,
                        shape: 'circle'
                    };
                });
            }
        },

        update(dt) { if (this._system) this._system.update(dt); },
        draw(ctx) {
            if (!this._system || !ctx) return;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            this._system.draw(ctx);
            ctx.restore();
        },
        clear() { if (this._system) this._system.clear(); }
    };

    // ===== EnemyFx 敌人特效 =====
    const EnemyFx = {
        _system: null,

        init() {
            if (this._system) return;
            this._system = new ParticleSystem(MAX_PARTICLES);
        },

        /** BOSS 登场：暗色光环扩散（屏幕震动由 DomFx 处理） */
        bossSpawn(x, y) {
            this.init();
            this._system.emit(x, y, 30, () => {
                const a = Math.random() * Math.PI * 2;
                const s = 40 + Math.random() * 60;
                return {
                    vx: Math.cos(a) * s,
                    vy: Math.sin(a) * s,
                    life: 1,
                    color: '#2F004F',
                    size: 5 + Math.random() * 3,
                    shape: 'circle',
                    alpha: 0.7
                };
            });
        },

        /** BOSS 死亡：大型彩色爆炸 */
        bossDeath(x, y) {
            this.init();
            this._system.emit(x, y, 50, () => {
                const a = Math.random() * Math.PI * 2;
                const s = 80 + Math.random() * 150;
                return {
                    vx: Math.cos(a) * s,
                    vy: Math.sin(a) * s,
                    life: 1 + Math.random() * 0.5,
                    color: `hsl(${Math.floor(Math.random() * 360)}, 100%, 60%)`,
                    size: 3 + Math.random() * 3,
                    shape: 'circle',
                    gravity: 50
                };
            });
        },

        /** 普通敌人死亡：消散动画 */
        enemyDeath(x, y, color) {
            this.init();
            this._system.emit(x, y, 10, () => {
                const a = Math.random() * Math.PI * 2;
                const s = 20 + Math.random() * 40;
                return {
                    vx: Math.cos(a) * s,
                    vy: Math.sin(a) * s,
                    life: 0.6,
                    color: color || '#888',
                    size: 3 + Math.random() * 2,
                    shape: 'circle',
                    alpha: 0.6
                };
            });
        },

        update(dt) { if (this._system) this._system.update(dt); },
        draw(ctx) {
            if (!this._system || !ctx) return;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            this._system.draw(ctx);
            ctx.restore();
        },
        clear() { if (this._system) this._system.clear(); }
    };

    // ===== SceneFx 场景特效（雨/雪/雾/烟花/灯笼/花瓣） =====
    const SceneFx = {
        _system: null,
        _canvas: null,
        _ctx: null,
        _current: null,
        _rafId: null,
        _lastTime: 0,
        _pendingTimeouts: [], // 关键 Bug 规避：保存 setTimeout 引用
        _resizeHandler: null,

        _initOverlay() {
            if (this._canvas) return;
            this._canvas = document.createElement('canvas');
            this._canvas.id = 'fx-scene-overlay';
            this._canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:90;';
            document.body.appendChild(this._canvas);
            this._ctx = this._canvas.getContext('2d');
            this._resize();
            this._resizeHandler = () => this._resize();
            window.addEventListener('resize', this._resizeHandler);
            this._system = new ParticleSystem(MAX_PARTICLES);
        },

        _resize() {
            if (!this._canvas) return;
            this._canvas.width = window.innerWidth;
            this._canvas.height = window.innerHeight;
        },

        _weatherConfigs: {
            // 雨：蓝色细线斜向下
            'rain': { count: 5, interval: 0.02, factory: () => ({
                offsetX: Math.random() * window.innerWidth,
                offsetY: -20,
                vx: -40,
                vy: 400 + Math.random() * 200,
                life: 1.5,
                color: 'rgba(135,206,235,0.6)',
                size: 1.5,
                shape: 'line',
                fade: false
            })},
            // 雪：白色圆形缓慢飘落
            'snow': { count: 2, interval: 0.1, factory: () => ({
                offsetX: Math.random() * window.innerWidth,
                offsetY: -10,
                vx: (Math.random() - 0.5) * 20,
                vy: 30 + Math.random() * 30,
                life: 6,
                color: '#FFFFFF',
                size: 2 + Math.random() * 2,
                shape: 'circle',
                fade: false
            })},
            // 雾：白色半透明缓慢飘动
            'fog': { count: 1, interval: 0.3, factory: () => ({
                offsetX: Math.random() * window.innerWidth,
                offsetY: Math.random() * window.innerHeight,
                vx: (Math.random() - 0.5) * 10,
                vy: (Math.random() - 0.5) * 5,
                life: 4,
                color: 'rgba(255,255,255,0.15)',
                size: 30 + Math.random() * 20,
                shape: 'circle',
                fade: true
            })},
            // 灯笼：橙红色圆形缓慢上升
            'lantern': { count: 1, interval: 0.5, factory: () => ({
                offsetX: Math.random() * window.innerWidth,
                offsetY: window.innerHeight + 10,
                vx: (Math.random() - 0.5) * 10,
                vy: -30 - Math.random() * 20,
                life: 8,
                color: '#FF6347',
                size: 4 + Math.random() * 2,
                shape: 'circle',
                fade: false
            })},
            // 花瓣：粉色小花瓣缓慢飘落
            'petal': { count: 1, interval: 0.15, factory: () => ({
                offsetX: Math.random() * window.innerWidth,
                offsetY: -10,
                vx: (Math.random() - 0.5) * 30,
                vy: 20 + Math.random() * 20,
                life: 6,
                color: '#FFB6C1',
                size: 4 + Math.random() * 2,
                shape: 'rect',
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 3,
                fade: false
            })}
        },

        /** 设置天气。type: rain/snow/fog/lantern/petal/firework */
        setWeather(type) {
            this._initOverlay();
            this.clearWeather();
            if (type === 'firework') {
                this._startFirework();
                return;
            }
            const cfg = this._weatherConfigs[type];
            if (!cfg) return;
            this._current = { type, cfg, timer: 0 };
            this._startLoop();
        },

        /** 烟花：周期性向上爆发后四散 */
        _startFirework() {
            this._current = { type: 'firework' };
            this._startLoop();
            const launch = () => {
                if (!this._current || this._current.type !== 'firework') return;
                const x = window.innerWidth * (0.2 + Math.random() * 0.6);
                const y = window.innerHeight * (0.2 + Math.random() * 0.4);
                this._system.emit(x, y, 40, () => {
                    const a = Math.random() * Math.PI * 2;
                    const s = 60 + Math.random() * 120;
                    return {
                        vx: Math.cos(a) * s,
                        vy: Math.sin(a) * s,
                        life: 1 + Math.random() * 0.5,
                        color: `hsl(${Math.floor(Math.random() * 360)}, 100%, 60%)`,
                        size: 2 + Math.random() * 2,
                        shape: 'circle',
                        gravity: 40
                    };
                });
                // 关键 Bug 规避：保存 setTimeout 引用
                const id = setTimeout(launch, 800 + Math.random() * 700);
                this._pendingTimeouts.push(id);
            };
            launch();
        },

        _startLoop() {
            if (this._rafId) return;
            this._lastTime = 0;
            const loop = (t) => {
                if (!this._rafId) return;
                if (this._lastTime === 0) this._lastTime = t;
                let dt = (t - this._lastTime) / 1000;
                this._lastTime = t;
                if (dt > 0.05) dt = 0.05;
                this.update(dt);
                this._render();
                this._rafId = requestAnimationFrame(loop);
            };
            this._rafId = requestAnimationFrame(loop);
        },

        update(dt) {
            if (!this._system || !this._current) return;
            // 持续发射（firework 由 setTimeout 驱动）
            if (this._current.type !== 'firework' && this._current.cfg) {
                this._current.timer += dt;
                if (this._current.timer >= this._current.cfg.interval) {
                    this._current.timer = 0;
                    this._system.emit(0, 0, this._current.cfg.count, this._current.cfg.factory);
                }
            }
            this._system.update(dt);
        },

        _render() {
            if (!this._ctx) return;
            this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
            this._ctx.save();
            this._ctx.setTransform(1, 0, 0, 1, 0, 0);
            this._system.draw(this._ctx);
            this._ctx.restore();
        },

        /** 清理天气：清理所有 setTimeout + 粒子 */
        clearWeather() {
            // 关键 Bug 规避：清理所有 pending setTimeout
            this._pendingTimeouts.forEach(id => clearTimeout(id));
            this._pendingTimeouts = [];
            this._current = null;
            if (this._system) this._system.clear();
            if (this._rafId) {
                cancelAnimationFrame(this._rafId);
                this._rafId = null;
            }
            if (this._ctx) this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        },

        /** 销毁：移除 canvas + resize 监听器 */
        destroy() {
            this.clearWeather();
            // 关键 Bug 规避：移除 resize 监听器
            if (this._resizeHandler) {
                window.removeEventListener('resize', this._resizeHandler);
                this._resizeHandler = null;
            }
            if (this._canvas && this._canvas.parentNode) {
                this._canvas.parentNode.removeChild(this._canvas);
            }
            this._canvas = null;
            this._ctx = null;
            this._system = null;
        }
    };

    // ===== UpgradeFx 升级特效 =====
    const UpgradeFx = {
        _system: null,

        init() {
            if (this._system) return;
            this._system = new ParticleSystem(200);
        },

        /** 升级时金色光芒从建筑向上扩散。x,y 为屏幕坐标 */
        play(x, y) {
            this.init();
            this._system.emit(x, y, 30, () => ({
                vx: (Math.random() - 0.5) * 60,
                vy: -60 - Math.random() * 60,
                life: 1 + Math.random() * 0.3,
                color: '#FFD700',
                size: 2 + Math.random() * 3,
                shape: 'circle',
                gravity: -15
            }));
        },

        update(dt) { if (this._system) this._system.update(dt); },
        draw(ctx) {
            if (!this._system || !ctx) return;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            this._system.draw(ctx);
            ctx.restore();
        },
        clear() { if (this._system) this._system.clear(); }
    };

    // ===== UiFx UI 特效 =====
    const UiFx = {
        _floatLayer: null,

        _getLayer() {
            if (!this._floatLayer) {
                this._floatLayer = document.createElement('div');
                this._floatLayer.id = 'fx-ui-layer';
                this._floatLayer.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
                document.body.appendChild(this._floatLayer);
            }
            return this._floatLayer;
        },

        /** 抽牌动画：宣纸画卷展开 + 毛笔字 + 红色印章。callback 在动画结束后调用 */
        playDrawCard(card, callback) {
            const anim = document.getElementById('td-draw-anim');
            if (!anim) { if (callback) callback(); return; }
            anim.innerHTML = `
                <div class="td-draw-scroll">
                    <div class="td-draw-name">${card.name || ''}</div>
                    <div class="td-draw-emoji">${card.emoji || ''}</div>
                    <div class="td-draw-seal">印</div>
                </div>`;
            anim.classList.remove('hidden');
            setTimeout(() => {
                anim.classList.add('hidden');
                if (callback) callback();
            }, 1200);
        },

        /** 资源飞行动画：从 (fromX, fromY) 飞向资源栏元素。targetId 如 'coins-value' */
        flyResource(fromX, fromY, text, color, targetId) {
            const layer = this._getLayer();
            const el = document.createElement('div');
            el.className = 'fx-resource-fly';
            el.textContent = text;
            el.style.color = color || '#FFD700';
            el.style.left = fromX + 'px';
            el.style.top = fromY + 'px';

            if (targetId) {
                // 飞向目标
                const target = document.getElementById(targetId);
                if (target) {
                    const rect = target.getBoundingClientRect();
                    const toX = rect.left + rect.width / 2;
                    const toY = rect.top + rect.height / 2;
                    el.style.setProperty('--fx-to-x', (toX - fromX) + 'px');
                    el.style.setProperty('--fx-to-y', (toY - fromY) + 'px');
                }
            } else {
                // 不飞向目标，向上飘浮消失
                el.style.setProperty('--fx-to-x', '0px');
                el.style.setProperty('--fx-to-y', '-40px');
            }
            layer.appendChild(el);
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 900);
        }
    };

    // ===== DomFx DOM 特效 =====
    const DomFx = {
        _shakeTimeout: null,

        /** 屏幕震动。intensity 震动幅度(px)，duration 持续时间(ms) */
        shake(intensity, duration) {
            intensity = intensity || 10;
            duration = duration || 500;
            const target = document.getElementById('td-screen') || document.body;
            target.style.setProperty('--fx-shake-amp', intensity + 'px');
            target.classList.add('fx-shake');
            if (this._shakeTimeout) clearTimeout(this._shakeTimeout);
            this._shakeTimeout = setTimeout(() => {
                target.classList.remove('fx-shake');
                this._shakeTimeout = null;
            }, duration);
        },

        /** 飘浮文字（伤害/治疗数字等）。x,y 为屏幕坐标 */
        floatText(x, y, text, color) {
            const layer = UiFx._getLayer();
            const el = document.createElement('div');
            el.className = 'fx-float-text';
            el.textContent = text;
            el.style.color = color || '#FFD700';
            el.style.left = x + 'px';
            el.style.top = y + 'px';
            layer.appendChild(el);
            setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
        }
    };

    // ===== 阶段八：LottieFx 动画引擎（失败回退 CSS） =====
    const LottieFx = {
        _animations: new Map(),   // id -> { anim, el, timer }
        _nextId: 1,
        _available: null,         // null=未检测, true/false=已检测

        // 动画清单：name -> { path, w, h, fallback }
        _manifest: {
            'building-place': { path: 'assets/lottie/building-place.json', w: 200, h: 200, fallback: 'goldRing' },
            'upgrade':        { path: 'assets/lottie/upgrade.json',        w: 200, h: 240, fallback: 'goldStar' },
            'enemy-death':    { path: 'assets/lottie/enemy-death.json',    w: 200, h: 200, fallback: 'redBurst' },
            'boss-spawn':     { path: 'assets/lottie/boss-spawn.json',     w: 300, h: 300, fallback: 'purpleRay' }
        },

        /** 检测 lottie 是否可用（懒检测，只检测一次） */
        _checkAvailable() {
            if (this._available !== null) return this._available;
            this._available = !!(window.lottie && typeof window.lottie.loadAnimation === 'function');
            if (!this._available) {
                console.warn('[LottieFx] lottie-web 未加载，将使用 CSS 回退动画');
            }
            return this._available;
        },

        /**
         * 播放 Lottie 动画
         * @param {string} name - 动画名（building-place/upgrade/enemy-death/boss-spawn）
         * @param {number} x - 屏幕坐标 X（动画中心点）
         * @param {number} y - 屏幕坐标 Y（动画中心点）
         * @param {object} opts - { scale: 缩放倍率, loop: 是否循环, timeout: 超时ms }
         * @returns {number} 动画 ID（可用于提前 stop）
         */
        play(name, x, y, opts) {
            opts = opts || {};
            const cfg = this._manifest[name];
            if (!cfg) {
                console.warn('[LottieFx] 未知动画名:', name);
                return 0;
            }

            // 检测 lottie 可用性
            if (!this._checkAvailable()) {
                this._fallback(cfg.fallback, x, y, opts);
                return 0;
            }

            const id = this._nextId++;
            const scale = opts.scale || 1;
            const w = cfg.w * scale;
            const h = cfg.h * scale;

            // 创建容器 div
            const el = document.createElement('div');
            el.className = 'lottie-fx-container';
            el.style.cssText = `position:fixed;left:${x - w/2}px;top:${y - h/2}px;width:${w}px;height:${h}px;pointer-events:none;z-index:9000;`;
            document.body.appendChild(el);

            let anim = null;
            try {
                // 优先使用内联数据（解决 file:// 协议下 CORS 限制）
                const animOpts = {
                    container: el,
                    renderer: 'svg',
                    loop: !!opts.loop,
                    autoplay: true
                };
                if (window.LOTTIE_DATA && window.LOTTIE_DATA[name]) {
                    animOpts.animationData = window.LOTTIE_DATA[name];
                } else {
                    animOpts.path = cfg.path;
                }
                anim = window.lottie.loadAnimation(animOpts);

                // 加载失败回退
                anim.addEventListener('data_failed', () => {
                    console.warn('[LottieFx] 动画加载失败，回退 CSS:', name);
                    this._cleanup(id);
                    this._fallback(cfg.fallback, x, y, opts);
                });

                // 动画完成自动清理（非循环模式）
                if (!opts.loop) {
                    anim.addEventListener('complete', () => {
                        this._cleanup(id);
                    });
                }
            } catch (e) {
                console.warn('[LottieFx] loadAnimation 异常，回退 CSS:', name, e);
                this._cleanup(id);
                this._fallback(cfg.fallback, x, y, opts);
                return 0;
            }

            // 超时保护：防止动画卡住不触发 complete
            const timeout = opts.timeout || 3000;
            const timer = setTimeout(() => {
                this._cleanup(id);
            }, timeout);

            this._animations.set(id, { anim, el, timer });
            return id;
        },

        /** 清理单个动画 */
        _cleanup(id) {
            const item = this._animations.get(id);
            if (!item) return;
            if (item.timer) { clearTimeout(item.timer); }
            if (item.anim) {
                try { item.anim.destroy(); } catch (e) {}
            }
            if (item.el && item.el.parentNode) {
                item.el.parentNode.removeChild(item.el);
            }
            this._animations.delete(id);
        },

        /** 提前停止动画 */
        stop(id) {
            if (id) this._cleanup(id);
        },

        /** 销毁所有动画（场景切换时调用） */
        destroyAll() {
            const ids = Array.from(this._animations.keys());
            ids.forEach(id => this._cleanup(id));
            console.log('[LottieFx] 已清理所有动画，剩余:', this._animations.size);
        },

        /** CSS 回退动画（关键 Bug 规避：不依赖 lottie） */
        _fallback(type, x, y, opts) {
            const scale = (opts && opts.scale) || 1;
            const el = document.createElement('div');
            el.className = 'lottie-fx-fallback lottie-fx-' + type;
            el.style.cssText = `position:fixed;left:${x - 50*scale}px;top:${y - 50*scale}px;width:${100*scale}px;height:${100*scale}px;pointer-events:none;z-index:9000;`;
            document.body.appendChild(el);
            setTimeout(() => {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 1200);
        }
    };

    // ===== 挂载到 window =====
    window.Particle = Particle;
    window.ParticleSystem = ParticleSystem;
    window.FxEngine = FxEngine;
    window.BuildingFx = BuildingFx;
    window.BattleFx = BattleFx;
    window.EnemyFx = EnemyFx;
    window.SceneFx = SceneFx;
    window.UpgradeFx = UpgradeFx;
    window.UiFx = UiFx;
    window.DomFx = DomFx;
    window.LottieFx = LottieFx;

    // 注册到 FxEngine
    FxEngine.register('building', BuildingFx);
    FxEngine.register('battle', BattleFx);
    FxEngine.register('enemy', EnemyFx);
    FxEngine.register('upgrade', UpgradeFx);

    console.log('[effects-engine] 粒子特效引擎已加载');
})();
