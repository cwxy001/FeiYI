/* 
 * isometric-map.js - 等距地图Canvas引擎
 * 功能：提供等距地图的坐标转换、建筑绘制、碰撞检测等功能
 * 日期：2026-06-22
 */

class IsometricMapEngine {
    constructor() {
        this.GRID_SIZE = 30;          // 地图总大小 30x30
        this.UNLOCKED_SIZE = 10;      // 当前解锁大小（随小镇等级提升）
        this.TILE_WIDTH = 80;
        this.TILE_HEIGHT = 50;        // 调整：40→50，1.6:1 更俯视（参考开心商店）
        
        this.canvas = null;
        this.ctx = null;
        this.offsetX = 0;
        this.offsetY = 0;
        
        this.buildings = [];
        
        this.resizeHandler = this.handleResize.bind(this);
        this.clickHandler = this.handleClick.bind(this);
        this.mouseDownHandler = this.handleMouseDown.bind(this);
        this.mouseMoveHandler = this.handleDrag.bind(this);
        this.mouseUpHandler = this.handleMouseUp.bind(this);
        
        // 拖动状态
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;
        this.hasDragged = false;
        
        this.onTileClick = null;
    }

    /**
     * 初始化Canvas
     * @param {string} containerId - 容器元素ID
     * @returns {IsometricMapEngine} 返回自身以便链式调用
     */
    init(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('容器元素不存在');
            return this;
        }
        
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'map-canvas';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        container.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d');
        this.handleResize();
        
        window.addEventListener('resize', this.resizeHandler);
        this.canvas.addEventListener('click', this.clickHandler);
        this.canvas.addEventListener('mousedown', this.mouseDownHandler);
        window.addEventListener('mousemove', this.mouseMoveHandler);
        window.addEventListener('mouseup', this.mouseUpHandler);
        
        return this;
    }

    /**
     * 鼠标按下：开始拖动
     */
    handleMouseDown(e) {
        this.isDragging = true;
        this.hasDragged = false;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.dragOffsetX = this.offsetX;
        this.dragOffsetY = this.offsetY;
    }

    /**
     * 鼠标移动：拖动地图
     */
    handleDrag(e) {
        if (!this.isDragging) return;
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;
        // 移动超过5像素才算拖动（避免误判）
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
            this.hasDragged = true;
        }
        if (this.hasDragged) {
            this.offsetX = this.dragOffsetX + dx;
            this.offsetY = this.dragOffsetY + dy;
            this.render();
        }
    }

    /**
     * 鼠标抬起：结束拖动
     */
    handleMouseUp(e) {
        this.isDragging = false;
    }

    /**
     * 处理窗口大小变化
     */
    handleResize() {
        const container = this.canvas.parentElement;
        if (container) {
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;
        }
        
        // 等距视角：考虑顶栏(50px)和底栏(50px)，居中显示菱形网格
        // 菱形网格在等距视角下，(0,0)在顶部，整体向下延伸
        // 所以 offsetY 需要向上偏移，让网格视觉居中
        const topBar = 50;
        const bottomBar = 50;
        const availH = this.canvas.height - topBar - bottomBar;
        this.offsetX = this.canvas.width / 2;
        this.offsetY = topBar + availH / 2 - (this.GRID_SIZE * this.TILE_HEIGHT) / 4;
        
        this.render();
    }

    /**
     * 处理Canvas点击事件
     * @param {Event} e - 点击事件
     */
    handleClick(e) {
        // 如果是拖动，不触发点击
        if (this.hasDragged) {
            this.hasDragged = false;
            return;
        }
        const rect = this.canvas.getBoundingClientRect();
        // 修复：考虑 canvas CSS 尺寸与内部尺寸的比例，避免鼠标偏移
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const sx = (e.clientX - rect.left) * scaleX;
        const sy = (e.clientY - rect.top) * scaleY;
        
        // 优先检查是否点击了建筑（用建筑的视觉边界）
        const clickedBuilding = this.getBuildingAtScreen(sx, sy);
        if (clickedBuilding) {
            if (this.onTileClick) {
                this.onTileClick(clickedBuilding.gridX, clickedBuilding.gridY);
            }
            return;
        }
        
        const tile = this.screenToTile(sx, sy);
        if (tile && tile.col >= 0 && tile.col < this.GRID_SIZE && 
            tile.row >= 0 && tile.row < this.GRID_SIZE) {
            if (this.onTileClick) {
                this.onTileClick(tile.col, tile.row);
            }
        }
    }

    /**
     * 检测屏幕坐标是否点击了建筑
     * @param {number} sx - 屏幕X坐标
     * @param {number} sy - 屏幕Y坐标
     * @returns {object|null} 被点击的建筑或null
     */
    getBuildingAtScreen(sx, sy) {
        // 等距视角点击检测：使用 tileToScreen 计算菱形建筑边界
        for (let i = this.buildings.length - 1; i >= 0; i--) {
            const building = this.buildings[i];
            const { gridX, gridY, width, height } = building;
            
            const startTile = this.tileToScreen(gridX, gridY);
            const endTile = this.tileToScreen(gridX + width - 1, gridY + height - 1);
            const centerX = (startTile.x + endTile.x) / 2;
            // 修复：与 drawBuilding 保持一致，topY = 中心y - halfH
            const halfH = this.TILE_HEIGHT / 2;
            const bottomY = Math.max(startTile.y, endTile.y) + halfH;
            const topY = Math.min(startTile.y, endTile.y) - halfH;
            const midY = (topY + bottomY) / 2;
            const widthPx = width * this.TILE_WIDTH;
            const heightPx = height * this.TILE_HEIGHT;
            const wallHeight = 25;
            
            // 建筑大致包围盒（包含墙体高度）
            const minX = centerX - widthPx / 2;
            const maxX = centerX + widthPx / 2;
            const minY = topY - wallHeight;
            const maxY = bottomY;
            
            if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
                return building;
            }
        }
        return null;
    }

    /**
     * 网格坐标转屏幕坐标（经典等距菱形）
     */
    tileToScreen(col, row) {
        const x = (col - row) * (this.TILE_WIDTH / 2) + this.offsetX;
        const y = (col + row) * (this.TILE_HEIGHT / 2) + this.offsetY;
        return { x, y };
    }

    /**
     * 屏幕坐标转网格坐标（经典等距菱形）
     */
    screenToTile(sx, sy) {
        const x = sx - this.offsetX;
        const y = sy - this.offsetY;
        const col = Math.round((x / (this.TILE_WIDTH / 2) + y / (this.TILE_HEIGHT / 2)) / 2);
        const row = Math.round((y / (this.TILE_HEIGHT / 2) - x / (this.TILE_WIDTH / 2)) / 2);
        if (col >= 0 && col < this.GRID_SIZE && row >= 0 && row < this.GRID_SIZE) {
            return { col, row };
        }
        return null;
    }

    /**
     * 检查是否可以放置建筑
     * @param {number} gridX - 起始列
     * @param {number} gridY - 起始行
     * @param {number} width - 建筑宽度（格子数）
     * @param {number} height - 建筑高度（格子数）
     * @returns {boolean} 是否可以放置
     */
    canPlaceBuilding(gridX, gridY, width, height) {
        for (let i = 0; i < width; i++) {
            for (let j = 0; j < height; j++) {
                const col = gridX + i;
                const row = gridY + j;

                // 修复：补全下界检查 + 解锁范围检查
                if (col < 0 || row < 0 || col >= this.GRID_SIZE || row >= this.GRID_SIZE) {
                    return false;
                }
                // 只允许在解锁范围内建造
                const unlocked = this.getUnlockedSize();
                if (col >= unlocked || row >= unlocked) {
                    return false;
                }

                // 安全访问 grid
                const grid = (window.GameState && window.GameState.grid) ? window.GameState.grid : null;
                if (!grid || !grid[col] || !grid[col][row] || grid[col][row] !== 'empty') {
                    return false;
                }

                // 修复：检查边缘装饰物占用（纯视觉装饰未写入grid，需额外检测）
                if (this.hasEdgeDecoration(col, row)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * 检查指定格子是否有边缘装饰物（开局随机生成的不可建造区域）
     * @param {number} col - 列
     * @param {number} row - 行
     * @returns {boolean}
     */
    hasEdgeDecoration(col, row) {
        if (!this._decoLayout) return false;
        return this._decoLayout.some(d => d.col === col && d.row === row);
    }

    /**
     * 获取当前解锁的地图大小（随小镇等级提升）
     * @returns {number}
     */
    getUnlockedSize() {
        if (window.GameState && window.GameState.townLevel) {
            // 小镇等级1=10x10, 2=12x12, 3=14x14, 4=16x16, 5=20x20, 6=24x24, 7=30x30
            const sizes = [0, 10, 12, 14, 16, 20, 24, 30];
            return sizes[Math.min(window.GameState.townLevel, 7)] || 10;
        }
        return this.UNLOCKED_SIZE;
    }

    /**
     * 放置建筑到地图
     * @param {object} building - 建筑数据
     * @param {number} gridX - 起始列
     * @param {number} gridY - 起始行
     * @returns {boolean} 是否放置成功
     */
    placeBuilding(building, gridX, gridY) {
        if (!this.canPlaceBuilding(gridX, gridY, building.width, building.height)) {
            return false;
        }
        
        const newBuilding = {
            ...building,
            gridX,
            gridY,
            level: 1,
            hp: 100,
            maxHp: 100
        };
        
        this.buildings.push(newBuilding);
        
        for (let i = 0; i < building.width; i++) {
            for (let j = 0; j < building.height; j++) {
                window.GameState.grid[gridX + i][gridY + j] = 'building';
            }
        }
        
        this.render();
        return true;
    }

    /**
     * 绘制单个建筑
     * @param {CanvasRenderingContext2D} ctx - 绘图上下文
     * @param {object} building - 建筑数据
     */
    drawBuilding(ctx, building) {
        const { gridX, gridY, width, height, color, roofColor, emoji } = building;
        const heritageId = building.id || building.heritageId;

        const startTile = this.tileToScreen(gridX, gridY);
        const endTile = this.tileToScreen(gridX + width - 1, gridY + height - 1);

        const tileWidth = this.TILE_WIDTH;
        const tileHeight = this.TILE_HEIGHT;

        // 建筑占据的菱形区域（基于网格大小）
        const widthPx = width * tileWidth;
        const heightPx = height * tileHeight;

        const centerX = (startTile.x + endTile.x) / 2;
        // 修复：topY 应为地块顶角（中心y - halfH），原 +halfH 导致建筑下移半格
        const halfH = this.TILE_HEIGHT / 2;
        const bottomY = Math.max(startTile.y, endTile.y) + halfH;
        const topY = Math.min(startTile.y, endTile.y) - halfH;
        const midY = (topY + bottomY) / 2;

        const depth = gridX + gridY;

        // 统一墙体高度，所有建筑一样高
        const wallHeight = 30;

        // ===== 阶段八：优先使用图片渲染，失败回退 Canvas =====
        const imgKey = heritageId ? 'building-' + heritageId : null;
        const useImage = imgKey && window.AssetLoader && window.AssetLoader.has(imgKey);

        ctx.save();

        // 选中高亮（绿色半透明菱形，绘制在建筑下方）
        if (building.selected) {
            ctx.fillStyle = 'rgba(80, 220, 100, 0.35)';
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY + 4);
            ctx.lineTo(centerX + widthPx / 2, midY + 4);
            ctx.lineTo(centerX, topY + 4);
            ctx.lineTo(centerX - widthPx / 2, midY + 4);
            ctx.closePath();
            ctx.fill();
        }

        if (useImage) {
            const img = window.AssetLoader.get(imgKey);
            // 视锥剔除：图片完整在画布外则跳过
            if (img && this._isVisible(centerX, bottomY, widthPx)) {
                // 修复悬浮：菱形接触阴影，紧贴地块边缘，前重后轻
                ctx.save();
                const halfW = widthPx / 2;
                const halfH = this.TILE_HEIGHT / 2 * height;
                // 外层柔和阴影（大范围淡影）
                ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
                ctx.filter = 'blur(6px)';
                ctx.beginPath();
                ctx.moveTo(centerX, bottomY - halfH - 2);
                ctx.lineTo(centerX + halfW + 3, midY);
                ctx.lineTo(centerX, bottomY + 3);
                ctx.lineTo(centerX - halfW - 3, midY);
                ctx.closePath();
                ctx.fill();
                // 内层接触阴影（贴紧建筑底部，前暗后亮）
                ctx.filter = 'blur(2px)';
                const shadowGrad = ctx.createLinearGradient(centerX, midY, centerX, bottomY);
                shadowGrad.addColorStop(0, 'rgba(0, 0, 0, 0.15)');
                shadowGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.35)');
                shadowGrad.addColorStop(1, 'rgba(0, 0, 0, 0.50)');
                ctx.fillStyle = shadowGrad;
                ctx.beginPath();
                ctx.moveTo(centerX, bottomY - halfH);
                ctx.lineTo(centerX + halfW * 0.85, midY);
                ctx.lineTo(centerX, bottomY);
                ctx.lineTo(centerX - halfW * 0.85, midY);
                ctx.closePath();
                ctx.fill();
                ctx.filter = 'none';
                ctx.restore();

                // 修复：图片宽度=地块宽度，底部对齐地块底角
                const drawW = widthPx;
                const drawH = drawW * (img.height / img.width);
                const drawX = centerX - drawW / 2;
                const drawY = bottomY - drawH;

                ctx.drawImage(img, drawX, drawY, drawW, drawH);

                // 升级金色光效（持续 0.5s）
                if (building._upgradeFxTimer && building._upgradeFxTimer > 0) {
                    ctx.globalCompositeOperation = 'overlay';
                    ctx.fillStyle = 'rgba(255, 200, 50, 0.4)';
                    ctx.fillRect(drawX, drawY, drawW, drawH);
                    ctx.globalCompositeOperation = 'source-over';
                    // 同步播放金色粒子（由 effects-engine UpgradeFx 负责，此处只做滤镜）
                }
            }
        } else {
            // ===== 回退：原有 Canvas 三层绘制（阴影->主体->屋顶） =====
            // 菱形接触阴影
            ctx.save();
            const halfW2 = widthPx / 2;
            const halfH2 = this.TILE_HEIGHT / 2 * height;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
            ctx.filter = 'blur(6px)';
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY - halfH2 - 2);
            ctx.lineTo(centerX + halfW2 + 3, midY);
            ctx.lineTo(centerX, bottomY + 3);
            ctx.lineTo(centerX - halfW2 - 3, midY);
            ctx.closePath();
            ctx.fill();
            ctx.filter = 'blur(2px)';
            const sg = ctx.createLinearGradient(centerX, midY, centerX, bottomY);
            sg.addColorStop(0, 'rgba(0, 0, 0, 0.15)');
            sg.addColorStop(0.7, 'rgba(0, 0, 0, 0.35)');
            sg.addColorStop(1, 'rgba(0, 0, 0, 0.50)');
            ctx.fillStyle = sg;
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY - halfH2);
            ctx.lineTo(centerX + halfW2 * 0.85, midY);
            ctx.lineTo(centerX, bottomY);
            ctx.lineTo(centerX - halfW2 * 0.85, midY);
            ctx.closePath();
            ctx.fill();
            ctx.filter = 'none';
            ctx.restore();

            // 建筑底座（菱形顶面）
            ctx.fillStyle = this._darkenColor(color, 30);
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY);
            ctx.lineTo(centerX + widthPx / 2, midY);
            ctx.lineTo(centerX, topY);
            ctx.lineTo(centerX - widthPx / 2, midY);
            ctx.closePath();
            ctx.fill();

            // 前侧面（统一高度）
            ctx.fillStyle = this._darkenColor(color, 10);
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY);
            ctx.lineTo(centerX + widthPx / 2, midY);
            ctx.lineTo(centerX + widthPx / 2, midY - wallHeight);
            ctx.lineTo(centerX, bottomY - wallHeight);
            ctx.closePath();
            ctx.fill();

            // 左侧面（统一高度）
            ctx.fillStyle = this._darkenColor(color, 25);
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY);
            ctx.lineTo(centerX - widthPx / 2, midY);
            ctx.lineTo(centerX - widthPx / 2, midY - wallHeight);
            ctx.lineTo(centerX, bottomY - wallHeight);
            ctx.closePath();
            ctx.fill();

            // 屋顶（菱形，统一高度）
            ctx.fillStyle = roofColor;
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY - wallHeight);
            ctx.lineTo(centerX + widthPx / 2, midY - wallHeight);
            ctx.lineTo(centerX, topY - wallHeight);
            ctx.lineTo(centerX - widthPx / 2, midY - wallHeight);
            ctx.closePath();
            ctx.fill();

            // 屋顶阴影
            ctx.fillStyle = this._darkenColor(roofColor, 15);
            ctx.beginPath();
            ctx.moveTo(centerX, bottomY - wallHeight);
            ctx.lineTo(centerX - widthPx / 2, midY - wallHeight);
            ctx.lineTo(centerX, topY - wallHeight);
            ctx.closePath();
            ctx.fill();

            // emoji 图标（回退时显示）
            ctx.font = '32px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji, centerX, midY - wallHeight / 2);
        }

        ctx.restore();

        return depth;
    }

    /** 视锥剔除：判断建筑是否在可视区域内 */
    _isVisible(centerX, bottomY, widthPx) {
        if (!this.canvas) return true;
        const margin = widthPx;
        return centerX + margin > 0 &&
               centerX - margin < this.canvas.width &&
               bottomY + margin > 0 &&
               bottomY - margin * 2 < this.canvas.height;
    }

    /**
     * 预加载瓦片纹理
     * @private
     */
    _loadTileTextures() {
        if (this._tileTextures) return;
        this._tileTextures = {};
        const tiles = {
            cobblestone: 'assets/images/tiles/cobblestone.jpg',
            grass: 'assets/images/tiles/grass.jpg',
            dirt: 'assets/images/tiles/dirt.jpg'
        };
        for (const [name, src] of Object.entries(tiles)) {
            const img = new Image();
            img.src = src;
            this._tileTextures[name] = img;
        }
        // 根据格子位置选择纹理的映射表（16x16 网格分区）
        this._tileLayout = null; // 将在 drawGrid 时按需生成
    }

    /**
     * 根据格子坐标获取纹理类型
     * @private
     */
    _getTileType(col, row) {
        // 全部统一为古镇青石板地砖
        return 'cobblestone';
    }

    /**
     * 绘制网格（经典等距菱形地块 — 纹理增强版）
     */
    drawGrid() {
        const ctx = this.ctx;
        const halfW = this.TILE_WIDTH / 2;
        const halfH = this.TILE_HEIGHT / 2;
        
        if (!this._tileTextures) this._loadTileTextures();
        
        for (let col = 0; col < this.GRID_SIZE; col++) {
            for (let row = 0; row < this.GRID_SIZE; row++) {
                const { x, y } = this.tileToScreen(col, row);
                
                // 菱形裁剪路径
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, y - halfH);
                ctx.lineTo(x + halfW, y);
                ctx.lineTo(x, y + halfH);
                ctx.lineTo(x - halfW, y);
                ctx.closePath();
                ctx.clip();
                
                // 尝试绘制纹理图
                const tileType = this._getTileType(col, row);
                const tex = this._tileTextures[tileType];
                const isEven = (col + row) % 2 === 0;
                
                if (tex && tex.complete && tex.naturalWidth > 0) {
                    // 绘制纹理图，拉伸至菱形外接矩形
                    ctx.drawImage(tex, x - halfW, y - halfH, this.TILE_WIDTH, this.TILE_HEIGHT);
                    // 奇偶格微调亮度，营造层次
                    if (!isEven) {
                        ctx.fillStyle = 'rgba(60, 36, 21, 0.08)';
                        ctx.fillRect(x - halfW, y - halfH, this.TILE_WIDTH, this.TILE_HEIGHT);
                    }
                } else {
                    // 纹理未加载完成时回退纯色
                    ctx.fillStyle = isEven ? '#E8D9B8' : '#DCC9A0';
                    ctx.fillRect(x - halfW, y - halfH, this.TILE_WIDTH, this.TILE_HEIGHT);
                }
                
                ctx.restore();
                
                // 网格线（低透明度，仅建造模式下更清晰）
                ctx.strokeStyle = 'rgba(60, 36, 21, 0.12)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, y - halfH);
                ctx.lineTo(x + halfW, y);
                ctx.lineTo(x, y + halfH);
                ctx.lineTo(x - halfW, y);
                ctx.closePath();
                ctx.stroke();

                // 未解锁区域绘制雾罩
                const unlocked = this.getUnlockedSize();
                if (col >= unlocked || row >= unlocked) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x, y - halfH);
                    ctx.lineTo(x + halfW, y);
                    ctx.lineTo(x, y + halfH);
                    ctx.lineTo(x - halfW, y);
                    ctx.closePath();
                    ctx.fillStyle = 'rgba(40, 30, 20, 0.6)';
                    ctx.fill();
                    ctx.restore();
                }
            }
        }

        // 绘制解锁边界标识
        const unlocked = this.getUnlockedSize();
        if (unlocked < this.GRID_SIZE) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 215, 0, 0.4)';
            ctx.lineWidth = 2;
            ctx.setLineDash([8, 4]);
            for (let i = 0; i < unlocked; i++) {
                // 右边界
                const p1 = this.tileToScreen(unlocked, i);
                const p2 = this.tileToScreen(unlocked, i + 1);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();
                // 下边界
                const p3 = this.tileToScreen(i, unlocked);
                const p4 = this.tileToScreen(i + 1, unlocked);
                ctx.beginPath();
                ctx.moveTo(p3.x, p3.y);
                ctx.lineTo(p4.x, p4.y);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    /**
     * 绘制背景（渐变 + 远景雾效 + 暗角）
     */
    drawBackground() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // === 自然草地背景（部落冲突/开心商店风格） ===
        // 1. 基础绿色渐变（中心亮、边缘暗，形成视觉焦点）
        const cx = w / 2, cy = h * 0.45;
        const radialGrad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.15, cx, cy, Math.max(w, h) * 0.75);
        radialGrad.addColorStop(0, '#6db84e');
        radialGrad.addColorStop(0.4, '#5aa83e');
        radialGrad.addColorStop(0.7, '#4a9430');
        radialGrad.addColorStop(1, '#3a7a22');
        ctx.fillStyle = radialGrad;
        ctx.fillRect(0, 0, w, h);

        // 2. 草地纹理（只画一层，低透明度，避免重复感）
        const grassTex = this._tileTextures && this._tileTextures.grass;
        if (grassTex && grassTex.complete && grassTex.naturalWidth > 0) {
            ctx.globalAlpha = 0.35;
            // 随机偏移绘制几个大块，而不是网格平铺
            const blobs = 8;
            for (let i = 0; i < blobs; i++) {
                const bx = (i / blobs) * w + Math.sin(i * 4.3) * w * 0.1;
                const by = Math.sin(i * 2.7) * h * 0.3 + h * 0.4;
                const bs = 200 + Math.sin(i * 3.1) * 80;
                ctx.drawImage(grassTex, bx - bs / 2, by - bs / 2, bs, bs);
            }
            ctx.globalAlpha = 1;
        }

        // 3. 随机草丛点缀（小绿点，增加层次感）
        ctx.save();
        let seed = 42;
        const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        for (let i = 0; i < 60; i++) {
            const gx = rand() * w;
            const gy = rand() * h;
            const gs = 3 + rand() * 5;
            const hue = 90 + rand() * 30;
            const lit = 35 + rand() * 20;
            ctx.fillStyle = `hsla(${hue}, 50%, ${lit}%, 0.4)`;
            ctx.beginPath();
            ctx.ellipse(gx, gy, gs, gs * 0.6, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // 4. 暗角（vignette，让中心更突出）
        const vignette = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.7);
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);

        // 5. 远景树林剪影（顶部，淡淡的）
        ctx.save();
        ctx.fillStyle = 'rgba(25, 50, 20, 0.3)';
        for (let i = 0; i < 10; i++) {
            const tx = (i / 10) * w + Math.sin(i * 3.7) * 30;
            const ty = h * 0.04 + Math.sin(i * 2.3) * 6;
            const tw = 50 + Math.sin(i * 5.1) * 15;
            ctx.beginPath();
            ctx.arc(tx, ty, tw, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();

        // === 围墙外竹林带（上下边缘） ===
        ctx.save();
        // 上边缘竹林剪影
        ctx.fillStyle = 'rgba(60, 80, 50, 0.3)';
        this._drawBambooSilhouette(ctx, w, h * 0.08, true);
        // 下边缘竹林剪影
        ctx.fillStyle = 'rgba(50, 70, 40, 0.35)';
        this._drawBambooSilhouette(ctx, w, h * 0.92, false);
        ctx.restore();

        // === 水面波光（底部河流） ===
        ctx.save();
        const waterGrad = ctx.createLinearGradient(0, h * 0.88, 0, h);
        waterGrad.addColorStop(0, 'rgba(100, 130, 150, 0.2)');
        waterGrad.addColorStop(1, 'rgba(80, 110, 130, 0.35)');
        ctx.fillStyle = waterGrad;
        ctx.fillRect(0, h * 0.88, w, h * 0.12);
        // 水面波纹
        ctx.strokeStyle = 'rgba(180, 200, 210, 0.15)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            const y = h * 0.90 + i * (h * 0.02);
            ctx.moveTo(0, y);
            for (let x = 0; x < w; x += 20) {
                ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 2);
            }
            ctx.stroke();
        }
        ctx.restore();

        // === 暗角效果（四周加深，聚焦中心） ===
        const vignette = ctx.createRadialGradient(w/2, h/2, Math.min(w, h) * 0.3, w/2, h/2, Math.max(w, h) * 0.75);
        vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
        vignette.addColorStop(1, 'rgba(50, 30, 15, 0.25)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
    }

    /**
     * 绘制层叠远山轮廓（水墨风格）
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w - 画布宽
     * @param {number} h - 画布高
     * @param {number} baseY - 山脚基线 Y
     * @param {number} scale - 缩放
     * @param {number} maxHeight - 最大山高
     */
    _drawDistantMountains(ctx, w, h, baseY, scale, maxHeight) {
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        const peaks = Math.ceil(w / 150);
        for (let i = 0; i <= peaks; i++) {
            const x = (i / peaks) * w;
            // 用正弦+随机扰动模拟山脊起伏
            const seed = i * 7.3;
            const peakHeight = (Math.sin(seed) * 0.3 + 0.7) * maxHeight * scale;
            const valley = peakHeight * 0.3;
            ctx.lineTo(x - w / peaks / 2, baseY - peakHeight);
            ctx.lineTo(x, baseY - valley);
        }
        ctx.lineTo(w, baseY);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * 绘制竹林剪影（围墙外竹林带）
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} w - 画布宽
     * @param {number} baseY - 竹林基线 Y
     * @param {boolean} isTop - 是否在顶部
     */
    _drawBambooSilhouette(ctx, w, baseY, isTop) {
        const stemCount = Math.ceil(w / 12);
        for (let i = 0; i < stemCount; i++) {
            const x = (i / stemCount) * w + (Math.sin(i * 5.1) * 3);
            const height = 25 + Math.abs(Math.sin(i * 3.7)) * 35;
            const direction = isTop ? 1 : -1;
            // 竹竿
            ctx.fillRect(x, baseY, 2, height * direction);
            // 竹叶簇（简化为小三角）
            ctx.beginPath();
            for (let j = 0; j < 3; j++) {
                const leafY = baseY + (height * 0.3 + j * height * 0.2) * direction;
                ctx.moveTo(x, leafY);
                ctx.lineTo(x - 8, leafY + 3 * direction);
                ctx.lineTo(x + 8, leafY + 3 * direction);
                ctx.closePath();
            }
            ctx.fill();
        }
    }

    /**
     * 预加载装饰物纹理
     * @private
     */
    _loadDecorations() {
        if (this._decoTextures) return;
        this._decoTextures = {};
        const V = 'v84';
        const decos = {
            'pine-tree': `assets/images/decorations/pine-tree.png?${V}`,
            'willow-tree': `assets/images/decorations/willow-tree.png?${V}`,
            'stone-lantern': `assets/images/decorations/stone-lantern.png?${V}`,
            'stone-well': `assets/images/decorations/stone-well.png?${V}`,
            'bamboo': `assets/images/decorations/bamboo.png?${V}`,
            'rock': `assets/images/decorations/rock.png?${V}`,
            'plum-tree': `assets/images/decorations/plum-tree.png?${V}`,
            'lotus-pond': `assets/images/decorations/lotus-pond.png?${V}`,
            'stone-bridge': `assets/images/decorations/stone-bridge.png?${V}`,
            'wooden-pavilion': `assets/images/decorations/wooden-pavilion.png?${V}`,
            'stone-lion': `assets/images/decorations/stone-lion.png?${V}`,
            'red-lantern': `assets/images/decorations/red-lantern.png?${V}`
        };
        for (const [name, src] of Object.entries(decos)) {
            const img = new Image();
            img.src = src;
            this._decoTextures[name] = img;
        }
        // 生成装饰物布局（只在首次生成，固定位置）
        this._decoLayout = this._generateDecoLayout();
    }

    /**
     * 生成装饰物布局（地图边缘和角落随机放置）
     * @private
     */
    _generateDecoLayout() {
        const layout = [];
        const G = this.GRID_SIZE;
        const unlocked = this.getUnlockedSize();
        // 用确定性随机（种子）保证每次刷新位置一致
        let seed = 12345;
        const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

        const types = ['pine-tree', 'willow-tree', 'stone-lantern', 'stone-well', 'bamboo', 'rock', 'plum-tree', 'lotus-pond', 'stone-bridge', 'wooden-pavilion', 'stone-lion', 'red-lantern'];
        const sizes = { 'pine-tree': 0.9, 'willow-tree': 1.0, 'stone-lantern': 0.5, 'stone-well': 0.6, 'bamboo': 0.8, 'rock': 0.5, 'plum-tree': 0.9, 'lotus-pond': 0.7, 'stone-bridge': 0.8, 'wooden-pavilion': 0.9, 'stone-lion': 0.5, 'red-lantern': 0.4 };

        // 装饰物随机散布在整个地图（包括解锁区域内空地），标记为非功能性
        // 先收集已占用的格子（建筑+路径），装饰物避开这些位置
        const occupied = new Set();
        if (this.buildings) {
            this.buildings.forEach(b => {
                for (let dx = 0; dx < b.width; dx++) {
                    for (let dy = 0; dy < b.height; dy++) {
                        occupied.add((b.gridX + dx) + ',' + (b.gridY + dy));
                    }
                }
            });
        }

        for (let i = 0; i < 80; i++) {
            // 随机散布在整个地图范围
            const col = Math.floor(rand() * G);
            const row = Math.floor(rand() * G);

            // 避开已占用格子（建筑位置）
            if (occupied.has(col + ',' + row)) continue;
            // 避开中心建造区域核心（留出玩家操作空间）
            const center = Math.floor(unlocked / 2);
            if (col >= center - 1 && col <= center + 2 && row >= center - 1 && row <= center + 2) continue;

            const type = types[Math.floor(rand() * types.length)];
            layout.push({
                col, row, type,
                scale: sizes[type] * (0.85 + rand() * 0.3),
                offsetX: (rand() - 0.5) * 20,
                offsetY: (rand() - 0.5) * 10,
                isDecoration: true  // 标记为纯装饰，无功能
            });
        }
        // 过滤掉已拆除的障碍物（从 GameState.removedObstacles 读取）
        const removed = (window.GameState && window.GameState.removedObstacles) ? window.GameState.removedObstacles : [];
        if (removed.length > 0) {
            return layout.filter(d => !removed.some(r => r.col === d.col && r.row === d.row));
        }
        return layout;
    }

    /**
     * 绘制装饰物
     */
    drawDecorations() {
        if (!this._decoTextures) this._loadDecorations();
        const ctx = this.ctx;
        const halfW = this.TILE_WIDTH / 2;

        // 按深度排序（row+col 越小越靠后）
        const sorted = [...this._decoLayout].sort((a, b) => (a.col + a.row) - (b.col + b.row));

        for (const deco of sorted) {
            const tex = this._decoTextures[deco.type];
            if (!tex || !tex.complete || tex.naturalWidth === 0) continue;

            const { x, y } = this.tileToScreen(deco.col, deco.row);
            // 增大装饰物尺寸，让它们更醒目
            const drawW = this.TILE_WIDTH * deco.scale * 1.6;
            const drawH = drawW * (tex.height / tex.width);
            const drawX = x - drawW / 2 + deco.offsetX;
            const drawY = y - drawH + this.TILE_HEIGHT / 2 + deco.offsetY;

            // 视锥剔除
            if (drawX + drawW < -50 || drawX > this.canvas.width + 50 || drawY + drawH < -50 || drawY > this.canvas.height + 50) continue;

            // 装饰物投影（菱形接触阴影，与建筑风格统一）
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.filter = 'blur(2px)';
            const shW = drawW * 0.35;
            const shH = shW * 0.4;
            ctx.beginPath();
            ctx.ellipse(x + deco.offsetX, y + this.TILE_HEIGHT / 2 + deco.offsetY + 2, shW, shH, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.filter = 'none';
            ctx.restore();

            // 绘制装饰物（确保透明背景正确渲染）
            ctx.drawImage(tex, drawX, drawY, drawW, drawH);
        }
    }

    /**
     * 渲染整个地图
     */
    render() {
        if (!this.ctx) return;
        
        this.drawBackground();
        this.drawGrid();
        this.drawDecorations();
        
        // NPC小人系统
        this._updateAndDrawNPCs();
        
        const sortedBuildings = [...this.buildings].sort((a, b) => {
            const depthA = a.gridX + a.gridY;
            const depthB = b.gridX + b.gridY;
            return depthA - depthB;
        });
        
        sortedBuildings.forEach(building => {
            this.drawBuilding(this.ctx, building);
        });

        // 阶段八：叠加昼夜遮罩（仅覆盖 Canvas，不影响 DOM UI）
        if (window.DayNightCycle && typeof DayNightCycle.getOverlay === 'function') {
            const overlay = DayNightCycle.getOverlay();
            if (overlay && overlay.alpha > 0.01) {
                this.ctx.save();
                this.ctx.globalCompositeOperation = 'source-over';
                this.ctx.fillStyle = overlay.color;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.restore();
            }
        }
    }

    /**
     * 根据坐标获取建筑
     * @param {number} gridX - 列坐标
     * @param {number} gridY - 行坐标
     * @returns {object|null} 建筑对象或null
     */
    getBuildingAt(gridX, gridY) {
        return this.buildings.find(building => {
            return gridX >= building.gridX && gridX < building.gridX + building.width &&
                   gridY >= building.gridY && gridY < building.gridY + building.height;
        }) || null;
    }

    /**
     * 移除建筑
     * @param {string} buildingId - 建筑ID
     */
    removeBuilding(buildingId) {
        const index = this.buildings.findIndex(b => b.id === buildingId);
        if (index !== -1) {
            const building = this.buildings[index];
            for (let i = 0; i < building.width; i++) {
                for (let j = 0; j < building.height; j++) {
                    window.GameState.grid[building.gridX + i][building.gridY + j] = 'empty';
                }
            }
            this.buildings.splice(index, 1);
            this.render();
        }
    }

    /**
     * 使颜色变暗
     * @param {string} color - 原始颜色
     * @param {number} percent - 变暗百分比
     * @returns {string} 变暗后的颜色
     */
    _darkenColor(color, percent) {
        const num = parseInt(color.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max((num >> 16) - amt, 0);
        const G = Math.max((num >> 8 & 0x00FF) - amt, 0);
        const B = Math.max((num & 0x0000FF) - amt, 0);
        return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
    }

    /**
     * 销毁地图实例
     */
    destroy() {
        window.removeEventListener('resize', this.resizeHandler);
        if (this.canvas) {
            this.canvas.removeEventListener('click', this.clickHandler);
        }
    }

    /**
     * 获取所有建筑
     * @returns {Array} 建筑数组
     */
    getBuildings() {
        return this.buildings;
    }

    // ===== NPC小人系统 =====
    _initNPCs() {
        if (this._npcs) return;
        this._npcs = [];
        this._npcColors = ['#E8C264', '#C41E3A', '#4A7C59', '#2F4F4F', '#8B4513', '#D4A84D', '#6B9CA0', '#CD853F'];
        this._npcLastSpawn = 0;
        this._npcMaxCount = 6;
    }

    _spawnNPC() {
        if (!this._npcs) this._initNPCs();
        if (this._npcs.length >= this._npcMaxCount) return;
        const unlocked = this.getUnlockedSize();
        const buildings = this.buildings.filter(b => b.placed !== false);
        if (buildings.length === 0) return;

        // 随机选一个建筑作为目标
        const targetB = buildings[Math.floor(Math.random() * buildings.length)];
        const startX = Math.floor(Math.random() * unlocked);
        const startY = Math.floor(Math.random() * unlocked);

        this._npcs.push({
            id: Math.random(),
            x: startX, y: startY,           // 当前格子坐标（浮点）
            targetX: targetB.gridX, targetY: targetB.gridY,
            targetBuilding: targetB,
            speed: 0.015 + Math.random() * 0.01,
            color: this._npcColors[Math.floor(Math.random() * this._npcColors.length)],
            state: 'walking',               // walking / consuming / leaving
            consumeTime: 0,
            bobOffset: 0,
            facing: 1
        });
    }

    _updateAndDrawNPCs() {
        if (!this._npcs) this._initNPCs();
        const ctx = this.ctx;
        if (!ctx) return;

        // 定期生成新NPC
        const now = performance.now();
        if (now - this._npcLastSpawn > 3000 + Math.random() * 4000) {
            this._spawnNPC();
            this._npcLastSpawn = now;
        }

        this._npcs = this._npcs.filter(npc => {
            // 更新状态
            if (npc.state === 'walking') {
                const dx = npc.targetX - npc.x;
                const dy = npc.targetY - npc.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 0.3) {
                    npc.state = 'consuming';
                    npc.consumeTime = now;
                } else {
                    npc.x += (dx / dist) * npc.speed;
                    npc.y += (dy / dist) * npc.speed;
                    npc.facing = dx > 0 ? 1 : -1;
                }
                npc.bobOffset = Math.sin(now * 0.008) * 2;
            } else if (npc.state === 'consuming') {
                if (now - npc.consumeTime > 2000 + Math.random() * 2000) {
                    npc.state = 'leaving';
                    // 设置离开目标（地图边缘随机点）
                    npc.targetX = Math.random() < 0.5 ? -2 : this.GRID_SIZE + 1;
                    npc.targetY = Math.floor(Math.random() * this.GRID_SIZE);
                }
                npc.bobOffset = 0;
            } else if (npc.state === 'leaving') {
                const dx = npc.targetX - npc.x;
                const dy = npc.targetY - npc.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 0.5 || npc.x < -1 || npc.x > this.GRID_SIZE + 1) {
                    return false; // 移除NPC
                }
                npc.x += (dx / dist) * npc.speed;
                npc.y += (dy / dist) * npc.speed;
                npc.facing = dx > 0 ? 1 : -1;
                npc.bobOffset = Math.sin(now * 0.008) * 2;
            }

            // 绘制NPC
            const screen = this.tileToScreen(npc.x, npc.y);
            const px = screen.x + this.offsetX;
            const py = screen.y + this.offsetY + npc.bobOffset;

            ctx.save();
            // 阴影
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath();
            ctx.ellipse(px, py + 2, 5, 2, 0, 0, Math.PI * 2);
            ctx.fill();
            // 身体（Q版小人：圆头+梯形身）
            const bodyColor = npc.color;
            const headR = 4;
            // 身体
            ctx.fillStyle = bodyColor;
            ctx.beginPath();
            ctx.moveTo(px - 3, py + headR);
            ctx.lineTo(px + 3, py + headR);
            ctx.lineTo(px + 4, py + headR + 8);
            ctx.lineTo(px - 4, py + headR + 8);
            ctx.closePath();
            ctx.fill();
            // 头
            ctx.fillStyle = '#FFDAB9';
            ctx.beginPath();
            ctx.arc(px, py, headR, 0, Math.PI * 2);
            ctx.fill();
            // 眼睛
            ctx.fillStyle = '#333';
            const eyeOffset = npc.facing > 0 ? 1 : -1;
            ctx.fillRect(px - 1 + eyeOffset, py - 1, 1.2, 1.2);
            ctx.fillRect(px + 1 + eyeOffset, py - 1, 1.2, 1.2);
            // 消费中显示金币图标
            if (npc.state === 'consuming') {
                ctx.fillStyle = '#FFD700';
                ctx.font = '10px serif';
                ctx.textAlign = 'center';
                ctx.fillText('💰', px, py - 8);
            }
            ctx.restore();

            return true;
        });
    }
}

// 创建实例
const isometricMapInstance = new IsometricMapEngine();

// 立即赋值到 window，确保全局可访问
window.IsometricMap = isometricMapInstance;

// 立即初始化（script 在 body 底部，DOM 已加载）
try {
    isometricMapInstance.init('map-container');
    console.log('IsometricMap 立即初始化完成');
} catch (e) {
    console.error('IsometricMap 初始化失败:', e);
}