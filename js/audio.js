/*
 * audio.js - 音效管理系统（阶段六）
 * 功能：基于 Web Audio API 程序合成全部音效与背景音乐，无需外部音频文件
 * 日期：2026-06-24
 *
 * 架构说明：
 *  - AudioManager 单例，单次初始化 AudioContext（用户首次交互后触发）
 *  - 三级音量控制：主音量 / BGM 音量 / 音效音量（gain 节点级联：master -> [sfx, bgm]）
 *  - 音效：振荡器 + 噪声 + 包络实时合成，零依赖、立即可用
 *  - BGM：lookahead 调度器循环播放音符序列，引用保存便于停止
 *
 * 关键点：
 *  1. AudioContext 必须在用户首次交互后创建/恢复（浏览器自动播放策略）
 *  2. 所有合成声音用 gain 包络（linearRamp/exponentialRamp）避免爆音
 *  3. BGM 调度器 setInterval 引用保存到 _bgmTimer，stopBGM 时 clearInterval
 *  4. 已调度的 BGM 音源保存到 _bgmSources，stopBGM 时逐一 stop 清理
 *  5. 音量设置持久化到 localStorage（键名 feiyi-guzhen-audio）
 *  6. playSound 在未初始化时静默降级，不抛错
 *
 * 依赖：
 *  - index.html 需在 effects-engine.js 之后引入本文件
 *  - 业务代码通过 window.AudioManager 调用
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'feiyi-guzhen-audio';

    // ===== 合成辅助函数 =====

    /**
     * 单音：振荡器 + ADSR 包络
     * @param {AudioContext} ctx
     * @param {AudioNode} out - 输出目标
     * @param {number} t - 开始时间（ctx.currentTime 相对）
     * @param {number} freq - 频率
     * @param {number} dur - 时长（秒）
     * @param {OscillatorType} type - 波形
     * @param {number} peak - 峰值音量
     * @param {AudioNode[]} [sink] - 可选，用于收集音源引用
     */
    function tone(ctx, out, t, freq, dur, type, peak, sink) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + dur + 0.05);
        if (sink) sink.push(osc, g);
        return osc;
    }

    /**
     * 频率扫描音：从 freqStart 到 freqEnd
     */
    function toneSweep(ctx, out, t, freqStart, freqEnd, dur, type, peak, sink) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + dur + 0.05);
        if (sink) sink.push(osc, g);
        return osc;
    }

    /**
     * 噪声：白噪声 + 滤波器 + 包络
     * @param {number} filterFreqEnd - 可选，滤波器频率扫描终点
     */
    function noise(ctx, out, t, dur, peak, filterType, filterFreq, filterFreqEnd, sink) {
        const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(filterFreq, t);
        if (filterFreqEnd) filter.frequency.linearRampToValueAtTime(Math.max(1, filterFreqEnd), t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(filter).connect(g).connect(out);
        src.start(t);
        src.stop(t + dur + 0.05);
        if (sink) sink.push(src, g);
        return src;
    }

    /**
     * 钟声：基频 + 2.76/5.4 倍谐波，长衰减
     */
    function bell(ctx, out, t, freq, dur, peak, sink) {
        tone(ctx, out, t, freq, dur, 'sine', peak, sink);
        tone(ctx, out, t, freq * 2.76, dur * 0.6, 'sine', peak * 0.5, sink);
        tone(ctx, out, t, freq * 5.4, dur * 0.3, 'sine', peak * 0.25, sink);
    }

    // ===== AudioManager 单例 =====
    const AudioManager = {
        audioContext: null,
        masterGain: null,
        sfxGain: null,
        bgmGain: null,
        masterVolume: 1.0,
        sfxVolume: 0.8,
        bgmVolume: 0.5,
        _initialized: false,
        _suspended: false,
        _currentBgm: null,
        _bgmTimer: null,
        _bgmNextTime: 0,
        _bgmStep: 0,
        _bgmSources: [],     // 已调度的 BGM 音源，stopBGM 时清理
        _pendingBgm: null,   // 未初始化时暂存的 BGM 名

        /**
         * 初始化 AudioContext（用户首次交互后触发）
         * 幂等：重复调用安全
         */
        init() {
            if (this._initialized) {
                // 已初始化，若处于 suspended 状态则尝试恢复
                if (this.audioContext && this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
                return true;
            }
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) {
                console.warn('[AudioManager] 当前浏览器不支持 Web Audio API，音效系统禁用');
                return false;
            }
            try {
                this.audioContext = new AC();
            } catch (e) {
                console.warn('[AudioManager] AudioContext 创建失败：', e);
                return false;
            }
            // 三级 gain 节点级联：master -> [sfx, bgm] -> destination
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = this.masterVolume;
            this.masterGain.connect(this.audioContext.destination);

            this.sfxGain = this.audioContext.createGain();
            this.sfxGain.gain.value = this.sfxVolume;
            this.sfxGain.connect(this.masterGain);

            this.bgmGain = this.audioContext.createGain();
            this.bgmGain.gain.value = this.bgmVolume;
            this.bgmGain.connect(this.masterGain);

            this._initialized = true;
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            // 播放暂存的 BGM
            if (this._pendingBgm) {
                const name = this._pendingBgm;
                this._pendingBgm = null;
                this.playBGM(name);
            }
            return true;
        },

        /**
         * 确保上下文可用（内部用）
         */
        _ensureContext() {
            if (!this._initialized || !this.audioContext) return false;
            if (this.audioContext.state === 'suspended') this.audioContext.resume();
            return true;
        },

        /**
         * 播放指定音效
         * @param {string} name - 音效名（见 _sfx 表）
         * @param {number} volume - 音量倍数（0~1），默认 1
         * @param {object} [opts] - 扩展参数，opts.heritageId 用于 tower-attack 区分非遗类型
         */
        playSound(name, volume = 1.0, opts) {
            if (!this._ensureContext()) return;
            const fn = this._sfx[name];
            if (!fn) {
                console.warn('[AudioManager] 未知音效：', name);
                return;
            }
            // tower-attack 按 heritageId 选择具体合成器
            if (name === 'tower-attack' && opts && opts.heritageId) {
                const specific = this._towerAttackSounds[opts.heritageId];
                if (specific) {
                    specific(this.audioContext, this.sfxGain, this.audioContext.currentTime, volume);
                    return;
                }
            }
            fn(this.audioContext, this.sfxGain, this.audioContext.currentTime, volume);
        },

        /**
         * 停止指定音效（合成型一次性音效无需主动停止，保留接口兼容）
         */
        stopSound(name) {
            // 合成型音效自动衰减结束，无需处理
        },

        /**
         * 设置主音量
         */
        setMasterVolume(v) {
            this.masterVolume = Math.max(0, Math.min(1, v));
            if (this.masterGain && this.audioContext) {
                this.masterGain.gain.setTargetAtTime(this.masterVolume, this.audioContext.currentTime, 0.01);
            }
            this._saveSettings();
        },

        /**
         * 设置音效音量
         */
        setSfxVolume(v) {
            this.sfxVolume = Math.max(0, Math.min(1, v));
            if (this.sfxGain && this.audioContext) {
                this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.audioContext.currentTime, 0.01);
            }
            this._saveSettings();
        },

        /**
         * 设置 BGM 音量
         */
        setBgmVolume(v) {
            this.bgmVolume = Math.max(0, Math.min(1, v));
            if (this.bgmGain && this.audioContext) {
                this.bgmGain.gain.setTargetAtTime(this.bgmVolume, this.audioContext.currentTime, 0.01);
            }
            this._saveSettings();
        },

        /**
         * 预加载音效（合成型无需加载，保留接口兼容）
         */
        loadSound(name, url) {
            // 合成型音效无需预加载，空实现
        },

        /**
         * 播放背景音乐
         * @param {string} name - BGM 名（bgm-management / bgm-battle / bgm-boss）
         * @param {boolean} loop - 是否循环（默认 true）
         */
        playBGM(name, loop = true) {
            if (!this._initialized) {
                // 未初始化：暂存，待首次交互后播放
                this._pendingBgm = loop ? name : null;
                return;
            }
            if (!this._ensureContext()) return;
            if (this._currentBgm === name) return;
            this.stopBGM();
            if (!this._bgmPatterns[name]) {
                console.warn('[AudioManager] 未知 BGM：', name);
                return;
            }
            this._currentBgm = name;
            this._bgmStep = 0;
            this._bgmNextTime = this.audioContext.currentTime + 0.1;
            // lookahead 调度：每 200ms 检查并提前调度下一小节
            this._bgmTimer = setInterval(() => this._scheduleBgm(), 200);
            this._scheduleBgm();
        },

        /**
         * BGM 调度器：提前调度未来 0.6s 内的音符
         */
        _scheduleBgm() {
            if (!this._currentBgm || !this.audioContext) return;
            const lookahead = 0.6;
            const pattern = this._bgmPatterns[this._currentBgm];
            const barDur = this._bgmBarDuration[this._currentBgm] || 1.6;
            while (this._bgmNextTime < this.audioContext.currentTime + lookahead) {
                pattern(this.audioContext, this.bgmGain, this._bgmNextTime, this._bgmStep, this._bgmSources);
                this._bgmNextTime += barDur;
                this._bgmStep++;
            }
        },

        /**
         * 停止背景音乐
         */
        stopBGM() {
            if (this._bgmTimer) {
                clearInterval(this._bgmTimer);
                this._bgmTimer = null;
            }
            // 停止已调度的音源
            const now = this.audioContext ? this.audioContext.currentTime : 0;
            this._bgmSources.forEach(node => {
                try {
                    if (node.stop) node.stop(now + 0.05);
                    else if (node.gain) node.gain.setTargetAtTime(0.0001, now, 0.02);
                } catch (e) { /* 已停止 */ }
            });
            this._bgmSources = [];
            this._currentBgm = null;
            this._pendingBgm = null;
        },

        /**
         * 暂停所有音效（挂起 AudioContext）
         */
        pauseAll() {
            if (!this._ensureContext()) return;
            this._suspended = true;
            this.audioContext.suspend();
        },

        /**
         * 恢复所有音效
         */
        resumeAll() {
            if (!this._ensureContext()) return;
            this._suspended = false;
            this.audioContext.resume();
        },

        /**
         * 持久化音量设置
         */
        _saveSettings() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    master: this.masterVolume,
                    sfx: this.sfxVolume,
                    bgm: this.bgmVolume
                }));
            } catch (e) { /* localStorage 不可用时静默 */ }
        },

        /**
         * 读取持久化音量设置
         */
        _loadSettings() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return;
                const s = JSON.parse(raw);
                if (typeof s.master === 'number') this.masterVolume = s.master;
                if (typeof s.sfx === 'number') this.sfxVolume = s.sfx;
                if (typeof s.bgm === 'number') this.bgmVolume = s.bgm;
            } catch (e) { /* 异常数据不导致崩溃 */ }
        },

        // ===== 音效合成表 =====
        // 每个函数签名：(ctx, out, t, volume) => void
        _sfx: {
            // UI 音效
            'button-click': (ctx, out, t, v) => {
                // 木鱼声：短促正弦 600Hz，快速衰减
                tone(ctx, out, t, 600, 0.08, 'sine', 0.3 * v);
            },
            'modal-open': (ctx, out, t, v) => {
                // 纸张翻动：带通滤波噪声，频率上升
                noise(ctx, out, t, 0.18, 0.15 * v, 'bandpass', 1200, 2400);
            },
            'modal-close': (ctx, out, t, v) => {
                // 纸张合上：带通滤波噪声，频率下降
                noise(ctx, out, t, 0.12, 0.12 * v, 'bandpass', 1000, 400);
            },
            'build-success': (ctx, out, t, v) => {
                // 铜钱叮当：两个高频金属音错峰
                tone(ctx, out, t, 1200, 0.12, 'triangle', 0.25 * v);
                tone(ctx, out, t + 0.06, 1600, 0.15, 'triangle', 0.2 * v);
            },
            'upgrade-success': (ctx, out, t, v) => {
                // 清脆钟声：基频 + 谐波，长衰减
                bell(ctx, out, t, 880, 0.6, 0.3 * v);
            },
            'collect-unlock': (ctx, out, t, v) => {
                // 风铃声：多个高频音错峰播放
                [1320, 1760, 2200, 2640].forEach((f, i) => {
                    tone(ctx, out, t + i * 0.08, f, 0.4, 'sine', 0.15 * v);
                });
            },

            // 战斗音效
            'enemy-hit': (ctx, out, t, v) => {
                // 沉闷打击：低频噪声短促
                noise(ctx, out, t, 0.08, 0.2 * v, 'lowpass', 300);
            },
            'enemy-death': (ctx, out, t, v) => {
                // 消散声：下降音 + 噪声
                toneSweep(ctx, out, t, 400, 100, 0.3, 'sawtooth', 0.2 * v);
                noise(ctx, out, t, 0.3, 0.1 * v, 'lowpass', 600);
            },
            'boss-appear': (ctx, out, t, v) => {
                // 低沉鼓声：低频正弦 60Hz + 90Hz，长衰减
                tone(ctx, out, t, 60, 0.8, 'sine', 0.5 * v);
                tone(ctx, out, t, 90, 0.6, 'sine', 0.3 * v);
                noise(ctx, out, t, 0.4, 0.15 * v, 'lowpass', 200);
            },
            'boss-death': (ctx, out, t, v) => {
                // 爆炸声：低频噪声 + 下降音
                noise(ctx, out, t, 0.5, 0.4 * v, 'lowpass', 200);
                toneSweep(ctx, out, t, 200, 50, 0.6, 'sawtooth', 0.3 * v);
            },
            'card-draw': (ctx, out, t, v) => {
                // 抽牌纸张翻动 + 轻微音
                noise(ctx, out, t, 0.15, 0.15 * v, 'bandpass', 1500, 1000);
                tone(ctx, out, t + 0.05, 800, 0.1, 'triangle', 0.1 * v);
            },
            'victory': (ctx, out, t, v) => {
                // 胜利锣鼓：多个鼓点 + 钟声
                [0, 0.15, 0.3, 0.45].forEach(d => tone(ctx, out, t + d, 80, 0.2, 'sine', 0.4 * v));
                bell(ctx, out, t + 0.5, 880, 0.8, 0.3 * v);
            },
            'defeat': (ctx, out, t, v) => {
                // 失败低沉弦乐：下降和弦
                toneSweep(ctx, out, t, 220, 110, 1.0, 'sawtooth', 0.25 * v);
                toneSweep(ctx, out, t + 0.1, 165, 82, 1.0, 'sawtooth', 0.2 * v);
            },

            // 阶段七：遗物音效
            'relic-select': (ctx, out, t, v) => {
                // 神秘风铃：上升音阶 + 高音点缀
                [880, 1108, 1318].forEach((f, i) => {
                    tone(ctx, out, t + i * 0.1, f, 0.35, 'sine', 0.18 * v);
                });
                tone(ctx, out, t + 0.3, 1760, 0.4, 'sine', 0.1 * v);
            },
            'relic-reward': (ctx, out, t, v) => {
                // 庄重钟声 + 上升和弦：获得遗物的神圣感
                bell(ctx, out, t, 523, 0.8, 0.25 * v);
                tone(ctx, out, t + 0.2, 659, 0.5, 'triangle', 0.18 * v);
                tone(ctx, out, t + 0.4, 784, 0.6, 'triangle', 0.15 * v);
                tone(ctx, out, t + 0.6, 1047, 0.7, 'sine', 0.12 * v);
            }
        },

        // ===== 塔攻击音效（按非遗 ID 区分）=====
        // 默认在 _towerAttackSounds.default
        _towerAttackSounds: {
            'paper-cut': (ctx, out, t, v) => {
                // 剪刀声：高频噪声短促双击
                noise(ctx, out, t, 0.05, 0.25 * v, 'highpass', 2500);
                noise(ctx, out, t + 0.04, 0.05, 0.2 * v, 'highpass', 2500);
            },
            'ceramics': (ctx, out, t, v) => {
                // 陶瓷碎裂：高频噪声 + 多个尖峰
                noise(ctx, out, t, 0.15, 0.3 * v, 'highpass', 1800);
                tone(ctx, out, t + 0.02, 2400, 0.08, 'square', 0.12 * v);
            },
            'shadow-play': (ctx, out, t, v) => {
                // 皮影：柔和扫频
                toneSweep(ctx, out, t, 500, 900, 0.15, 'sine', 0.2 * v);
            },
            'embroidery': (ctx, out, t, v) => {
                // 刺绣：轻柔短音
                tone(ctx, out, t, 1000, 0.1, 'sine', 0.18 * v);
            },
            'lion-dance': (ctx, out, t, v) => {
                // 舞狮：鼓声
                tone(ctx, out, t, 100, 0.15, 'sine', 0.35 * v);
                noise(ctx, out, t, 0.1, 0.15 * v, 'lowpass', 400);
            },
            'peking-opera': (ctx, out, t, v) => {
                // 京剧：金属音
                tone(ctx, out, t, 1320, 0.12, 'triangle', 0.22 * v);
                tone(ctx, out, t + 0.05, 1760, 0.1, 'triangle', 0.15 * v);
            },
            'martial-arts': (ctx, out, t, v) => {
                // 武术：拳风噪声
                noise(ctx, out, t, 0.1, 0.25 * v, 'bandpass', 600, 200);
            },
            'tea-art': (ctx, out, t, v) => {
                // 茶艺：柔和音
                tone(ctx, out, t, 660, 0.15, 'sine', 0.18 * v);
            },
            'four-treasures': (ctx, out, t, v) => {
                // 文房四宝：墨笔短促
                noise(ctx, out, t, 0.08, 0.18 * v, 'bandpass', 1200);
            },
            'cuisine': (ctx, out, t, v) => {
                // 美食：咕嘟声
                toneSweep(ctx, out, t, 300, 200, 0.12, 'sine', 0.2 * v);
            },
            'tcm': (ctx, out, t, v) => {
                // 中医：柔和铃音
                tone(ctx, out, t, 880, 0.12, 'sine', 0.18 * v);
            },
            'ultimate': (ctx, out, t, v) => {
                // 终极：强力和弦
                tone(ctx, out, t, 440, 0.2, 'sawtooth', 0.25 * v);
                tone(ctx, out, t, 660, 0.2, 'sawtooth', 0.2 * v);
                tone(ctx, out, t, 880, 0.2, 'sawtooth', 0.18 * v);
            },
            'default': (ctx, out, t, v) => {
                // 默认：短促 whoosh
                noise(ctx, out, t, 0.08, 0.2 * v, 'bandpass', 800);
            }
        },

        // ===== 环境音效 =====
        _ambientSounds: {
            // 雨声：持续低频白噪声
            'rain': (ctx, out, t, v) => {
                noise(ctx, out, t, 0.5, 0.08 * v, 'lowpass', 800);
            },
            // 风声：低频扫频噪声
            'wind': (ctx, out, t, v) => {
                noise(ctx, out, t, 0.6, 0.06 * v, 'lowpass', 400);
            },
            // 夜晚虫鸣：高频间歇音
            'night-insects': (ctx, out, t, v) => {
                tone(ctx, out, t, 4000, 0.05, 'sine', 0.04 * v);
                tone(ctx, out, t + 0.15, 4200, 0.05, 'sine', 0.03 * v);
            },
            // 集市喧闹：低频嘈杂
            'market-bustle': (ctx, out, t, v) => {
                noise(ctx, out, t, 0.3, 0.05 * v, 'bandpass', 500, 300);
                tone(ctx, out, t + 0.1, 200, 0.1, 'triangle', 0.03 * v);
            },
            // 篝火：噼啪声
            'campfire': (ctx, out, t, v) => {
                noise(ctx, out, t, 0.08, 0.06 * v, 'highpass', 1500);
                tone(ctx, out, t + 0.05, 150, 0.05, 'sine', 0.04 * v);
            }
        },

        // ===== BGM 调度表 =====
        // 每个函数签名：(ctx, out, t, step, sink) => void，调度一小节音符
        _bgmPatterns: {
            // 经营模式：古琴曲，五声音阶慢速旋律，舒缓
            'bgm-management': (ctx, out, t, step, sink) => {
                const scale = [261.63, 293.66, 329.63, 392.00, 440.00]; // C D E G A
                const melody = [0, 2, 1, 3, 2, 4, 3, 1];
                const noteDur = 0.4;
                for (let i = 0; i < 4; i++) {
                    const idx = melody[(step * 4 + i) % melody.length];
                    tone(ctx, out, t + i * noteDur, scale[idx], noteDur * 1.5, 'sine', 0.1, sink);
                }
                // 低音衬底
                tone(ctx, out, t, 130.81, 1.6, 'sine', 0.06, sink);
            },
            // 战斗模式：鼓乐，节奏鼓点，紧张
            'bgm-battle': (ctx, out, t, step, sink) => {
                for (let i = 0; i < 4; i++) {
                    tone(ctx, out, t + i * 0.4, 70, 0.2, 'sine', 0.25, sink);
                    if (i % 2 === 1) tone(ctx, out, t + i * 0.4 + 0.2, 120, 0.1, 'triangle', 0.12, sink);
                }
                // 偶尔的高音点缀
                if (step % 2 === 0) {
                    tone(ctx, out, t + 0.6, 523.25, 0.15, 'square', 0.06, sink);
                }
            },
            // BOSS 战：激昂民乐，快速鼓点 + 高音
            'bgm-boss': (ctx, out, t, step, sink) => {
                const scale = [329.63, 392.00, 440.00, 523.25];
                for (let i = 0; i < 4; i++) {
                    tone(ctx, out, t + i * 0.3, 80, 0.15, 'sine', 0.3, sink);
                    tone(ctx, out, t + i * 0.3, scale[(step + i) % scale.length], 0.25, 'sawtooth', 0.08, sink);
                }
                tone(ctx, out, t, 65, 1.2, 'sine', 0.15, sink);
            }
        },
        _bgmBarDuration: {
            'bgm-management': 1.6,
            'bgm-battle': 1.6,
            'bgm-boss': 1.2
        }
    };

    // 读取持久化音量
    AudioManager._loadSettings();

    // ===== 首次用户交互初始化 AudioContext =====
    function _onFirstInteraction() {
        AudioManager.init();
        document.removeEventListener('click', _onFirstInteraction);
        document.removeEventListener('touchstart', _onFirstInteraction);
        document.removeEventListener('keydown', _onFirstInteraction);
    }
    document.addEventListener('click', _onFirstInteraction);
    document.addEventListener('touchstart', _onFirstInteraction);
    document.addEventListener('keydown', _onFirstInteraction);

    // ===== 设置面板事件绑定（自包含，不侵入 management.js）=====
    function _bindSettingsPanel() {
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                if (window.UI) window.UI.showModal('settings-panel');
            });
        }
        // 三个音量滑块
        const sliders = [
            { id: 'vol-master', valId: 'vol-master-val', setter: (v) => AudioManager.setMasterVolume(v) },
            { id: 'vol-bgm', valId: 'vol-bgm-val', setter: (v) => AudioManager.setBgmVolume(v) },
            { id: 'vol-sfx', valId: 'vol-sfx-val', setter: (v) => AudioManager.setSfxVolume(v) }
        ];
        sliders.forEach(s => {
            const el = document.getElementById(s.id);
            const valEl = document.getElementById(s.valId);
            if (el) {
                // 初始化滑块值
                const map = { 'vol-master': 'master', 'vol-bgm': 'bgm', 'vol-sfx': 'sfx' };
                const key = map[s.id];
                const pct = Math.round(AudioManager[key + 'Volume'] * 100);
                el.value = pct;
                if (valEl) valEl.textContent = pct;
                el.addEventListener('input', () => {
                    const v = parseInt(el.value, 10) / 100;
                    if (valEl) valEl.textContent = el.value;
                    s.setter(v);
                    // 调节时试听
                    if (s.id !== 'vol-bgm') AudioManager.playSound('button-click', 0.6);
                });
            }
        });
    }

    // ===== 按钮点击音效（事件委托，自动覆盖所有按钮）=====
    // 匹配按钮类元素：button / [onclick] / .action-btn / .close-btn / 各类 tab / td 控件
    const BUTTON_SELECTOR = 'button, [onclick], .action-btn, .close-btn, .build-tab, .collection-tab, ' +
        '.td-draw-btn, .td-info-close, .td-info-upgrade-btn, .placement-cancel-btn, .tutorial-skip-btn, ' +
        '#td-pause-btn, #td-speed-btn, #td-exit-btn, #td-prep-start';
    function _bindButtonSounds() {
        document.addEventListener('click', (e) => {
            const target = e.target.closest(BUTTON_SELECTOR);
            if (target) AudioManager.playSound('button-click', 0.7);
        }, true);
    }
    // DOMContentLoaded 后绑定（本脚本在 body 底部，DOM 已就绪，但保险起见）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { _bindSettingsPanel(); _bindButtonSounds(); });
    } else {
        _bindSettingsPanel();
        _bindButtonSounds();
    }

    window.AudioManager = AudioManager;
})();
