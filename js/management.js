/*
 * management.js - 经营主界面逻辑（阶段二完善版）
 * 功能：建造系统、放置预览、工坊详情(升级/招募)、自动产出、装饰系统、新手引导
 * 日期：2026-06-23
 */

/** 阶段十：格式化成就奖励对象为文字描述 */
function _formatAchReward(reward) {
    if (!reward) return '';
    const parts = [];
    if (reward.coins) parts.push(`铜钱 ${reward.coins}`);
    if (reward.scrolls) parts.push(`卷轴 ${reward.scrolls}`);
    if (reward.inspiration) parts.push(`灵感 ${reward.inspiration}`);
    if (reward.relic === 'rare') parts.push('稀有遗物 1');
    if (reward.relic === 'legendary') parts.push('传说遗物 1');
    return parts.join('、');
}

class Management {
    constructor() {
        this.selectedTile = null;
        this.selectedIch = null;
        this.ichList = GameData.ICH_LIST;
        this.decorations = GameData.DECORATIONS;

        // 放置模式状态
        this.placementMode = null;   // null | 'building' | 'decoration'
        this.placementItem = null;   // 正在放置的建筑/装饰数据
        this.hoveredTile = null;     // 鼠标悬停的格子 {col, row}

        // 自动产出
        this.productionInterval = null;

        // 新手引导
        this.tutorialActive = false;
        this.tutorialStep = 0;

        // 事件监听器引用（便于卸载时移除）
        this._canvasMouseMoveHandler = null;
        this._originalRender = null;
        this._currentBuildTab = 'workshop';

        this.bindEvents();
    }

    /**
     * 初始化
     */
    init() {
        if (window.GameState && typeof window.GameState.load === 'function') {
            window.GameState.load();
        } else {
            console.warn('window.GameState.load 不可用，跳过加载');
        }

        // 设置渲染钩子（绘制装饰 + 放置预览）
        this._setupRenderHook();

        // 恢复存档中的建筑和装饰到地图
        this._restoreFromSave();

        // 初始化地图交互
        requestAnimationFrame(() => {
            this.initMap();
        });

        // 启动自动产出
        this.startProduction();

        // 绑定资源栏点击事件（显示资源来源/用途）
        this._bindResourceBarEvents();

        // 启动新手引导（tutorialStep < 6 表示未完成）
        const tutorialStep = window.GameState.tutorialStep || 0;
        if (tutorialStep < 6) {
            requestAnimationFrame(() => {
                setTimeout(() => this.startTutorial(), 500);
            });
        }

        // 阶段六：经营模式背景音乐（首次用户交互后自动播放）
        if (window.AudioManager) window.AudioManager.playBGM('bgm-management');

        // 阶段八：启动昼夜循环 + 天气系统
        if (window.DayNightCycle && typeof DayNightCycle.start === 'function') {
            DayNightCycle.start();
        }
        if (window.WeatherSystem && typeof WeatherSystem.start === 'function') {
            WeatherSystem.start();
        }

        // 阶段十：留存系统——绑定事件 + 初始化 + 角标更新
        this._bindRetentionEvents();
        if (window.DailyTasks && typeof DailyTasks.init === 'function') {
            try { DailyTasks.init(); } catch (e) { console.warn('DailyTasks init 失败:', e); }
        }
        if (window.Achievements && typeof Achievements.init === 'function') {
            try { Achievements.init(); } catch (e) { console.warn('Achievements init 失败:', e); }
        }
        if (window.Leaderboard && typeof Leaderboard.init === 'function') {
            try { Leaderboard.init(); } catch (e) { console.warn('Leaderboard init 失败:', e); }
        }
        if (window.GameState && typeof window.GameState.updateLoginStreak === 'function') {
            try { window.GameState.updateLoginStreak(); } catch (e) { /* ignore */ }
        }
        // 登录时检查登录类成就
        if (window.Achievements) {
            try { Achievements.checkAll(); } catch (e) { /* ignore */ }
        }
        // 首次角标刷新
        this.updateTaskBadge();
    }

    /**
     * 初始化地图点击/悬停事件
     */
    initMap() {
        const bindClick = () => {
            if (window.IsometricMap && typeof window.IsometricMap.getBuildings === 'function') {
                window.IsometricMap.onTileClick = this.handleTileClick.bind(this);
                this._bindCanvasMouseMove();
                console.log('地图点击事件绑定成功');
            } else {
                setTimeout(bindClick, 100);
            }
        };
        bindClick();
    }

    /**
     * 绑定 Canvas 鼠标移动事件（用于放置预览）
     */
    _bindCanvasMouseMove() {
        const canvas = window.IsometricMap.canvas;
        if (!canvas) return;
        this._canvasMouseMoveHandler = this._handleCanvasMouseMove.bind(this);
        canvas.addEventListener('mousemove', this._canvasMouseMoveHandler);
    }

    /**
     * 处理鼠标移动
     */
    _handleCanvasMouseMove(e) {
        if (!this.placementMode) {
            if (this.hoveredTile) {
                this.hoveredTile = null;
                window.IsometricMap.render();
            }
            return;
        }
        const rect = window.IsometricMap.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const tile = window.IsometricMap.screenToTile(sx, sy);
        if (tile) {
            this.hoveredTile = tile;
            window.IsometricMap.render();
        }
    }

    /**
     * 设置渲染钩子：在原 render 后叠加绘制装饰和放置预览
     */
    _setupRenderHook() {
        if (this._originalRender) return; // 避免重复包装
        this._originalRender = window.IsometricMap.render.bind(window.IsometricMap);
        const self = this;
        window.IsometricMap.render = function () {
            self._originalRender();
            self._drawDecorations();
            self._drawPlacementPreview();
            // 阶段五：在地图上绘制建筑常态粒子动画
            if (window.BuildingFx && window.IsometricMap.ctx) {
                window.BuildingFx.draw(window.IsometricMap.ctx);
            }
            // 阶段五：升级金光特效
            if (window.UpgradeFx && window.IsometricMap.ctx) {
                window.UpgradeFx.draw(window.IsometricMap.ctx);
            }
        };
        
        // UpgradeFx 动画循环（BuildingFx 有自己的内部循环，不重复）
        if (!this._upgradeFxLoop) {
            this._upgradeFxLoop = true;
            const upLoop = () => {
                if (window.UpgradeFx) window.UpgradeFx.update(1/60);
                this._upgradeFxId = requestAnimationFrame(upLoop);
            };
            this._upgradeFxId = requestAnimationFrame(upLoop);
        }
    }

    /**
     * 从存档恢复建筑和装饰到地图
     * 注意：存档加载后 grid 已有标记，需先重置 grid 再重新放置
     */
    _restoreFromSave() {
        // 强制重建 grid 为 16x16 数组（避免旧存档尺寸不匹配）
        window.GameState.grid = [];
        for (let i = 0; i < 16; i++) {
            window.GameState.grid[i] = [];
            for (let j = 0; j < 16; j++) {
                window.GameState.grid[i][j] = 'empty';
            }
        }

        // 确保 decorations 是数组
        if (!Array.isArray(window.GameState.decorations)) {
            window.GameState.decorations = [];
        }
        // 确保 workshops 是数组
        if (!Array.isArray(window.GameState.workshops)) {
            window.GameState.workshops = [];
        }

        // 恢复工坊
        window.GameState.workshops.forEach(ws => {
            const ichData = this.ichList.find(i => i.id === ws.id);
            if (!ichData) return;
            // 检查是否已在地图上（避免重复）
            const existing = window.IsometricMap.buildings.find(b => b.id === ws.id);
            if (existing) return;
            const ok = window.IsometricMap.placeBuilding(ichData, ws.gridX, ws.gridY);
            if (ok) {
                // 同步等级和传承人状态到地图建筑对象
                const b = window.IsometricMap.getBuildingAt(ws.gridX, ws.gridY);
                if (b) {
                    b.level = ws.level || 1;
                    b.hasMaster = ws.hasMaster || false;
                    // 阶段五：为已存档建筑注册常态粒子动画
                    if (window.BuildingFx) {
                        window.BuildingFx.register(ws.id, b.gridX, b.gridY, b.width, b.height, ws.id);
                    }
                }
            }
        });

        // 阶段五：启动建筑常态动画循环
        if (window.BuildingFx) {
            window.BuildingFx.start();
        }

        // 恢复装饰（标记格子，数据已在 window.GameState.decorations）
        window.GameState.decorations.forEach(d => {
            if (d.gridX < 16 && d.gridY < 16) {
                window.GameState.grid[d.gridX][d.gridY] = 'decoration';
            }
        });

        window.IsometricMap.render();
    }

    /**
     * 绘制装饰物到地图（#3 画风统一：使用 PNG 图片替代 emoji）
     */
    _drawDecorations() {
        const ctx = window.IsometricMap.ctx;
        if (!ctx) return;
        if (!Array.isArray(window.GameState.decorations)) return;
        // 确保装饰物纹理已加载
        if (window.IsometricMap && typeof window.IsometricMap._loadDecorations === 'function') {
            window.IsometricMap._loadDecorations();
        }
        const textures = window.IsometricMap._decoTextures || {};
        // 装饰物 ID → 纹理 key 映射（灯笼 ID 为 lantern，纹理 key 为 red-lantern）
        const texKeyMap = { 'lantern': 'red-lantern' };

        window.GameState.decorations.forEach(d => {
            const decorData = this.decorations.find(dd => dd.id === d.id);
            if (!decorData) return;
            const { x, y } = window.IsometricMap.tileToScreen(d.gridX, d.gridY);
            const texKey = texKeyMap[d.id] || d.id;
            const tex = textures[texKey];
            const halfW = window.IsometricMap.TILE_WIDTH / 2;
            const halfH = window.IsometricMap.TILE_HEIGHT / 2;

            ctx.save();
            // 装饰底座（菱形半透明金色）
            ctx.fillStyle = 'rgba(212, 168, 77, 0.3)';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + halfW, y - halfH);
            ctx.lineTo(x, y - window.IsometricMap.TILE_HEIGHT);
            ctx.lineTo(x - halfW, y - halfH);
            ctx.closePath();
            ctx.fill();

            // #3 画风统一：优先使用 PNG 纹理，回退到 emoji
            if (tex && tex.complete && tex.naturalWidth > 0) {
                const drawW = window.IsometricMap.TILE_WIDTH * 0.9;
                const drawH = drawW * (tex.height / tex.width);
                const drawX = x - drawW / 2;
                const drawY = y - drawH + halfH;
                // 投影
                ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.filter = 'blur(2px)';
                ctx.beginPath();
                ctx.ellipse(x, y, drawW * 0.3, drawW * 0.15, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.filter = 'none';
                // 绘制图片
                ctx.drawImage(tex, drawX, drawY, drawW, drawH);
            } else {
                // 回退：emoji 文字
                ctx.font = '28px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(decorData.emoji, x, y - halfH - 10);
            }
            ctx.restore();
        });
    }

    /**
     * 绘制放置预览（绿色可放置/红色不可放置）
     */
    _drawPlacementPreview() {
        if (!this.placementMode || !this.hoveredTile || !this.placementItem) return;
        const ctx = window.IsometricMap.ctx;
        if (!ctx) return;

        const { col, row } = this.hoveredTile;
        const width = this.placementItem.width || 1;
        const height = this.placementItem.height || 1;
        const canPlace = window.IsometricMap.canPlaceBuilding(col, row, width, height);
        const color = canPlace ? 'rgba(34, 139, 34, 0.5)' : 'rgba(220, 20, 60, 0.5)';
        const borderColor = canPlace ? 'rgba(34, 139, 34, 0.9)' : 'rgba(220, 20, 60, 0.9)';

        ctx.save();
        for (let i = 0; i < width; i++) {
            for (let j = 0; j < height; j++) {
                const { x, y } = window.IsometricMap.tileToScreen(col + i, row + j);
                const halfW = window.IsometricMap.TILE_WIDTH / 2;
                const halfH = window.IsometricMap.TILE_HEIGHT / 2;
                ctx.fillStyle = color;
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = 2;
                // 修复：与 drawGrid 保持一致，以 (x,y) 为菱形中心绘制
                ctx.beginPath();
                ctx.moveTo(x, y - halfH);
                ctx.lineTo(x + halfW, y);
                ctx.lineTo(x, y + halfH);
                ctx.lineTo(x - halfW, y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    /**
     * 绑定底部按钮事件
     */
    bindEvents() {
        const buildBtn = document.getElementById('build-btn');
        const stageBtn = document.getElementById('stage-btn');
        const collectionBtn = document.getElementById('collection-btn');

        if (buildBtn) {
            buildBtn.addEventListener('click', () => {
                this.selectedTile = null;
                this.selectedIch = null;
                this.showBuildPanel();
                // 引导：步骤4 点击建造按钮
                if (this.tutorialActive && this.tutorialStep === 4) {
                    this._advanceTutorial();
                }
            });
        }

        if (stageBtn) {
            stageBtn.addEventListener('click', () => {
                // 阶段三：进入塔防关卡选择界面
                if (window.TowerDefense && typeof window.TowerDefense.showLevelSelect === 'function') {
                    window.TowerDefense.showLevelSelect();
                } else {
                    UI.showToast('塔防系统加载中…', 2000, 'info');
                }
            });
        }

        if (collectionBtn) {
            collectionBtn.addEventListener('click', () => {
                this.showCollectionPanel();
            });
        }
    }

    /**
     * 绑定资源栏点击事件（点击资源项显示来源/用途 tooltip）
     */
    _bindResourceBarEvents() {
        const resourceMap = [
            { id: 'coins-value', type: 'coins' },
            { id: 'inspiration-value', type: 'inspiration' },
            { id: 'scrolls-value', type: 'scrolls' },
            { id: 'popularity-value', type: 'popularity' }
        ];
        resourceMap.forEach(({ id, type }) => {
            const valueEl = document.getElementById(id);
            if (!valueEl) return;
            // 绑定到整个 resource-item，点击图标/标签/数值均可触发
            const item = valueEl.closest('.resource-item') || valueEl;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                UI.showResourceInfo(type, item);
            });
        });
    }

    /**
     * 处理地图瓦片点击
     */
    handleTileClick(col, row) {
        // 放置模式：点击确认放置
        if (this.placementMode) {
            this._confirmPlacement(col, row);
            return;
        }

        const building = window.IsometricMap.getBuildingAt(col, row);
        if (building) {
            this.showWorkshopDetail(building);
            // 引导：步骤3 点击已建工坊 → 推进到步骤4
            if (this.tutorialActive && this.tutorialStep === 3) {
                this._advanceTutorial();
            }
        } else {
            // 检查是否点击了装饰
            const decor = window.GameState.decorations.find(d => d.gridX === col && d.gridY === row);
            if (decor) {
                this.showDecorationDetail(decor);
            } else if (window.IsometricMap && window.IsometricMap.hasEdgeDecoration(col, row)) {
                // 新增：点击边缘天然障碍物 → 弹出拆除面板
                this._showRemoveObstaclePanel(col, row);
            } else {
                this.selectedTile = { col, row };
                this.showBuildPanel();
                // 引导：步骤0 点击空地
                if (this.tutorialActive && this.tutorialStep === 0) {
                    this._advanceTutorial();
                }
            }
        }
    }

    // ===== 建造面板 =====

    /**
     * 切换建造面板标签页
     */
    static switchBuildTab(tab) {
        if (window._managementInstance) {
            window._managementInstance._switchBuildTab(tab);
        }
    }

    _switchBuildTab(tab) {
        this._currentBuildTab = tab;
        document.querySelectorAll('.build-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });
        const buildGrid = document.getElementById('build-grid');
        const decorGrid = document.getElementById('decoration-grid');
        if (tab === 'workshop') {
            if (buildGrid) buildGrid.classList.remove('hidden');
            if (decorGrid) decorGrid.classList.add('hidden');
        } else {
            if (buildGrid) buildGrid.classList.add('hidden');
            if (decorGrid) decorGrid.classList.remove('hidden');
        }
    }

    /**
     * 显示建造面板
     */
    showBuildPanel() {
        const buildPanel = document.getElementById('build-panel');
        if (!buildPanel) return;
        this._renderWorkshopCards();
        this._renderDecorationCards();
        UI.showModal('build-panel');
    }

    /**
     * 渲染工坊卡片
     */
    _renderWorkshopCards() {
        const buildGrid = document.getElementById('build-grid');
        if (!buildGrid) return;
        buildGrid.innerHTML = '';

        // 安全获取 GameState 属性
        const gs = window.GameState || {};
        const unlockedLevels = gs.unlockedLevels || [1];
        const currentCoins = gs.coins || 0;
        const currentWorkshops = (window.IsometricMap && typeof window.IsometricMap.getBuildings === 'function')
            ? window.IsometricMap.getBuildings().map(w => w.id) : [];

        this.ichList.forEach(ich => {
            const isUnlocked = unlockedLevels.includes(ich.unlockLevel);
            const isBuilt = currentWorkshops.includes(ich.id);
            const canAfford = currentCoins >= ich.buildCost;
            const clickable = isUnlocked && !isBuilt && canAfford;

            const card = document.createElement('div');
            card.className = `building-card ${!clickable ? 'locked' : ''}`;
            // 阶段九：稀有度边框（4-5星工坊高亮）
            if (ich.rarity >= 4) card.setAttribute('data-rarity', ich.rarity);

            if (clickable) {
                card.addEventListener('click', () => {
                    this._startPlacement('building', ich);
                    // 引导：选择工坊
                    if (this.tutorialActive && this.tutorialStep === 1) {
                        this._advanceTutorial();
                    }
                });
            }

            card.innerHTML = `
                <div class="building-card__emoji">${ich.emoji}</div>
                <div class="building-card__name">${ich.name}</div>
                <div class="building-card__cost"><span>💰 ${ich.buildCost}</span></div>
                <div class="building-card__size">占地 ${ich.width}×${ich.height}</div>
                ${!isUnlocked ? `<div style="color: var(--color-danger); text-align: center; font-size: 12px; margin-top: 8px;">解锁第${ich.unlockLevel}关</div>` : ''}
                ${isBuilt ? `<div style="color: var(--color-success); text-align: center; font-size: 12px; margin-top: 8px;">已建造</div>` : ''}
                ${!canAfford && isUnlocked && !isBuilt ? `<div style="color: var(--color-danger); text-align: center; font-size: 12px; margin-top: 8px;">铜钱不足</div>` : ''}
            `;
            buildGrid.appendChild(card);
        });
    }

    /**
     * 渲染装饰卡片
     */
    _renderDecorationCards() {
        const decorGrid = document.getElementById('decoration-grid');
        if (!decorGrid) return;
        decorGrid.innerHTML = '';

        // #3 装饰画风统一：卡片图标使用 PNG 图片，回退 emoji
        const texKeyMap = { 'lantern': 'red-lantern' };
        const newDecoIds = ['stone-bridge', 'wooden-pavilion', 'stone-lion', 'red-lantern'];

        this.decorations.forEach(decor => {
            const canAfford = window.GameState.coins >= decor.cost;
            const card = document.createElement('div');
            card.className = `decoration-card ${!canAfford ? 'locked' : ''}`;

            if (canAfford) {
                card.addEventListener('click', () => {
                    this._startPlacement('decoration', decor);
                });
            }

            const texKey = texKeyMap[decor.id] || decor.id;
            const ext = newDecoIds.includes(texKey) ? 'jpg' : 'png';
            const ver = newDecoIds.includes(texKey) ? '74' : '67';
            const imgSrc = `assets/images/decorations/${texKey}.${ext}?v=${ver}`;

            card.innerHTML = `
                <div class="decoration-card__emoji">
                    <img src="${imgSrc}" alt="${decor.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
                    <span style="display:none;font-size:28px">${decor.emoji}</span>
                </div>
                <div class="decoration-card__name">${decor.name}</div>
                <div class="decoration-card__info">
                    💰 ${decor.cost}<br>
                    <span class="bonus">加成 +${decor.bonus}%</span><br>
                    影响范围 ${decor.range}格
                </div>
            `;
            decorGrid.appendChild(card);
        });
    }

    // ===== 放置模式 =====

    /**
     * 进入放置模式
     */
    _startPlacement(mode, item) {
        this.placementMode = mode;
        this.placementItem = item;
        UI.closeModal('build-panel');

        const hint = document.getElementById('placement-hint');
        const hintText = document.getElementById('placement-hint-text');
        if (hint && hintText) {
            const sizeStr = mode === 'building' ? `${item.width}×${item.height}` : '1×1';
            hintText.textContent = `放置「${item.name}」(${sizeStr}) — 绿色可放置，红色不可放置，ESC取消`;
            hint.classList.remove('hidden');
        }

        // 绑定ESC取消
        this._escHandler = (e) => {
            if (e.key === 'Escape') {
                this._cancelPlacement();
                document.removeEventListener('keydown', this._escHandler);
                this._escHandler = null;
            }
        };
        document.addEventListener('keydown', this._escHandler);

        // 立即渲染一次，显示预览
        window.IsometricMap.render();
        console.log('进入放置模式:', mode, item.name);
    }

    /**
     * 取消放置模式
     */
    static cancelPlacement() {
        if (window._managementInstance) {
            window._managementInstance._cancelPlacement();
        }
    }

    _cancelPlacement() {
        this.placementMode = null;
        this.placementItem = null;
        this.hoveredTile = null;
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        const hint = document.getElementById('placement-hint');
        if (hint) hint.classList.add('hidden');
        window.IsometricMap.render();
        console.log('退出放置模式');
    }

    /**
     * 确认放置
     */
    _confirmPlacement(col, row) {
        if (!this.placementItem) return;

        if (this.placementMode === 'building') {
            this._placeBuilding(this.placementItem, col, row);
        } else if (this.placementMode === 'decoration') {
            this._placeDecoration(this.placementItem, col, row);
        }
    }

    /**
     * 放置建筑
     */
    _placeBuilding(ich, col, row) {
        if (!window.IsometricMap.canPlaceBuilding(col, row, ich.width, ich.height)) {
            UI.showToast('该位置无法放置建筑', 2000, 'error');
            return;
        }
        if (window.GameState.coins < ich.buildCost) {
            UI.showToast('铜钱不足', 2000, 'error');
            return;
        }

        window.GameState.addCoins(-ich.buildCost);
        const success = window.IsometricMap.placeBuilding(ich, col, row);

        if (success) {
            // 检查是否首次建造该类型（在解锁前检查）
            const isFirstTime = !window.GameState.isCollectionUnlocked('ich', ich.id);

            // 保存工坊数据（先展开旧数据再覆盖，避免字段丢失）
            window.GameState.saveWorkshop({
                id: ich.id,
                gridX: col,
                gridY: row,
                level: 1,
                hasMaster: false
            });
            window.GameState.unlockCollection('ich', ich.id);

            // 阶段五：注册建筑常态粒子动画并启动循环
            if (window.BuildingFx) {
                const b = window.IsometricMap.getBuildingAt(col, row);
                if (b) {
                    window.BuildingFx.register(ich.id, b.gridX, b.gridY, b.width, b.height, ich.id);
                }
                window.BuildingFx.start();
            }

            // 阶段八：Lottie 建筑放置动画（失败回退 CSS 金光环）
            if (window.LottieFx && window.IsometricMap?.tileToScreen) {
                const cx = col + (ich.width || 1) / 2;
                const cy = row + (ich.height || 1) / 2;
                const s = window.IsometricMap.tileToScreen(cx, cy);
                window.LottieFx.play('building-place', s.x, s.y, { scale: 0.8, timeout: 2000 });
            }

            UI.showToast(`成功建造 ${ich.name}`, 2000, 'success');

            // 阶段六：建造成功音效
            if (window.AudioManager) window.AudioManager.playSound('build-success');

            // 首次建造该类型，弹出图鉴解锁动画
            if (isFirstTime) {
                this._triggerUnlockAnimation('ich', ich.id);
            }

            // 阶段十：留存系统——建造上报
            if (window.DailyTasks) {
                try { DailyTasks.updateProgress('build-workshop', 1); } catch (e) { /* ignore */ }
            }
            if (window.Achievements) {
                try { Achievements.checkAll(); } catch (e) { /* ignore */ }
            }

            this._cancelPlacement();

            // 引导：放置工坊
            if (this.tutorialActive && this.tutorialStep === 2) {
                this._advanceTutorial();
            }
        } else {
            UI.showToast('建造失败', 2000, 'error');
            // 退还铜钱
            window.GameState.addCoins(ich.buildCost);
        }
    }

    /**
     * 首次建造弹出图鉴介绍
     */
    _showIchIntroduction(ich) {
        const content = document.getElementById('collection-content');
        if (!content) return;
        content.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <span style="font-size: 72px;">${ich.emoji}</span>
            </div>
            <h3 style="color: var(--color-gold-light); text-align: center; margin-bottom: 12px; font-family: 'Ma Shan Zheng', cursive; font-size: 28px;">${ich.name}</h3>
            <div class="workshop-info" style="text-align: center; color: var(--color-text-secondary); margin-bottom: 16px;">${ich.region} · ${ich.hour}</div>
            <div class="workshop-info" style="padding: 12px; background: rgba(212, 168, 77, 0.1); border-radius: 8px; margin-bottom: 16px;">
                ${ich.description}
            </div>
            <div class="workshop-info" style="color: var(--color-text-secondary); font-style: italic; padding: 12px; background: rgba(212, 168, 77, 0.05); border-radius: 8px;">
                「${ich.lore}」
            </div>
        `;
        UI.showModal('collection-panel');
    }

    /**
     * 放置装饰
     */
    _placeDecoration(decor, col, row) {
        // 修复：补全下界检查 + 边缘装饰物检测 + 解锁范围
        const unlocked = window.IsometricMap ? window.IsometricMap.getUnlockedSize() : 16;
        if (col < 0 || row < 0 || col >= unlocked || row >= unlocked) {
            UI.showToast('超出地图边界', 2000, 'error');
            return;
        }
        if (window.GameState.grid[col][row] !== 'empty') {
            UI.showToast('该位置已被占用', 2000, 'error');
            return;
        }
        // 修复：不允许在边缘随机装饰物上放置
        if (window.IsometricMap && window.IsometricMap.hasEdgeDecoration(col, row)) {
            UI.showToast('该位置有天然障碍物，无法放置', 2000, 'error');
            return;
        }
        if (window.GameState.coins < decor.cost) {
            UI.showToast('铜钱不足', 2000, 'error');
            return;
        }

        window.GameState.addCoins(-decor.cost);
        window.GameState.grid[col][row] = 'decoration';
        window.GameState.decorations.push({
            id: decor.id,
            gridX: col,
            gridY: row
        });
        window.GameState.save();

        // 阶段四：首次购买装饰时解锁物质文化遗产图鉴
        const isFirstMaterial = !window.GameState.isCollectionUnlocked('material', decor.id);
        window.GameState.unlockCollection('material', decor.id);
        if (isFirstMaterial) {
            this._triggerUnlockAnimation('material', decor.id);
        }

        UI.showToast(`成功放置 ${decor.name}`, 2000, 'success');
        this._cancelPlacement();
        window.IsometricMap.render();
    }

    // ===== 工坊详情面板 =====

    /**
     * 显示工坊详情
     */
    showWorkshopDetail(building) {
        const panel = document.getElementById('workshop-detail');
        const title = document.getElementById('workshop-title');
        const content = document.getElementById('workshop-content');
        if (!panel || !title || !content) return;

        const ichData = this.ichList.find(i => i.id === building.id);
        const workshop = window.GameState.getWorkshopById(building.id);
        const level = workshop?.level || 1;
        const hasMaster = workshop?.hasMaster || false;
        const baseOutput = ichData?.baseOutput || 0;
        const decorBonus = this._getDecorationBonus(building.gridX, building.gridY);
        const currentOutput = Math.floor(baseOutput * (1 + (level - 1) * 0.2 + (hasMaster ? 0.5 : 0) + decorBonus));

        title.textContent = ichData?.name || '工坊详情';

        // 升级费用
        const upgradeIndex = level - 1;
        const upgradeCost = ichData?.upgradeCosts?.[upgradeIndex];
        const maxLevel = (ichData?.upgradeCosts?.length || 0) + 1;
        const canUpgrade = upgradeCost && level < maxLevel;
        const canAffordUpgrade = canUpgrade && window.GameState.coins >= upgradeCost.coins && window.GameState.scrolls >= upgradeCost.scrolls;

        // 招募传承人
        const masterCost = ichData?.masterCost || 0;
        const canRecruit = !hasMaster && window.GameState.inspiration >= masterCost;

        content.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <span style="font-size: 64px;">${ichData?.emoji || '🏠'}</span>
            </div>
            <div class="workshop-info"><strong>产地：</strong>${ichData?.region || '未知'}</div>
            <div class="workshop-info"><strong>时辰：</strong>${ichData?.hour || '未知'}</div>
            <div class="workshop-info"><strong>等级：</strong>Lv.${level} ${level >= maxLevel ? '(满级)' : ''}</div>
            <div class="workshop-info"><strong>基础产出：</strong><span class="output-value">${baseOutput}</span> 铜钱/3秒</div>
            <div class="workshop-info"><strong>当前产出：</strong><span class="output-value">${currentOutput}</span> 铜钱/3秒
                <span style="color: var(--color-text-secondary); font-size: 13px;">
                    (等级+${Math.round((level - 1) * 0.2 * 100)}% · 传承人+${hasMaster ? 50 : 0}% · 装饰+${Math.round(decorBonus * 100)}%)
                </span>
            </div>
            <div class="workshop-info"><strong>传承人：</strong>
                <span class="workshop-master-badge ${hasMaster ? '' : 'absent'}">${hasMaster ? '已招募' : '未招募'}</span>
            </div>
            <div class="workshop-info" style="color: var(--color-text-secondary); font-size: 14px; padding: 12px; background: rgba(212, 168, 77, 0.1); border-radius: 8px; margin-bottom: 20px;">
                ${ichData?.description || '暂无描述'}
            </div>

            ${canUpgrade ? `
                <button class="workshop-action-btn upgrade ${!canAffordUpgrade ? 'disabled' : ''}"
                    onclick="Management.upgradeWorkshop('${building.id}')" ${!canAffordUpgrade ? 'disabled' : ''}>
                    升级到 Lv.${level + 1}
                    <span class="cost-info">💰 ${upgradeCost.coins} · 📜 ${upgradeCost.scrolls}</span>
                </button>
            ` : `
                <button class="workshop-action-btn disabled" disabled>已达最高等级</button>
            `}

            <button class="workshop-action-btn recruit ${hasMaster ? 'recruited' : ''} ${!hasMaster && !canRecruit ? 'disabled' : ''}"
                onclick="Management.recruitMaster('${building.id}')" ${hasMaster || !canRecruit ? 'disabled' : ''}>
                ${hasMaster ? '传承人已招募' : '招募传承人'}
                ${!hasMaster ? `<span class="cost-info">✨ ${masterCost} 灵感</span>` : ''}
            </button>

            <button class="workshop-action-btn" style="background-color: var(--color-danger); border-color: #C41E3A;"
                onclick="Management.removeWorkshop('${building.id}')">
                拆除工坊（返还50%铜钱）
            </button>
        `;

        UI.showModal('workshop-detail');
    }

    /**
     * 升级工坊
     */
    static upgradeWorkshop(workshopId) {
        if (window._managementInstance) {
            window._managementInstance._upgradeWorkshop(workshopId);
        }
    }

    _upgradeWorkshop(workshopId) {
        const ichData = this.ichList.find(i => i.id === workshopId);
        const workshop = window.GameState.getWorkshopById(workshopId);
        if (!ichData || !workshop) return;

        const level = workshop.level || 1;
        const upgradeIndex = level - 1;
        const upgradeCost = ichData.upgradeCosts?.[upgradeIndex];
        if (!upgradeCost) {
            UI.showToast('已达最高等级', 2000, 'info');
            return;
        }
        if (window.GameState.coins < upgradeCost.coins || window.GameState.scrolls < upgradeCost.scrolls) {
            UI.showToast('资源不足，无法升级', 2000, 'error');
            return;
        }

        window.GameState.addCoins(-upgradeCost.coins);
        window.GameState.addScrolls(-upgradeCost.scrolls);

        // 保存工坊（先展开旧数据再覆盖）
        window.GameState.saveWorkshop({
            id: workshopId,
            level: level + 1
        });

        // 同步地图建筑等级
        const building = window.IsometricMap.buildings.find(b => b.id === workshopId);
        if (building) {
            building.level = level + 1;
        }

        // 升级动画
        const panel = document.getElementById('workshop-detail');
        if (panel) {
            panel.classList.add('upgrading');
            setTimeout(() => panel.classList.remove('upgrading'), 1000);
        }

        // 阶段五：升级金光特效（从建筑中心向上扩散）
        if (window.UpgradeFx && building && window.IsometricMap?.tileToScreen) {
            const cx = building.gridX + (building.width || 1) / 2;
            const cy = building.gridY + (building.height || 1) / 2;
            const s = window.IsometricMap.tileToScreen(cx, cy);
            window.UpgradeFx.play(s.x, s.y - 15);

            // 阶段八：Lottie 升级动画（失败回退 CSS 金星）
            if (window.LottieFx) {
                window.LottieFx.play('upgrade', s.x, s.y - 30, { scale: 1.0, timeout: 2500 });
            }
        }

        UI.showToast(`${ichData.name} 升级到 Lv.${level + 1}！`, 2000, 'success');

        // 阶段六：升级成功音效
        if (window.AudioManager) window.AudioManager.playSound('upgrade-success');

        // 阶段十：留存系统——升级工坊上报
        if (window.DailyTasks) {
            try { DailyTasks.updateProgress('upgrade-workshop', 1); } catch (e) { /* ignore */ }
        }
        if (window.Achievements) {
            try { Achievements.checkAll(); } catch (e) { /* ignore */ }
        }

        // 刷新详情面板
        if (building) {
            this.showWorkshopDetail(building);
        }
    }

    /**
     * 招募传承人
     */
    static recruitMaster(workshopId) {
        if (window._managementInstance) {
            window._managementInstance._recruitMaster(workshopId);
        }
    }

    _recruitMaster(workshopId) {
        const ichData = this.ichList.find(i => i.id === workshopId);
        const workshop = window.GameState.getWorkshopById(workshopId);
        if (!ichData || !workshop) return;
        if (workshop.hasMaster) {
            UI.showToast('已招募传承人', 2000, 'info');
            return;
        }
        const masterCost = ichData.masterCost || 0;
        if (window.GameState.inspiration < masterCost) {
            UI.showToast('灵感不足', 2000, 'error');
            return;
        }

        window.GameState.addInspiration(-masterCost);
        window.GameState.saveWorkshop({
            id: workshopId,
            hasMaster: true
        });

        // 同步地图建筑状态
        const building = window.IsometricMap.buildings.find(b => b.id === workshopId);
        if (building) {
            building.hasMaster = true;
        }

        // 阶段五：招募传承人金色粒子特效
        if (window.UpgradeFx && building && window.IsometricMap?.tileToScreen) {
            const cx = building.gridX + (building.width || 1) / 2;
            const cy = building.gridY + (building.height || 1) / 2;
            const s = window.IsometricMap.tileToScreen(cx, cy);
            window.UpgradeFx.play(s.x, s.y - 15);
        }

        UI.showToast(`成功招募 ${ichData.name} 传承人！产出+50%`, 2000, 'success');

        // 阶段十：留存系统——招募传承人上报
        if (window.DailyTasks) {
            try { DailyTasks.updateProgress('recruit-master', 1); } catch (e) { /* ignore */ }
        }
        if (window.Achievements) {
            try { Achievements.checkAll(); } catch (e) { /* ignore */ }
        }

        // 刷新详情面板
        if (building) {
            this.showWorkshopDetail(building);
        }
    }

    /**
     * 拆除工坊
     */
    static removeWorkshop(workshopId) {
        if (window._managementInstance) {
            window._managementInstance._removeWorkshop(workshopId);
        }
    }

    _removeWorkshop(workshopId) {
        const building = window.IsometricMap.buildings.find(b => b.id === workshopId);
        const ichData = this.ichList.find(i => i.id === workshopId);
        if (!building) return;

        // 返还50%建造费用
        if (ichData) {
            const refund = Math.floor(ichData.buildCost * 0.5);
            window.GameState.addCoins(refund);
        }

        // 从 window.GameState.workshops 移除
        const wsIndex = window.GameState.workshops.findIndex(w => w.id === workshopId);
        if (wsIndex !== -1) {
            window.GameState.workshops.splice(wsIndex, 1);
            window.GameState.save();
        }

        // 阶段五：注销建筑常态粒子动画
        if (window.BuildingFx) {
            window.BuildingFx.unregister(workshopId);
        }

        window.IsometricMap.removeBuilding(workshopId);
        UI.closeModal('workshop-detail');
        UI.showToast('工坊已拆除，返还50%铜钱', 2000, 'info');
    }

    // ===== 装饰详情 =====

    /**
     * 显示装饰详情
     */
    showDecorationDetail(decor) {
        const panel = document.getElementById('decoration-detail');
        const title = document.getElementById('decoration-detail-title');
        const content = document.getElementById('decoration-detail-content');
        if (!panel || !title || !content) return;

        const decorData = this.decorations.find(d => d.id === decor.id);
        if (!decorData) return;

        title.textContent = decorData.name;
        const refund = Math.floor(decorData.cost * 0.5);

        content.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <span style="font-size: 64px;">${decorData.emoji}</span>
            </div>
            <div class="decoration-info"><strong>名称：</strong>${decorData.name}</div>
            <div class="decoration-info"><strong>建造费用：</strong>💰 ${decorData.cost}</div>
            <div class="decoration-info"><strong>产出加成：</strong><span style="color: var(--color-success);">+${decorData.bonus}%</span></div>
            <div class="decoration-info"><strong>影响范围：</strong>${decorData.range} 格</div>
            <div class="decoration-info"><strong>位置：</strong>(${decor.gridX}, ${decor.gridY})</div>
            <button class="decoration-recycle-btn" onclick="Management.recycleDecoration('${decor.id}', ${decor.gridX}, ${decor.gridY})">
                回收装饰（返还 ${refund} 铜钱）
            </button>
        `;

        UI.showModal('decoration-detail');
    }

    /**
     * 回收装饰
     */
    static recycleDecoration(decorId, gridX, gridY) {
        if (window._managementInstance) {
            window._managementInstance._recycleDecoration(decorId, gridX, gridY);
        }
    }

    _recycleDecoration(decorId, gridX, gridY) {
        const decorData = this.decorations.find(d => d.id === decorId);
        if (!decorData) return;

        const refund = Math.floor(decorData.cost * 0.5);
        window.GameState.addCoins(refund);

        // 从 window.GameState.decorations 移除
        const idx = window.GameState.decorations.findIndex(d => d.id === decorId && d.gridX === gridX && d.gridY === gridY);
        if (idx !== -1) {
            window.GameState.decorations.splice(idx, 1);
        }
        // 清除格子
        if (gridX < 16 && gridY < 16) {
            window.GameState.grid[gridX][gridY] = 'empty';
        }
        window.GameState.save();

        UI.closeModal('decoration-detail');
        UI.showToast(`已回收 ${decorData.name}，返还 ${refund} 铜钱`, 2000, 'info');
        window.IsometricMap.render();
    }

    // ===== 新增：拆除边缘天然障碍物（类似部落冲突移除树木/石头）=====

    /**
     * 拆除障碍物消耗配置
     */
    _getObstacleRemoveCost() {
        return { coins: 200, inspiration: 20 };
    }

    /**
     * 获取障碍物名称和emoji
     */
    _getObstacleInfo(type) {
        const map = {
            'pine-tree': { name: '松树', emoji: '🌲' },
            'willow-tree': { name: '柳树', emoji: '🌳' },
            'stone-lantern': { name: '石灯', emoji: '🏮' },
            'stone-well': { name: '石井', emoji: '⛲' },
            'bamboo': { name: '竹林', emoji: '🎋' },
            'rock': { name: '怪石', emoji: '🪨' },
            'plum-tree': { name: '梅树', emoji: '🌸' },
            'lotus-pond': { name: '荷塘', emoji: '🪷' }
        };
        return map[type] || { name: '障碍物', emoji: '🌿' };
    }

    /**
     * 显示拆除障碍物面板
     */
    _showRemoveObstaclePanel(col, row) {
        const deco = window.IsometricMap._decoLayout.find(d => d.col === col && d.row === row);
        if (!deco) return;
        const info = this._getObstacleInfo(deco.type);
        const cost = this._getObstacleRemoveCost();
        const canAfford = window.GameState.coins >= cost.coins && window.GameState.inspiration >= cost.inspiration;

        const panel = document.getElementById('decoration-detail');
        const title = document.getElementById('decoration-detail-title');
        const content = document.getElementById('decoration-detail-content');
        if (!panel || !title || !content) return;

        title.textContent = '拆除天然障碍物';
        content.innerHTML = `
            <div style="text-align: center; margin-bottom: 20px;">
                <span style="font-size: 64px;">${info.emoji}</span>
            </div>
            <div class="decoration-info"><strong>名称：</strong>${info.name}</div>
            <div class="decoration-info"><strong>位置：</strong>(${col}, ${row})</div>
            <div class="decoration-info"><strong>拆除消耗：</strong>💰 ${cost.coins} 铜钱 + ✨ ${cost.inspiration} 灵感</div>
            <div class="decoration-info" style="color: var(--color-success);"><strong>效果：</strong>清除后获得可建筑空地</div>
            ${canAfford
                ? `<button class="decoration-recycle-btn" onclick="Management.removeObstacle(${col}, ${row})">确认拆除（消耗 ${cost.coins} 铜钱 + ${cost.inspiration} 灵感）</button>`
                : `<div class="decoration-info" style="color: var(--color-danger); text-align: center; margin-top: 12px;">资源不足，无法拆除</div>`
            }
        `;
        UI.showModal('decoration-detail');
    }

    /**
     * 执行拆除障碍物（静态转发）
     */
    static removeObstacle(col, row) {
        if (window._managementInstance) {
            window._managementInstance._removeObstacle(col, row);
        }
    }

    /**
     * 执行拆除障碍物
     */
    _removeObstacle(col, row) {
        const cost = this._getObstacleRemoveCost();
        if (window.GameState.coins < cost.coins || window.GameState.inspiration < cost.inspiration) {
            UI.showToast('资源不足，无法拆除', 2000, 'error');
            return;
        }

        // 扣除资源
        window.GameState.addCoins(-cost.coins);
        window.GameState.addInspiration(-cost.inspiration);

        // 从 _decoLayout 中移除
        const idx = window.IsometricMap._decoLayout.findIndex(d => d.col === col && d.row === row);
        if (idx !== -1) {
            const removed = window.IsometricMap._decoLayout.splice(idx, 1)[0];
            const info = this._getObstacleInfo(removed.type);

            // 持久化：记录已拆除的障碍物位置
            if (!window.GameState.removedObstacles) window.GameState.removedObstacles = [];
            window.GameState.removedObstacles.push({ col, row });
            window.GameState.save();

            UI.closeModal('decoration-detail');
            UI.showToast(`已拆除 ${info.name}，获得新空地！`, 2500, 'success');
            window.IsometricMap.render();
        }
    }

    // ===== 自动产出系统 =====

    /**
     * 启动自动产出
     */
    startProduction() {
        if (this.productionInterval) return;
        this.productionInterval = setInterval(() => {
            this.productionTick();
        }, 3000);
        console.log('自动产出系统已启动（每3秒）');
    }

    /**
     * 停止自动产出
     */
    stopProduction() {
        if (this.productionInterval) {
            clearInterval(this.productionInterval);
            this.productionInterval = null;
            console.log('自动产出系统已停止');
        }
    }

    /**
     * 产出计算：基础产出 × (1 + 等级加成20% + 传承人加成50% + 装饰加成)
     */
    productionTick() {
        // 阶段九：无尽模式期间暂停经营产出（避免双倍资源膨胀）
        if (window.GameState && window.GameState.isEndlessMode) return;
        // 阶段十二：广告播放期间暂停经营产出
        if (window.AdSystem && AdSystem.isPlaying()) return;
        const buildings = window.IsometricMap.getBuildings();
        if (!buildings || buildings.length === 0) return;

        // 阶段八：昼夜 + 天气产出倍率
        const dayNightRate = (window.DayNightCycle && typeof DayNightCycle.getRate === 'function') ? DayNightCycle.getRate() : 1.0;
        const weatherRate = (window.WeatherSystem && typeof WeatherSystem.getRate === 'function') ? WeatherSystem.getRate() : 1.0;
        const envRate = dayNightRate * weatherRate;

        let totalOutput = 0;
        buildings.forEach(b => {
            const ichData = this.ichList.find(i => i.id === b.id);
            if (!ichData) return;
            const workshop = window.GameState.getWorkshopById(b.id);
            const level = workshop?.level || 1;
            const hasMaster = workshop?.hasMaster || false;
            const decorBonus = this._getDecorationBonus(b.gridX, b.gridY);
            const output = ichData.baseOutput * (1 + (level - 1) * 0.2 + (hasMaster ? 0.5 : 0) + decorBonus) * envRate;
            totalOutput += output;
        });

        if (totalOutput > 0) {
            // 阶段十二：双倍产出 buff（看广告激活，30分钟内 x2）
            const dpActive = window.AdSystem && AdSystem.isDoubleProductionActive();
            let coins = Math.floor(totalOutput);
            if (dpActive) coins *= 2;
            window.GameState.addCoins(coins);
            // 同步 body 上的双倍产出标记（CSS 高亮铜钱数值）
            if (document.body) {
                document.body.classList.toggle('double-production-active', !!dpActive);
            }

            // 资源飞行动画：从铜钱资源栏飞出
            if (window.UiFx) {
                const coinsEl = document.getElementById('coins-value');
                if (coinsEl) {
                    const rect = coinsEl.getBoundingClientRect();
                    window.UiFx.flyResource(
                        rect.left + rect.width / 2,
                        rect.top + rect.height / 2,
                        `+${coins}💰`,
                        '#FFD700',
                        null  // 不飞向目标，直接在原位飘浮
                    );
                }
            }

            // 阶段十：留存系统——累计铜钱统计 + 成就节流检查（约每10秒检查一次）
            if (window.GameState && typeof GameState.addTotalCoinsEarned === 'function') {
                try { GameState.addTotalCoinsEarned(coins); } catch (e) { /* ignore */ }
            }
            this._achCheckCounter = (this._achCheckCounter || 0) + 1;
            if (this._achCheckCounter % 4 === 0 && window.Achievements) {
                try { Achievements.checkAll(); } catch (e) { /* ignore */ }
            }
            // 阶段十：每 10 秒（4 次 tick）提交经营繁荣度分数到排行榜
            if (this._achCheckCounter % 4 === 0 && window.Leaderboard && typeof Leaderboard.submitManagementScore === 'function') {
                try {
                    const score = this._calcManagementScore();
                    Leaderboard.submitManagementScore(score);
                } catch (e) { /* ignore */ }
            }
        }
    }

    /**
     * 阶段十：计算经营繁荣度分数（建筑数量+等级+景观值）
     * @returns {number}
     */
    _calcManagementScore() {
        try {
            const buildings = window.IsometricMap ? (window.IsometricMap.getBuildings() || []) : [];
            const decors = (window.GameState.decorations || []);
            let score = 0;
            buildings.forEach(b => {
                const ws = window.GameState.getWorkshopById(b.id);
                const level = ws?.level || 1;
                score += 50 + (level - 1) * 20;       // 基础 50 / 级 +20
                if (ws?.hasMaster) score += 30;        // 传承人 +30
            });
            score += decors.length * 15;                // 装饰 +15/个
            return score;
        } catch (e) { return 0; }
    }

    /**
     * 计算装饰加成
     */
    _getDecorationBonus(gridX, gridY) {
        let bonus = 0;
        window.GameState.decorations.forEach(d => {
            const decorData = this.decorations.find(dd => dd.id === d.id);
            if (!decorData) return;
            const dx = Math.abs(d.gridX - gridX);
            const dy = Math.abs(d.gridY - gridY);
            if (dx <= decorData.range && dy <= decorData.range) {
                bonus += decorData.bonus / 100;
            }
        });
        return bonus;
    }

    // ===== 图鉴面板 =====

    /**
     * 显示图鉴面板（默认显示非物质文化遗产标签页）
     */
    showCollectionPanel() {
        UI.showModal('collection-panel');
        this._switchCollectionTab('ich');
    }

    /**
     * 切换图鉴分类标签页（静态入口）
     */
    static switchCollectionTab(category) {
        if (window._managementInstance) {
            window._managementInstance._switchCollectionTab(category);
        }
    }

    /**
     * 切换图鉴分类标签页
     */
    _switchCollectionTab(category) {
        document.querySelectorAll('.collection-tab').forEach(el => {
            el.classList.toggle('active', el.dataset.category === category);
        });
        this._renderCollectionCards(category);
        this._updateCollectionProgress();
    }

    /**
     * 渲染图鉴卡片
     */
    _renderCollectionCards(category) {
        const grid = document.getElementById('collection-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const collection = (window.GameState && window.GameState.collection) || { material: [], ich: [], monster: [] };
        const unlockedList = collection[category] || [];

        let items = [];
        if (category === 'ich') {
            items = this.ichList.map(ich => ({
                id: ich.id, emoji: ich.emoji, name: ich.name, rarity: ich.rarity || 1
            }));
        } else if (category === 'material') {
            items = this.decorations.map(decor => ({
                id: decor.id, emoji: decor.emoji, name: decor.name, rarity: this._getMaterialRarity(decor.id)
            }));
        } else if (category === 'monster') {
            const ed = window.GameData.ENEMY_DATA || {};
            const allMonsters = [].concat(ed.normal || [], ed.elite || [], ed.boss || []);
            items = allMonsters.map(m => ({
                id: m.id, emoji: this._getMonsterEmoji(m.id), name: m.name, rarity: this._getMonsterRarity(m.id)
            }));
        }

        items.forEach(item => {
            const unlocked = unlockedList.includes(item.id);
            const card = document.createElement('div');
            card.className = `collection-card ${unlocked ? 'unlocked' : 'locked'}`;
            if (unlocked) {
                card.addEventListener('click', () => {
                    this._showCollectionDetail(category, item.id);
                });
            }
            card.innerHTML = `
                <div class="collection-card__image">${unlocked ? item.emoji : '❓'}</div>
                <div class="collection-card__name">${unlocked ? item.name : '??'}</div>
                <div class="collection-card__stars">${unlocked ? this._renderStars(item.rarity) : ''}</div>
            `;
            grid.appendChild(card);
        });
    }

    /**
     * 显示图鉴详细信息面板
     */
    _showCollectionDetail(category, id) {
        const titleEl = document.getElementById('collection-detail-title');
        const contentEl = document.getElementById('collection-detail-content');
        const panel = document.getElementById('collection-detail');
        if (!titleEl || !contentEl || !panel) return;

        let html = '';
        let title = '详情';

        if (category === 'ich') {
            const ich = this.ichList.find(i => i.id === id);
            if (!ich) return;
            title = ich.name;
            html = `
                <div class="collection-detail-emoji">${ich.emoji}</div>
                <div class="collection-detail-title">${ich.name}</div>
                <div class="collection-detail-stars">${this._renderStars(ich.rarity)}</div>
                <div class="collection-detail-section"><strong>产地：</strong>${ich.region}</div>
                <div class="collection-detail-section"><strong>时辰：</strong>${ich.hour}</div>
                <div class="collection-detail-section"><strong>塔类型：</strong>${ich.towerType}</div>
                <div class="collection-detail-desc">${ich.description}</div>
                <div class="collection-detail-skill"><strong>技能：${ich.skill.name}</strong><br>${ich.skill.description}<br><span style="color:var(--color-text-secondary);font-size:12px;">冷却：${ich.skill.cooldown}秒</span></div>
                <div class="collection-detail-stats">
                    <div class="collection-detail-stat"><strong>伤害：</strong>${ich.towerDamage}</div>
                    <div class="collection-detail-stat"><strong>射程：</strong>${ich.towerRange}</div>
                    <div class="collection-detail-stat"><strong>攻速：</strong>${ich.towerAttackSpeed}</div>
                    <div class="collection-detail-stat"><strong>建造费：</strong>${ich.buildCost}</div>
                </div>
                <div class="collection-detail-lore">「${ich.lore}」</div>
            `;
        } else if (category === 'material') {
            const decor = this.decorations.find(d => d.id === id);
            if (!decor) return;
            title = decor.name;
            html = `
                <div class="collection-detail-emoji">${decor.emoji}</div>
                <div class="collection-detail-title">${decor.name}</div>
                <div class="collection-detail-stars">${this._renderStars(this._getMaterialRarity(decor.id))}</div>
                <div class="collection-detail-desc">${decor.name} —— 古镇中的物质文化遗产装饰。</div>
                <div class="collection-detail-stats">
                    <div class="collection-detail-stat"><strong>加成比例：</strong>+${decor.bonus}%</div>
                    <div class="collection-detail-stat"><strong>影响范围：</strong>${decor.range}格</div>
                    <div class="collection-detail-stat"><strong>购买费用：</strong>${decor.cost}铜钱</div>
                </div>
            `;
        } else if (category === 'monster') {
            const monster = this._getMonsterData(id);
            if (!monster) return;
            title = monster.name;
            const monsterType = this._getMonsterType(id);
            const reward = monster.reward || {};
            const rewardParts = [];
            if (reward.coins) rewardParts.push(`💰${reward.coins}`);
            if (reward.popularity) rewardParts.push(`⭐${reward.popularity}`);
            if (reward.scrolls) rewardParts.push(`📜${reward.scrolls}`);
            if (reward.inspiration) rewardParts.push(`✨${reward.inspiration}`);
            html = `
                <div class="collection-detail-emoji">${this._getMonsterEmoji(id)}</div>
                <div class="collection-detail-title">${monster.name}</div>
                <div class="collection-detail-stars">${this._renderStars(this._getMonsterRarity(id))}</div>
                <div class="collection-detail-section"><strong>类型：</strong>${monsterType}</div>
                <div class="collection-detail-stats">
                    <div class="collection-detail-stat"><strong>生命值：</strong>${monster.hp}</div>
                    <div class="collection-detail-stat"><strong>速度：</strong>${monster.speed}</div>
                    <div class="collection-detail-stat"><strong>攻击力：</strong>${monster.attack}</div>
                    <div class="collection-detail-stat"><strong>击杀奖励：</strong>${rewardParts.join(' ') || '无'}</div>
                </div>
                ${monster.skill ? `<div class="collection-detail-skill"><strong>技能</strong><br>${monster.skill}</div>` : ''}
            `;
        }

        titleEl.textContent = title;
        contentEl.innerHTML = html;
        panel.classList.remove('hidden');
    }

    // ===== 图鉴辅助方法 =====

    /**
     * 获取图鉴总数（动态计算：物质 + 非遗 + 怪物）
     */
    _getCollectionTotal() {
        const materialCount = (window.GameData.DECORATIONS || []).length;
        const ichCount = (window.GameData.ICH_LIST || []).length;
        const ed = window.GameData.ENEMY_DATA || {};
        const monsterCount = (ed.normal || []).length + (ed.elite || []).length + (ed.boss || []).length;
        return materialCount + ichCount + monsterCount;
    }

    /**
     * 获取已解锁数量
     */
    _getCollectionUnlockedCount() {
        const c = (window.GameState && window.GameState.collection) || {};
        return (c.material || []).length + (c.ich || []).length + (c.monster || []).length;
    }

    /**
     * 更新进度条
     */
    _updateCollectionProgress() {
        const total = this._getCollectionTotal();
        const unlocked = this._getCollectionUnlockedCount();
        const percent = total > 0 ? (unlocked / total * 100) : 0;
        const fill = document.getElementById('collection-progress-fill');
        const text = document.getElementById('collection-progress-text');
        if (fill) fill.style.width = percent + '%';
        if (text) text.textContent = `${unlocked} / ${total} (${Math.round(percent)}%)`;
    }

    /**
     * 渲染星级（1-5星）
     */
    _renderStars(rarity) {
        const r = Math.max(1, Math.min(5, rarity));
        let html = '';
        for (let i = 0; i < 5; i++) {
            html += i < r ? '★' : '☆';
        }
        return html;
    }

    /**
     * 获取怪物数据
     */
    _getMonsterData(id) {
        const ed = window.GameData.ENEMY_DATA || {};
        return [].concat(ed.normal || [], ed.elite || [], ed.boss || []).find(e => e.id === id);
    }

    /**
     * 获取怪物类型标签
     */
    _getMonsterType(id) {
        const ed = window.GameData.ENEMY_DATA || {};
        if ((ed.normal || []).some(e => e.id === id)) return '普通';
        if ((ed.elite || []).some(e => e.id === id)) return '精英';
        if ((ed.boss || []).some(e => e.id === id)) return 'BOSS';
        return '未知';
    }

    /**
     * 获取怪物 emoji
     */
    _getMonsterEmoji(id) {
        const map = {
            'rat-soldier': '🐀', 'lamp-ghost': '👻', 'ox-minion': '🐂', 'moon-rabbit': '🐇',
            'phantom-snake': '🐍', 'monkey-demon': '🐒', 'hellhound': '🐕',
            'tiger-demon': '🐅', 'dragon-guard': '🐉', 'horse-elite': '🐎',
            'sheep-priest': '🐑', 'golden-guard': '🐤',
            'boss-rat': '🐭', 'boss-ox': '🐂', 'boss-tiger': '🐯', 'boss-rabbit': '🐰',
            'boss-dragon': '🐲', 'boss-snake': '🐍', 'boss-horse': '🐴', 'boss-sheep': '🐑',
            'boss-monkey': '🐵', 'boss-rooster': '🐔', 'boss-dog': '🐶', 'boss-pig': '🐷'
        };
        return map[id] || '👤';
    }

    /**
     * 获取怪物稀有度（普通2/精英3/BOSS5）
     */
    _getMonsterRarity(id) {
        const ed = window.GameData.ENEMY_DATA || {};
        if ((ed.normal || []).some(e => e.id === id)) return 2;
        if ((ed.elite || []).some(e => e.id === id)) return 3;
        if ((ed.boss || []).some(e => e.id === id)) return 5;
        return 1;
    }

    /**
     * 获取物质遗产稀有度（按费用分级）
     */
    _getMaterialRarity(id) {
        const decor = this.decorations.find(d => d.id === id);
        if (!decor) return 1;
        if (decor.cost >= 500) return 4;
        if (decor.cost >= 300) return 3;
        return 2;
    }

    /**
     * 触发解锁动画（静态入口，供外部调用）
     */
    static triggerUnlockAnimation(category, id, options) {
        const inst = window._managementInstance;
        if (inst) {
            inst._triggerUnlockAnimation(category, id, options || {});
        }
    }

    /**
     * 触发解锁动画：卡片从中间展开 + toast 提示
     * options.blocking: true=阻塞交互(默认), false=非阻塞(战斗中用)
     */
    _triggerUnlockAnimation(category, id, options) {
        const opts = options || {};
        let emoji = '❓';
        let name = '未知';
        let label = '解锁新条目';

        if (category === 'ich') {
            const ich = this.ichList.find(i => i.id === id);
            if (ich) { emoji = ich.emoji; name = ich.name; label = '解锁新非遗'; }
        } else if (category === 'material') {
            const decor = this.decorations.find(d => d.id === id);
            if (decor) { emoji = decor.emoji; name = decor.name; label = '解锁新遗产'; }
        } else if (category === 'monster') {
            const m = this._getMonsterData(id);
            if (m) { emoji = this._getMonsterEmoji(id); name = m.name; label = '解锁新怪物'; }
        }

        // toast 提示
        if (window.UI) {
            UI.showToast(`${label}：${name}`, 2500, 'success');
        }

        // 阶段六：图鉴解锁音效（风铃声）
        if (window.AudioManager) window.AudioManager.playSound('collect-unlock');

        // 显示动画覆盖层
        const overlay = document.getElementById('collection-unlock-anim');
        const emojiEl = document.getElementById('collection-unlock-emoji');
        const nameEl = document.getElementById('collection-unlock-name');
        const labelEl = document.getElementById('collection-unlock-label');
        if (!overlay || !emojiEl || !nameEl || !labelEl) return;

        // 如果已有动画在播放，跳过动画（仅 toast）
        if (!overlay.classList.contains('hidden')) return;

        emojiEl.textContent = emoji;
        nameEl.textContent = name;
        labelEl.textContent = label;

        overlay.classList.remove('hidden', 'non-blocking', 'dismissing');
        if (opts.blocking === false) {
            overlay.classList.add('non-blocking');
        }

        // 点击关闭
        const dismiss = () => {
            overlay.classList.add('dismissing');
            setTimeout(() => {
                overlay.classList.add('hidden');
                overlay.classList.remove('dismissing', 'non-blocking');
            }, 300);
            overlay.removeEventListener('click', dismiss);
        };
        overlay.addEventListener('click', dismiss);

        // 自动关闭
        const duration = opts.blocking === false ? 1500 : 2000;
        setTimeout(() => {
            if (!overlay.classList.contains('hidden')) {
                dismiss();
            }
        }, duration);
    }

    // ===== 新手引导系统 =====

    /**
     * 引导步骤定义
     */
    _getTutorialSteps() {
        return [
            { text: '欢迎来到非遗古镇！点击空地建造工坊', target: 'map-container', action: 'click-empty' },
            { text: '选择剪纸坊开始建造', target: 'build-panel', action: 'select-workshop' },
            { text: '点击绿色位置放置工坊', target: 'map-container', action: 'place-building' },
            { text: '点击工坊可升级和招募传承人', target: 'map-container', action: 'click-building' },
            { text: '建造更多工坊，闯关获取资源', target: 'build-btn', action: 'click-build' },
            { text: '教程完成！祝你在古镇玩得开心', target: null, action: 'finish' }
        ];
    }

    /**
     * 启动新手引导
     */
    startTutorial() {
        this.tutorialActive = true;
        this.tutorialStep = window.GameState.tutorialStep || 0;
        if (this.tutorialStep >= 6) {
            this.tutorialActive = false;
            return;
        }
        this._showTutorialStep();
    }

    /**
     * 显示当前引导步骤
     */
    _showTutorialStep() {
        const steps = this._getTutorialSteps();
        const step = steps[this.tutorialStep];
        if (!step) {
            this._finishTutorial();
            return;
        }

        const tooltip = document.getElementById('tutorial-tooltip');
        const textEl = document.getElementById('tutorial-text');
        if (!tooltip || !textEl) return;

        // 最后一步：显示后自动关闭
        if (step.action === 'finish') {
            textEl.innerHTML = `${step.text}`;
            tooltip.classList.remove('hidden');
            this._positionTooltip(step.target);
            // 3秒后自动关闭
            setTimeout(() => {
                this._finishTutorial();
            }, 3000);
            return;
        }

        textEl.innerHTML = `<strong style="color: var(--color-gold-light);">${this.tutorialStep + 1}/${steps.length}</strong> ${step.text}`;
        tooltip.classList.remove('hidden');

        // 定位提示框
        this._positionTooltip(step.target);
    }

    /**
     * 定位引导提示框到目标元素附近
     */
    _positionTooltip(targetId) {
        const tooltip = document.getElementById('tutorial-tooltip');
        if (!tooltip) return;

        // 固定在右上角，不挡住操作
        tooltip.style.top = '16px';
        tooltip.style.right = '16px';
        tooltip.style.left = 'auto';
        tooltip.style.transform = 'none';
    }

    /**
     * 推进到下一步
     */
    _advanceTutorial() {
        this.tutorialStep++;
        window.GameState.tutorialStep = this.tutorialStep;
        window.GameState.save();

        if (this.tutorialStep >= 6) {
            this._finishTutorial();
        } else {
            this._showTutorialStep();
        }
    }

    /**
     * 完成引导
     */
    _finishTutorial() {
        this.tutorialActive = false;
        window.GameState.tutorialStep = 6;
        window.GameState.save();
        const tooltip = document.getElementById('tutorial-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
        UI.showToast('新手教程已完成！', 2000, 'success');
    }

    /**
     * 跳过引导
     */
    static skipTutorial() {
        if (window._managementInstance) {
            window._managementInstance._finishTutorial();
        }
    }

    // ===== 更新与清理 =====

    /**
     * 更新建造面板
     */
    updateBuildPanel() {
        if (UI.isVisible('build-panel')) {
            this._renderWorkshopCards();
            this._renderDecorationCards();
        }
    }

    // ===== 阶段十：留存系统 UI（任务/成就/排行榜面板） =====

    /**
     * 绑定留存系统按钮与面板事件
     * 注：在 init() 中调用一次，避免重复绑定
     */
    _bindRetentionEvents() {
        if (this._retentionBound) return;
        this._retentionBound = true;

        // 顶部任务图标 -> 打开任务面板
        const taskBtn = document.getElementById('task-icon-btn');
        if (taskBtn) {
            taskBtn.addEventListener('click', () => this.openDailyTasksPanel());
        }

        // 底部排行榜按钮
        const lbBtn = document.getElementById('leaderboard-btn');
        if (lbBtn) {
            lbBtn.addEventListener('click', () => this.openLeaderboardPanel());
        }

        // 成就入口（底部按钮或图鉴内）—— 用 achievements-btn（若存在）
        const achBtn = document.getElementById('achievements-btn');
        if (achBtn) {
            achBtn.addEventListener('click', () => this.openAchievementsPanel());
        }

        // 任务面板：领取按钮委托
        const taskPanel = document.getElementById('daily-tasks-list');
        if (taskPanel) {
            taskPanel.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-claim-task]');
                if (!btn) return;
                const tid = btn.getAttribute('data-claim-task');
                if (window.DailyTasks && DailyTasks.claimReward(tid)) {
                    this.renderDailyTasks();
                    this.updateTaskBadge();
                }
            });
        }

        // 周奖励领取委托
        const weeklyList = document.getElementById('weekly-rewards-list');
        if (weeklyList) {
            weeklyList.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-claim-weekly]');
                if (!btn) return;
                const tier = parseInt(btn.getAttribute('data-claim-weekly'), 10);
                if (window.DailyTasks && DailyTasks.claimWeeklyReward(tier)) {
                    this.renderDailyTasks();
                }
            });
        }

        // 成就面板：分类标签切换
        const achTabs = document.querySelector('#achievements-panel .achievement-tabs');
        if (achTabs) {
            achTabs.addEventListener('click', (e) => {
                const tab = e.target.closest('.tab-btn');
                if (!tab) return;
                achTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                tab.classList.add('active');
                this._achCurrentCategory = tab.getAttribute('data-category') || 'business';
                this.renderAchievements();
            });
        }

        // 成就领取委托
        const achList = document.getElementById('achievement-list');
        if (achList) {
            achList.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-claim-ach]');
                if (!btn) return;
                const aid = btn.getAttribute('data-claim-ach');
                if (window.Achievements && Achievements.claimReward(aid)) {
                    this.renderAchievements();
                }
            });
        }

        // 排行榜面板：分类标签切换
        const lbTabs = document.querySelector('#leaderboard-panel .leaderboard-tabs');
        if (lbTabs) {
            lbTabs.addEventListener('click', (e) => {
                const tab = e.target.closest('.tab-btn');
                if (!tab) return;
                lbTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                tab.classList.add('active');
                this._lbCurrentCategory = tab.getAttribute('data-category') || 'level-speed';
                this.renderLeaderboard();
            });
        }

        // 关闭按钮委托（三大面板）
        ['daily-tasks-panel', 'achievements-panel', 'leaderboard-panel'].forEach(pid => {
            const panel = document.getElementById(pid);
            if (!panel) return;
            panel.addEventListener('click', (e) => {
                const closeBtn = e.target.closest('.close-btn');
                if (closeBtn) {
                    panel.classList.add('hidden');
                }
            });
        });

        // ===== 阶段十一：PVP系统事件绑定 =====
        this._bindPvpEvents();
    }

    /**
     * 阶段十一：绑定PVP系统所有事件
     */
    _bindPvpEvents() {
        if (this._pvpBound) return;
        this._pvpBound = true;
        // 当前选中的防御塔（编辑器用）
        this._defenseEditorSelected = null;
        // 编辑器临时阵型
        this._defenseEditorFormation = [];
        // 进攻令倒计时定时器
        this._pvpTokenTimer = null;

        // PVP按钮 -> 打开面板
        const pvpBtn = document.getElementById('pvp-btn');
        if (pvpBtn) {
            pvpBtn.addEventListener('click', () => this.openPvpPanel());
        }

        // 标签页切换
        const pvpTabs = document.querySelector('#pvp-panel .pvp-tabs');
        if (pvpTabs) {
            pvpTabs.addEventListener('click', (e) => {
                const tab = e.target.closest('.tab-btn');
                if (!tab) return;
                const tabName = tab.getAttribute('data-tab');
                pvpTabs.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                tab.classList.add('active');
                ['attack-defense', 'sync-battle', 'defense-race', 'log'].forEach(name => {
                    const content = document.getElementById(`pvp-${name}-tab`);
                    if (content) content.classList.toggle('hidden', name !== tabName);
                });
                // 切到战报标签时刷新
                if (tabName === 'log') this.renderPvpBattleLog();
            });
        }

        // 攻守轮换：匹配 + 开始
        const matchBtn = document.getElementById('match-opponent-btn');
        if (matchBtn) matchBtn.addEventListener('click', () => this.matchPvpOpponent('attack-defense'));
        const startAdBtn = document.getElementById('start-attack-defense-btn');
        if (startAdBtn) startAdBtn.addEventListener('click', () => this.startPvpBattle('attack-defense'));

        // 同步对战：匹配 + 开始
        const matchSyncBtn = document.getElementById('match-opponent-sync-btn');
        if (matchSyncBtn) matchSyncBtn.addEventListener('click', () => this.matchPvpOpponent('sync-battle'));
        const startSyncBtn = document.getElementById('start-sync-battle-btn');
        if (startSyncBtn) startSyncBtn.addEventListener('click', () => this.startPvpBattle('sync-battle'));

        // 防守竞赛：匹配 + 开始
        const matchRaceBtn = document.getElementById('match-opponent-race-btn');
        if (matchRaceBtn) matchRaceBtn.addEventListener('click', () => this.matchPvpOpponent('defense-race'));
        const startRaceBtn = document.getElementById('start-defense-race-btn');
        if (startRaceBtn) startRaceBtn.addEventListener('click', () => this.startPvpBattle('defense-race'));

        // 出战牌组配置：委托点击选中/取消（三模式共用）
        const deckConfig = document.getElementById('attack-deck-config');
        if (deckConfig) {
            deckConfig.addEventListener('click', (e) => {
                const card = e.target.closest('.workshop-card');
                if (!card) return;
                const wid = card.getAttribute('data-wid');
                if (!wid) return;
                this._toggleAttackDeckCard(wid, card);
            });
        }

        // PVP面板关闭按钮委托
        const pvpPanel = document.getElementById('pvp-panel');
        if (pvpPanel) {
            pvpPanel.addEventListener('click', (e) => {
                const closeBtn = e.target.closest('.close-btn');
                if (closeBtn) {
                    pvpPanel.classList.add('hidden');
                    if (this._pvpTokenTimer) {
                        clearInterval(this._pvpTokenTimer);
                        this._pvpTokenTimer = null;
                    }
                }
            });
        }
        // 结算面板关闭
        const resultPanel = document.getElementById('pvp-result-panel');
        if (resultPanel) {
            resultPanel.addEventListener('click', (e) => {
                const closeBtn = e.target.closest('.close-btn');
                if (closeBtn) resultPanel.classList.add('hidden');
            });
        }
    }

    /** 打开每日任务面板 */
    openDailyTasksPanel() {
        const panel = document.getElementById('daily-tasks-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        this.renderDailyTasks();
        this.updateTaskBadge();
    }

    /** 打开成就面板 */
    openAchievementsPanel() {
        const panel = document.getElementById('achievements-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        this._achCurrentCategory = this._achCurrentCategory || 'business';
        // 同步标签 active 状态
        const tabs = panel.querySelectorAll('.achievement-tabs .tab-btn');
        tabs.forEach(t => {
            t.classList.toggle('active', t.getAttribute('data-category') === this._achCurrentCategory);
        });
        this.renderAchievements();
    }

    /** 打开排行榜面板 */
    openLeaderboardPanel() {
        const panel = document.getElementById('leaderboard-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        this._lbCurrentCategory = this._lbCurrentCategory || 'level-speed';
        const tabs = panel.querySelectorAll('.leaderboard-tabs .tab-btn');
        tabs.forEach(t => {
            t.classList.toggle('active', t.getAttribute('data-category') === this._lbCurrentCategory);
        });
        // 阶段十：打开排行榜时同步提交图鉴收集度（避免遗漏）
        this._submitCollectionRate();
        this.renderLeaderboard();
    }

    /** 阶段十：提交图鉴收集度到排行榜 */
    _submitCollectionRate() {
        try {
            if (!window.Leaderboard || typeof Leaderboard.submitCollectionRate !== 'function') return;
            const c = window.GameState.collection || {};
            const unlocked = (c.ich ? c.ich.length : 0) + (c.material ? c.material.length : 0) + (c.monster ? c.monster.length : 0);
            // 总数估算：ICH_LIST + LEVELS（boss 图鉴）
            const gd = window.GameData || {};
            const total = (gd.ICH_LIST ? gd.ICH_LIST.length : 0) + (gd.LEVELS ? gd.LEVELS.length : 0);
            if (total > 0) Leaderboard.submitCollectionRate(unlocked, total);
        } catch (e) { /* ignore */ }
    }

    /**
     * 渲染每日任务面板内容
     */
    renderDailyTasks() {
        const listEl = document.getElementById('daily-tasks-list');
        if (!listEl || !window.DailyTasks) return;
        const tasks = DailyTasks.getDailyTasks();
        if (tasks.length === 0) {
            listEl.innerHTML = '<div class="task-empty">暂无任务，将在每日刷新时生成</div>';
        } else {
            listEl.innerHTML = tasks.map(t => {
                const pct = Math.min(100, Math.floor((t.progress / t.target) * 100));
                const claimBtn = t.claimed
                    ? '<span class="task-claimed">已领取</span>'
                    : (t.completed
                        ? `<button class="task-claim-btn" data-claim-task="${t.taskId}">领取</button>`
                        : '<span class="task-locked">未完成</span>');
                return `
                    <div class="task-item ${t.claimed ? 'task-item--claimed' : ''} ${t.completed && !t.claimed ? 'task-item--ready' : ''}">
                        <div class="task-icon">${t.icon || '📋'}</div>
                        <div class="task-body">
                            <div class="task-name">${t.name}</div>
                            <div class="task-desc">${t.description}</div>
                            <div class="task-progress-bar"><div class="task-progress-fill" style="width:${pct}%"></div></div>
                            <div class="task-progress-text">${t.progress}/${t.target}</div>
                        </div>
                        <div class="task-right">
                            <div class="task-activity">+${t.activityReward} 活跃</div>
                            ${claimBtn}
                        </div>
                    </div>`;
            }).join('');
        }

        // 周活跃度
        const weekly = DailyTasks.getWeeklyProgress();
        const barEl = document.getElementById('weekly-activity-bar');
        if (barEl) {
            const maxT = weekly.rewards[weekly.rewards.length - 1].threshold;
            const pct = Math.min(100, Math.floor((weekly.current / maxT) * 100));
            barEl.innerHTML = `
                <div class="weekly-bar"><div class="weekly-bar-fill" style="width:${pct}%"></div></div>
                <div class="weekly-bar-text">${weekly.current} / ${maxT} 活跃度</div>`;
        }
        const rewardsEl = document.getElementById('weekly-rewards-list');
        if (rewardsEl) {
            rewardsEl.innerHTML = weekly.rewards.map(wr => {
                const claimed = weekly.claimed.includes(wr.tier);
                const canClaim = !claimed && weekly.current >= wr.threshold;
                const btn = claimed
                    ? '<span class="weekly-claimed">✓ 已领取</span>'
                    : (canClaim
                        ? `<button class="weekly-claim-btn" data-claim-weekly="${wr.tier}">领取</button>`
                        : '<span class="weekly-locked">🔒 未达到</span>');
                return `
                    <div class="weekly-item ${claimed ? 'weekly-item--claimed' : ''} ${canClaim ? 'weekly-item--ready' : ''}">
                        <div class="weekly-label">第${wr.tier}档：${wr.label}（需 ${wr.threshold} 活跃）</div>
                        ${btn}
                    </div>`;
            }).join('');
        }

        // 倒计时
        const cdEl = document.getElementById('refresh-countdown');
        if (cdEl) cdEl.textContent = DailyTasks.getRefreshCountdown();
    }

    /**
     * 更新顶部任务图标角标（可领取数量）
     */
    updateTaskBadge() {
        const badge = document.querySelector('.task-badge');
        if (!badge || !window.DailyTasks) return;
        const tasks = DailyTasks.getDailyTasks();
        const readyCount = tasks.filter(t => t.completed && !t.claimed).length;
        // 周奖励可领取数
        const weekly = DailyTasks.getWeeklyProgress();
        const weeklyReady = weekly.rewards.filter(wr => !weekly.claimed.includes(wr.tier) && weekly.current >= wr.threshold).length;
        const total = readyCount + weeklyReady;
        if (total > 0) {
            badge.textContent = total;
            badge.classList.remove('hidden');
            badge.classList.add('pulse');
        } else {
            badge.classList.add('hidden');
            badge.classList.remove('pulse');
        }
    }

    /**
     * 渲染成就面板内容
     */
    renderAchievements() {
        const listEl = document.getElementById('achievement-list');
        const statsEl = document.getElementById('achievement-stats');
        if (!listEl || !window.Achievements) return;
        const cat = this._achCurrentCategory || 'business';
        // 修复：已领取的排到底部，可领取的排最前
        const list = Achievements.getAchievementsByCategory(cat).slice().sort((a, b) => {
            const aClaimed = Achievements.isClaimed(a.id);
            const bClaimed = Achievements.isClaimed(b.id);
            if (aClaimed !== bClaimed) return aClaimed ? 1 : -1;
            const aReady = !aClaimed && Achievements.isUnlocked(a.id);
            const bReady = !bClaimed && Achievements.isUnlocked(b.id);
            if (aReady !== bReady) return aReady ? -1 : 1;
            return 0;
        });
        listEl.innerHTML = list.map(ach => {
            const unlocked = Achievements.isUnlocked(ach.id);
            const claimed = Achievements.isClaimed(ach.id);
            const rewardDesc = _formatAchReward(ach.reward);
            let stateHtml;
            let itemCls = 'achievement-item';
            if (claimed) {
                itemCls += ' achievement-item--claimed';
                stateHtml = '<span class="ach-state ach-state--claimed">已领取</span>';
            } else if (unlocked) {
                itemCls += ' achievement-item--ready';
                stateHtml = `<button class="ach-claim-btn" data-claim-ach="${ach.id}">领取</button>`;
            } else {
                itemCls += ' achievement-item--locked';
                stateHtml = '<span class="ach-state ach-state--locked">🔒</span>';
            }
            return `
                <div class="${itemCls}">
                    <div class="ach-icon">${ach.icon}</div>
                    <div class="ach-body">
                        <div class="ach-name">${ach.name}</div>
                        <div class="ach-desc">${ach.description}</div>
                        <div class="ach-cond">条件：${ach.condition}</div>
                    </div>
                    <div class="ach-right">
                        <div class="ach-reward">${rewardDesc}</div>
                        ${stateHtml}
                    </div>
                </div>`;
        }).join('');

        if (statsEl) {
            statsEl.innerHTML = `已解锁 ${Achievements.getUnlockedCount()} / ${Achievements.getTotalCount()}`;
        }
    }

    /**
     * 渲染排行榜面板内容
     */
    renderLeaderboard() {
        const listEl = document.getElementById('ranking-list');
        const externalEl = document.getElementById('player-rank-external');
        if (!listEl || !window.Leaderboard) return;
        const cat = this._lbCurrentCategory || 'level-speed';
        const conf = Leaderboard.getCategoryConfig(cat);
        const data = Leaderboard.getRankingDisplayData(cat);

        if (!data.entries.length) {
            listEl.innerHTML = '<div class="lb-empty">暂无排名数据</div>';
            if (externalEl) externalEl.classList.add('hidden');
            return;
        }

        listEl.innerHTML = data.entries.slice(0, 100).map(e => {
            const rankCls = e.rank <= 3 ? ` ranking-item--top${e.rank}` : '';
            const playerCls = e.isPlayer ? ' ranking-item--player' : '';
            const rankIcon = e.rank === 1 ? '👑' : (e.rank <= 3 ? '🏅' : '');
            return `
                <div class="ranking-item${rankCls}${playerCls}">
                    <div class="rank-num">${rankIcon || e.rank}</div>
                    <div class="rank-avatar">${e.avatar}</div>
                    <div class="rank-name">${e.name}</div>
                    <div class="rank-score">${e.score} ${conf.unit}</div>
                </div>`;
        }).join('');

        // 玩家不在前 100 名时，底部单独显示
        if (externalEl) {
            if (data.playerRank > 0 && data.playerRank <= 100) {
                externalEl.classList.add('hidden');
            } else if (data.playerScore > 0) {
                externalEl.classList.remove('hidden');
                externalEl.innerHTML = `
                    <div class="ranking-item ranking-item--player">
                        <div class="rank-num">${data.playerRank > 0 ? data.playerRank : '未上榜'}</div>
                        <div class="rank-avatar">🏯</div>
                        <div class="rank-name">我的古镇</div>
                        <div class="rank-score">${data.playerScore} ${conf.unit}</div>
                    </div>`;
            } else {
                externalEl.classList.add('hidden');
            }
        }
    }

    /** 资源飞飘文字（供 DailyTasks.claimReward 使用） */
    _floatText(text, color) {
        try {
            if (window.UiFx && typeof UiFx.flyResource === 'function') {
                const btn = document.getElementById('task-icon-btn');
                if (btn) {
                    const rect = btn.getBoundingClientRect();
                    UiFx.flyResource(rect.left, rect.top, text, color || '#FFD700', null);
                }
            }
        } catch (e) { /* ignore */ }
    }

    /**
     * 销毁实例，清理资源
     */
    destroy() {
        this.stopProduction();
        // 移除 canvas mousemove 监听
        if (this._canvasMouseMoveHandler && window.IsometricMap?.canvas) {
            window.IsometricMap.canvas.removeEventListener('mousemove', this._canvasMouseMoveHandler);
            this._canvasMouseMoveHandler = null;
        }
        // 取消 UpgradeFx 动画循环（防止内存泄漏）
        if (this._upgradeFxId) {
            cancelAnimationFrame(this._upgradeFxId);
            this._upgradeFxId = null;
        }
        this._upgradeFxLoop = false;
        // 阶段五：停止建筑常态动画循环并清理
        if (window.BuildingFx) {
            window.BuildingFx.stop();
            window.BuildingFx.clear();
        }
        if (window.UpgradeFx) {
            window.UpgradeFx.clear();
        }
        // 恢复原始 render
        if (this._originalRender && window.IsometricMap) {
            window.IsometricMap.render = this._originalRender;
            this._originalRender = null;
        }
        // 隐藏引导
        const tooltip = document.getElementById('tutorial-tooltip');
        if (tooltip) tooltip.classList.add('hidden');
        const hint = document.getElementById('placement-hint');
        if (hint) hint.classList.add('hidden');
    }

    // ===== 阶段十一：PVP系统方法 =====

    /** 打开PVP面板 */
    openPvpPanel() {
        const panel = document.getElementById('pvp-panel');
        if (!panel) return;
        panel.classList.remove('hidden');
        // 打开时检查进攻令恢复
        if (window.PvpSystem) PvpSystem.checkTokenRecovery();
        this.renderPvpTokens();
        this.renderAttackDeckConfig();
        // 启动进攻令倒计时定时器
        if (this._pvpTokenTimer) clearInterval(this._pvpTokenTimer);
        this._pvpTokenTimer = setInterval(() => this.renderPvpTokens(), 1000);
    }

    /** 渲染进攻令显示（攻守轮换/同步对战两个标签页） */
    renderPvpTokens() {
        if (!window.PvpSystem) return;
        PvpSystem.syncFromGameState();
        const tokens = PvpSystem.attackTokens;
        const max = PvpSystem.maxAttackTokens;
        const countdown = PvpSystem.getTokenRecoverCountdown();
        let countdownText = '';
        if (tokens < max && countdown > 0) {
            const min = Math.floor(countdown / 60000);
            const sec = Math.floor((countdown % 60000) / 1000);
            countdownText = `（恢复 ${min}:${String(sec).padStart(2, '0')}）`;
        } else if (tokens >= max) {
            countdownText = '（已满）';
        }
        const html = `<span class="token-icon">⚔️</span> 进攻令：<strong>${tokens}/${max}</strong> <span class="token-countdown">${countdownText}</span>`;
        const adEl = document.getElementById('pvp-tokens-display');
        const syncEl = document.getElementById('pvp-tokens-display-sync');
        if (adEl) adEl.innerHTML = html;
        if (syncEl) syncEl.innerHTML = html;
    }

    /** 渲染出战牌组配置（三模式共用） */
    renderAttackDeckConfig() {
        const container = document.getElementById('attack-deck-config');
        if (!container) return;
        const available = PvpSystem.getAvailableWorkshops();
        const selected = PvpSystem.getAttackDeck();
        const selectedSet = new Set(selected);
        if (available.length === 0) {
            container.innerHTML = '<div class="empty-tip">暂无已建造工坊，请先建造工坊</div>';
            this._updateDeckCount(0);
            return;
        }
        container.innerHTML = available.map(w => {
            const ich = this._getIchById(w.ichId || w.id) || {};
            const isSelected = selectedSet.has(w.id);
            return `
                <div class="workshop-card ${isSelected ? 'selected' : ''}" data-wid="${w.id}">
                    <div class="workshop-card-icon">${ich.emoji || '🏗️'}</div>
                    <div class="workshop-card-name">${ich.name || w.name || w.id}</div>
                    <div class="workshop-card-level">Lv.${w.level || 1}</div>
                    ${isSelected ? '<div class="workshop-card-check">✓</div>' : ''}
                </div>`;
        }).join('');
        this._updateDeckCount(selected.length);
    }

    /** 获取工坊对应的非遗数据 */
    _getIchById(id) {
        const list = (window.GameData && window.GameData.ICH_LIST) || [];
        return list.find(ich => ich.id === id) || null;
    }

    /** 更新已选卡组数量显示 */
    _updateDeckCount(count) {
        const el = document.getElementById('attack-deck-count');
        if (!el) return;
        const valid = count >= 5 && count <= 8;
        el.innerHTML = `已选 <span class="${valid ? 'count-ok' : 'count-warn'}">${count}</span>/5-8`;
    }

    /** 切换出战牌组工坊选中状态 */
    _toggleAttackDeckCard(wid, cardEl) {
        let deck = [...PvpSystem.getAttackDeck()];
        const idx = deck.indexOf(wid);
        if (idx >= 0) {
            deck.splice(idx, 1);
            cardEl.classList.remove('selected');
            const check = cardEl.querySelector('.workshop-card-check');
            if (check) check.remove();
        } else {
            if (deck.length >= 8) {
                UI.showToast('出战牌组最多8个工坊', 1500, 'error');
                return;
            }
            deck.push(wid);
            cardEl.classList.add('selected');
            const check = document.createElement('div');
            check.className = 'workshop-card-check';
            check.textContent = '✓';
            cardEl.appendChild(check);
        }
        const r = PvpSystem.setAttackDeck(deck);
        if (!r.success) {
            // 数量不足5个时也保存（允许中间状态），但提示
            // 这里不阻断保存，只更新计数
            PvpSystem.attackDeck = deck;
            PvpSystem.syncToGameState();
        }
        this._updateDeckCount(deck.length);
    }

    /** 匹配PVP对手 */
    matchPvpOpponent(mode) {
        if (!window.PvpSystem) return;
        // 所有模式统一校验出战牌组（5-8个工坊）
        const deck = PvpSystem.getBattleDeck();
        if (deck.length < 5 || deck.length > 8) {
            UI.showToast('请先配置出战牌组（5-8个工坊）', 2000, 'error');
            return;
        }
        const result = PvpSystem.matchOpponent(mode);
        if (!result.success) {
            UI.showToast(result.reason || '匹配失败', 2000, 'error');
            return;
        }
        const opp = result.opponent;
        const infoId = mode === 'attack-defense' ? 'opponent-info' :
                       mode === 'sync-battle' ? 'opponent-info-sync' : 'opponent-info-race';
        const startBtnId = mode === 'attack-defense' ? 'start-attack-defense-btn' :
                           mode === 'sync-battle' ? 'start-sync-battle-btn' : 'start-defense-race-btn';
        const infoEl = document.getElementById(infoId);
        const startBtn = document.getElementById(startBtnId);
        if (infoEl) {
            infoEl.innerHTML = `
                <div class="opp-avatar">${opp.avatar}</div>
                <div class="opp-detail">
                    <div class="opp-name">${opp.name}</div>
                    <div class="opp-stats">繁荣度：${opp.prosperity} | 建筑：${opp.townLayout.buildings.length} | 评级：${opp.pvpRating}</div>
                </div>`;
            infoEl.classList.remove('hidden');
        }
        if (startBtn) startBtn.classList.remove('hidden');
        UI.showToast(`匹配到对手：${opp.name}`, 1500, 'success');
    }

    /** 开始PVP对战 */
    startPvpBattle(mode) {
        if (!window.PvpSystem) return;
        const opp = PvpSystem.matchedOpponent;
        if (!opp) {
            UI.showToast('请先匹配对手', 1500, 'error');
            return;
        }
        let started = false;
        if (mode === 'attack-defense' && window.AttackDefenseMode) {
            started = AttackDefenseMode.start(opp);
        } else if (mode === 'sync-battle' && window.SyncBattleMode) {
            started = SyncBattleMode.start(opp);
        } else if (mode === 'defense-race' && window.DefenseRaceMode) {
            started = DefenseRaceMode.start(opp);
        }
        if (!started) {
            UI.showToast('开始对战失败（进攻令不足或战斗系统未就绪）', 2000, 'error');
            return;
        }
        // 关闭PVP面板
        const panel = document.getElementById('pvp-panel');
        if (panel) panel.classList.add('hidden');
        if (this._pvpTokenTimer) {
            clearInterval(this._pvpTokenTimer);
            this._pvpTokenTimer = null;
        }
        // 清除匹配状态
        PvpSystem.matchedOpponent = null;
        PvpSystem.syncToGameState();
        UI.showToast('对战开始！', 1000, 'success');
    }

    /** 渲染战报标签页 */
    renderPvpBattleLog() {
        if (!window.PvpSystem) return;
        const stats = PvpSystem.getPvpStats();
        const rating = PvpSystem.getPvpRating();
        // 统计展示
        const statsEl = document.getElementById('pvp-stats-display');
        if (statsEl) {
            let totalWin = 0, totalLose = 0;
            const modeNames = { 'attack-defense': '攻守轮换', 'sync-battle': '同步对战', 'defense-race': '防守竞赛' };
            let html = '<div class="pvp-stats-box"><h3>PVP统计</h3><div class="pvp-rating">总评级：<strong>' + rating + '</strong></div>';
            ['attack-defense', 'sync-battle', 'defense-race'].forEach(m => {
                const s = stats[m] || { win: 0, lose: 0 };
                totalWin += s.win; totalLose += s.lose;
                const total = s.win + s.lose;
                const rate = total > 0 ? Math.round(s.win / total * 100) : 0;
                html += `<div class="pvp-stat-row"><span>${modeNames[m]}</span><span>${s.win}胜 ${s.lose}败</span><span>胜率 ${rate}%</span></div>`;
            });
            const totalRate = (totalWin + totalLose) > 0 ? Math.round(totalWin / (totalWin + totalLose) * 100) : 0;
            html += `<div class="pvp-stat-row total"><span>总计</span><span>${totalWin}胜 ${totalLose}败</span><span>胜率 ${totalRate}%</span></div>`;
            html += '</div>';
            statsEl.innerHTML = html;
        }
        // 各模式战报列表
        const log = PvpSystem.battleLog;
        const listIds = { 'attack-defense': 'attack-defense-log-list', 'sync-battle': 'sync-battle-log-list', 'defense-race': 'defense-race-log-list' };
        Object.keys(listIds).forEach(mode => {
            const el = document.getElementById(listIds[mode]);
            if (!el) return;
            const entries = (log[mode] || []).slice(0, 10);
            if (entries.length === 0) {
                el.innerHTML = '<div class="empty-tip">暂无对战记录</div>';
                return;
            }
            el.innerHTML = entries.map(e => {
                const resultText = e.result === 'win' ? '胜利' : (e.result === 'lose' ? '失败' : '平局');
                const resultCls = e.result === 'win' ? 'log-win' : (e.result === 'lose' ? 'log-lose' : 'log-draw');
                const rewardText = e.reward && (e.reward.coins || e.reward.inspiration || e.reward.scrolls)
                    ? `💰${e.reward.coins||0} ✨${e.reward.inspiration||0} 📜${e.reward.scrolls||0}` : '无奖励';
                const time = new Date(e.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                return `<div class="battle-log-item ${resultCls}"><span class="log-result">${resultText}</span><span class="log-opp">${e.opponent}</span><span class="log-reward">${rewardText}</span><span class="log-time">${time}</span></div>`;
            }).join('');
        });
    }

    /**
     * 阶段十一：显示PVP结算面板（供 tower-defense.js 调用）
     * @param {string} mode 模式
     * @param {object} data 结算数据 {result, reward, ...}
     */
    showPvpResult(mode, data) {
        const panel = document.getElementById('pvp-result-panel');
        const titleEl = document.getElementById('pvp-result-title');
        const contentEl = document.getElementById('pvp-result-content');
        if (!panel || !titleEl || !contentEl) return;
        const modeNames = { 'attack-defense': '攻守轮换', 'sync-battle': '同步对战', 'defense-race': '防守竞赛' };
        const resultText = data.result === 'win' ? '胜利！' : (data.result === 'lose' ? '失败' : '平局');
        const resultCls = data.result === 'win' ? 'result-win' : (data.result === 'lose' ? 'result-lose' : 'result-draw');
        titleEl.textContent = `${modeNames[mode] || 'PVP'} - ${resultText}`;
        let detailHtml = '';
        if (mode === 'attack-defense') {
            detailHtml = `<div class="result-detail"><div>你的进攻得分：${(data.playerScore*100).toFixed(0)}%</div><div>对手进攻得分：${(data.aiScore*100).toFixed(0)}%</div></div>`;
        } else if (mode === 'sync-battle') {
            detailHtml = `<div class="result-detail"><div>你的主灯HP：${data.playerHP}</div><div>对手主灯HP：${data.aiHP}</div></div>`;
        } else if (mode === 'defense-race') {
            detailHtml = `<div class="result-detail"><div>你坚持波次：${data.playerWaves}</div><div>对手坚持波次：${data.aiWaves}</div></div>`;
        }
        const reward = data.reward || {};
        const rewardHtml = (reward.coins || reward.inspiration || reward.scrolls)
            ? `<div class="result-reward"><span>💰${reward.coins||0}</span><span>✨${reward.inspiration||0}</span><span>📜${reward.scrolls||0}</span></div>`
            : '<div class="result-reward">无奖励</div>';
        contentEl.innerHTML = `<div class="pvp-result-box ${resultCls}"><div class="result-big">${resultText}</div>${detailHtml}${rewardHtml}</div>`;
        panel.classList.remove('hidden');
    }
}

window.Management = Management;

// ===== 阶段八：昼夜循环系统 =====
// 24分钟现实时间 = 24小时游戏时间
// 时段：白天(6-18) / 黄昏(18-20) / 夜晚(20-6)
// 产出倍率：白天 1.0 / 黄昏 1.2 / 夜晚 0.6
const DayNightCycle = {
    _startTime: 0,           // performance.now() 起始
    _gameMinutes: 6 * 60,    // 游戏内分钟数，初始早上6点
    _rafId: null,
    _lastTime: 0,
    _period: 'day',          // day | dusk | night
    _overlayAlpha: 0,        // 当前遮罩透明度（平滑过渡）
    _targetAlpha: 0,         // 目标透明度
    _overlayColor: 'rgba(255,200,100,0.0)',  // 当前遮罩颜色
    _targetColor: 'rgba(255,200,100,0.0)',

    // 时段定义：[起始小时, 结束小时, 遮罩颜色, 产出倍率, 名称]
    _periods: [
        { start: 0,  end: 5,  color: 'rgba(20,30,80,0.55)',   rate: 0.6, name: '深夜' },
        { start: 5,  end: 7,  color: 'rgba(255,180,120,0.25)', rate: 0.9, name: '黎明' },
        { start: 7,  end: 17, color: 'rgba(255,255,255,0.0)',  rate: 1.0, name: '白天' },
        { start: 17, end: 19, color: 'rgba(255,160,80,0.35)',  rate: 1.2, name: '黄昏' },
        { start: 19, end: 22, color: 'rgba(40,50,100,0.4)',    rate: 0.8, name: '夜晚' },
        { start: 22, end: 24, color: 'rgba(20,30,80,0.55)',    rate: 0.6, name: '深夜' }
    ],

    /** 启动昼夜循环 */
    start() {
        if (this._rafId) return;
        this._startTime = performance.now();
        this._lastTime = this._startTime;
        const loop = (t) => {
            if (!this._rafId) return;
            const dt = (t - this._lastTime) / 1000;
            this._lastTime = t;
            this.update(dt);
            this._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
        console.log('[DayNightCycle] 昼夜循环已启动（24分钟=24小时）');
    },

    /** 停止 */
    stop() {
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    },

    /** 每帧更新：推进游戏时间 + 计算时段 + 平滑过渡遮罩 */
    update(dt) {
        // 现实1秒 = 游戏1分钟（24分钟现实=24小时游戏）
        const gameMinutesPerSec = 1;
        this._gameMinutes += dt * gameMinutesPerSec;
        // 循环（24小时 = 1440分钟）
        if (this._gameMinutes >= 1440) this._gameMinutes -= 1440;

        // 计算当前时段
        const hour = this._gameMinutes / 60;
        let currentPeriod = this._periods[0];
        for (const p of this._periods) {
            if (hour >= p.start && hour < p.end) {
                currentPeriod = p;
                break;
            }
        }
        const prevPeriod = this._period;
        this._period = currentPeriod.name;
        this._targetColor = currentPeriod.color;

        // 时段切换时触发光效提示
        if (prevPeriod !== this._period && prevPeriod !== 'day' || (prevPeriod === 'day' && this._period !== 'day' && this._overlayAlpha < 0.05)) {
            // 时段变化，触发 UI 更新
            this._notifyPeriodChange(prevPeriod, this._period);
        }

        // 平滑过渡遮罩颜色与透明度（解析目标颜色的 alpha）
        const targetAlpha = this._parseAlpha(currentPeriod.color);
        this._overlayAlpha += (targetAlpha - this._overlayAlpha) * Math.min(1, dt * 0.5);
        this._overlayColor = this._replaceAlpha(currentPeriod.color, this._overlayAlpha);

        // 触发地图重绘（让遮罩生效）
        if (window.IsometricMap && typeof window.IsometricMap.render === 'function') {
            window.IsometricMap.render();
        }

        // 更新 UI 时间显示
        this._updateTimeUI(hour);
    },

    /** 解析 rgba 字符串中的 alpha 值 */
    _parseAlpha(rgba) {
        const m = rgba.match(/[\d.]+\)$/);
        return m ? parseFloat(m[0]) : 0;
    },

    /** 替换 rgba 字符串的 alpha 值 */
    _replaceAlpha(rgba, alpha) {
        return rgba.replace(/[\d.]+\)$/, alpha.toFixed(3) + ')');
    },

    /** 时段切换通知 */
    _notifyPeriodChange(from, to) {
        if (window.UI && typeof UI.showToast === 'function') {
            const msg = { '黎明': '天色渐明，黎明已至', '白天': '阳光明媚，白天开始', '黄昏': '夕阳西下，黄昏时分（产出+20%）', '夜晚': '夜幕降临，产出降低', '深夜': '夜深人静，产出大幅降低' }[to];
            if (msg) UI.showToast(msg, 2500, 'info');
        }
    },

    /** 更新时间 UI */
    _updateTimeUI(hour) {
        const el = document.getElementById('time-display');
        if (!el) return;
        const h = Math.floor(hour);
        const m = Math.floor((hour - h) * 60);
        const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        const icon = { '黎明': '🌅', '白天': '☀️', '黄昏': '🌇', '夜晚': '🌙', '深夜': '🌙' }[this._period] || '☀️';
        el.textContent = `${icon} ${timeStr} ${this._period}`;
    },

    /** 获取当前产出倍率 */
    getRate() {
        const hour = this._gameMinutes / 60;
        for (const p of this._periods) {
            if (hour >= p.start && hour < p.end) return p.rate;
        }
        return 1.0;
    },

    /** 获取当前遮罩颜色（供 isometric-map 渲染使用） */
    getOverlay() {
        return { color: this._overlayColor, alpha: this._overlayAlpha };
    },

    /** 获取当前时段名称 */
    getPeriod() { return this._period; }
};
window.DayNightCycle = DayNightCycle;

// ===== 阶段八：天气系统 =====
// 天气类型：晴天 / 雨天 / 雪天
// 产出倍率：晴天 1.0 / 雨天 0.8 / 雪天 0.5
// 每 3-5 分钟随机切换（或保持晴天）
const WeatherSystem = {
    _current: 'sunny',
    _nextSwitchTime: 0,    // 下次切换时间戳（performance.now()）
    _checkInterval: null,

    // 天气配置：[名称, 产出倍率, SceneFx 类型, 图标, 描述]
    _weathers: {
        'sunny': { rate: 1.0, fxType: null,       icon: '☀️', name: '晴天', desc: '风和日丽' },
        'rainy': { rate: 0.8, fxType: 'rain',     icon: '🌧️', name: '雨天', desc: '细雨绵绵（产出-20%）' },
        'snowy': { rate: 0.5, fxType: 'snow',     icon: '❄️', name: '雪天', desc: '大雪纷飞（产出-50%）' }
    },

    /** 启动天气系统 */
    start() {
        if (this._checkInterval) return;
        // 初始 5-10 分钟后第一次切换
        this._nextSwitchTime = performance.now() + (5 + Math.random() * 5) * 60 * 1000;
        // 每 30 秒检查一次是否到切换时间
        this._checkInterval = setInterval(() => this._check(), 30000);
        console.log('[WeatherSystem] 天气系统已启动');
        this._updateUI();
    },

    /** 停止 */
    stop() {
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
        // 清理特效
        if (window.SceneFx) window.SceneFx.clearWeather();
    },

    /** 检查是否需要切换天气 */
    _check() {
        const now = performance.now();
        if (now < this._nextSwitchTime) return;

        // 80% 概率切换到新天气，20% 保持晴天
        const r = Math.random();
        let newWeather;
        if (r < 0.5) {
            newWeather = 'sunny';
        } else if (r < 0.8) {
            newWeather = 'rainy';
        } else {
            newWeather = 'snowy';
        }

        if (newWeather === this._current) return;
        this.setWeather(newWeather);

        // 下次切换：5-10 分钟后
        this._nextSwitchTime = now + (5 + Math.random() * 5) * 60 * 1000;
    },

    /** 设置天气（手动或自动） */
    setWeather(type) {
        if (!this._weathers[type]) return;
        const old = this._current;
        this._current = type;
        const cfg = this._weathers[type];

        // 对接 SceneFx（关键 Bug 规避：先 clear 再 set）
        if (window.SceneFx) {
            window.SceneFx.clearWeather();
            if (cfg.fxType) {
                // 延迟 100ms 启动，确保 clear 完成
                setTimeout(() => {
                    if (window.SceneFx && this._current === type) {
                        window.SceneFx.setWeather(cfg.fxType);
                    }
                }, 100);
            }
        }

        // 提示
        if (old !== type && window.UI && typeof UI.showToast === 'function') {
            UI.showToast(`天气变化：${cfg.icon} ${cfg.name}（${cfg.desc}）`, 3000, 'info');
        }

        this._updateUI();
    },

    /** 更新天气 UI */
    _updateUI() {
        const el = document.getElementById('weather-display');
        if (!el) return;
        const cfg = this._weathers[this._current];
        el.textContent = `${cfg.icon} ${cfg.name}`;
        el.title = cfg.desc;
    },

    /** 获取当前产出倍率 */
    getRate() {
        return this._weathers[this._current].rate;
    },

    /** 获取当前天气 */
    getCurrent() { return this._current; }
};
window.WeatherSystem = WeatherSystem;

// 在 DOMContentLoaded 时由 index.html 创建实例并保存
window._managementInstance = null;
