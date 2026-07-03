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

        // === 基础渐变背景（米黄色宣纸感） ===
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, '#D4C5A9');
        gradient.addColorStop(0.4, '#E8DCC8');
        gradient.addColorStop(1, '#C8B898');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);

        // === 远景水墨山水（层叠远山，越远越淡） ===
        ctx.save();
        // 最远层（极淡）
        ctx.fillStyle = 'rgba(160, 170, 180, 0.15)';
        this._drawDistantMountains(ctx, w, h, h * 0.15, 0.8, 120);
        // 中远层
        ctx.fillStyle = 'rgba(120, 130, 140, 0.2)';
        this._drawDistantMountains(ctx, w, h, h * 0.22, 1.0, 80);
        // 中近层
        ctx.fillStyle = 'rgba(90, 100, 110, 0.25)';
        this._drawDistantMountains(ctx, w, h, h * 0.30, 1.2, 50);
        ctx.restore();

        // === 远景雾效（山脚雾气） ===
        const fogGrad = ctx.createLinearGradient(0, h * 0.1, 0, h * 0.45);
        fogGrad.addColorStop(0, 'rgba(220, 210, 190, 0.5)');
        fogGrad.addColorStop(1, 'rgba(220, 210, 190, 0)');
        ctx.fillStyle = fogGrad;
        ctx.fillRect(0, h * 0.1, w, h * 0.35);

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
        const decos = {
            'pine-tree': 'assets/images/decorations/pine-tree.png?v=67',
            'willow-tree': 'assets/images/decorations/willow-tree.png?v=67',
            'stone-lantern': 'assets/images/decorations/stone-lantern.png?v=67',
            'stone-well': 'assets/images/decorations/stone-well.png?v=67',
            'bamboo': 'assets/images/decorations/bamboo.png?v=67',
            'rock': 'assets/images/decorations/rock.png?v=67',
            'plum-tree': 'assets/images/decorations/plum-tree.png?v=67',
            'lotus-pond': 'assets/images/decorations/lotus-pond.png?v=67',
            // #3 装饰画风统一：玩家可放置装饰物纹理（与边缘装饰物统一为国风Q版画风）
            'stone-bridge': 'assets/images/decorations/stone-bridge.jpg?v=74',
            'wooden-pavilion': 'assets/images/decorations/wooden-pavilion.jpg?v=74',
            'stone-lion': 'assets/images/decorations/stone-lion.jpg?v=74',
            'red-lantern': 'assets/images/decorations/red-lantern.jpg?v=74'
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

        // 四周边缘放置装饰物（在解锁范围外）—— 增加到80个
        for (let i = 0; i < 80; i++) {
            let col, row;
            const edge = Math.floor(rand() * 4);
            if (edge === 0) { col = Math.floor(rand() * G); row = Math.floor(rand() * 2); }           // 上边
            else if (edge === 1) { col = Math.floor(rand() * G); row = G - 1 - Math.floor(rand() * 2); } // 下边
            else if (edge === 2) { col = Math.floor(rand() * 2); row = Math.floor(rand() * G); }       // 左边
            else { col = G - 1 - Math.floor(rand() * 2); row = Math.floor(rand() * G); }               // 右边

            // 避开已解锁区域（让装饰物在解锁范围外）
            if (col < unlocked && row < unlocked) continue;

            const type = types[Math.floor(rand() * types.length)];
            layout.push({
                col, row, type,
                scale: sizes[type] * (0.85 + rand() * 0.3),
                offsetX: (rand() - 0.5) * 20,
                offsetY: (rand() - 0.5) * 10
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
            const drawW = this.TILE_WIDTH * deco.scale * 1.3;
            const drawH = drawW * (tex.height / tex.width);
            const drawX = x - drawW / 2 + deco.offsetX;
            const drawY = y - drawH + this.TILE_HEIGHT / 2 + deco.offsetY;

            // 视锥剔除
            if (drawX + drawW < 0 || drawX > this.canvas.width || drawY + drawH < 0 || drawY > this.canvas.height) continue;

            // 装饰物投影
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.filter = 'blur(3px)';
            ctx.beginPath();
            ctx.ellipse(x + deco.offsetX, y + this.TILE_HEIGHT / 2 + deco.offsetY, drawW * 0.3, drawW * 0.15, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.filter = 'none';
            ctx.restore();

            // 绘制装饰物
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