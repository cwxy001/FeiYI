/* 
 * ui.js - UI工具函数
 * 功能：提供弹窗显示/隐藏、元素创建、Toast提示、飘浮文字等UI工具
 * 日期：2026-06-22
 */

const UI = {
    /**
     * 显示弹窗
     * @param {string} modalId - 弹窗元素ID
     */
    showModal(modalId) {
        // 先关闭所有其他弹窗（互斥）—— 同时处理 modal 和 modal-panel
        document.querySelectorAll('.modal, .modal-panel').forEach(m => {
            if (m.id !== modalId) {
                m.classList.add('hidden');
            }
        });
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
            // 阶段六：弹窗打开音效
            if (window.AudioManager) window.AudioManager.playSound('modal-open', 0.8);
        }
    },

    /**
     * 隐藏弹窗
     * @param {string} modalId - 弹窗元素ID
     */
    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = '';
            // 阶段六：弹窗关闭音效
            if (window.AudioManager) window.AudioManager.playSound('modal-close', 0.8);
        }
    },

    /**
     * 创建DOM元素
     * @param {string} tag - 标签名
     * @param {string} className - CSS类名
     * @param {string} textContent - 文本内容
     * @returns {HTMLElement} 创建的元素
     */
    createElement(tag, className, textContent) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (textContent) {
            element.textContent = textContent;
        }
        return element;
    },

    /**
     * 显示Toast提示
     * @param {string} message - 提示消息
     * @param {number} duration - 显示时长（毫秒），默认2000
     * @param {string} type - 类型（success/error/info），默认info
     */
    showToast(message, duration = 2000, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) {
            console.error('Toast容器不存在');
            return;
        }

        const toast = this.createElement('div', `toast ${type}`, message);
        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, duration);
    },

    /**
     * 显示飘浮文字效果
     * @param {number} x - 起始X坐标
     * @param {number} y - 起始Y坐标
     * @param {string} text - 文字内容
     * @param {string} color - 文字颜色，默认金色
     */
    showFloatingText(x, y, text, color = '#FFD700') {
        const floatingText = this.createElement('span', 'floating-text', text);
        floatingText.style.left = `${x}px`;
        floatingText.style.top = `${y}px`;
        floatingText.style.color = color;
        
        document.body.appendChild(floatingText);

        setTimeout(() => {
            floatingText.remove();
        }, 1000);
    },

    /**
     * 更新资源显示
     * @param {object} resources - 资源对象
     */
    updateResources(resources) {
        const coinsEl = document.getElementById('coins-value');
        const inspirationEl = document.getElementById('inspiration-value');
        const scrollsEl = document.getElementById('scrolls-value');
        const popularityEl = document.getElementById('popularity-value');

        if (coinsEl && resources.coins !== undefined) {
            coinsEl.textContent = resources.coins;
        }
        if (inspirationEl && resources.inspiration !== undefined) {
            inspirationEl.textContent = resources.inspiration;
        }
        if (scrollsEl && resources.scrolls !== undefined) {
            scrollsEl.textContent = resources.scrolls;
        }
        if (popularityEl && resources.popularity !== undefined) {
            popularityEl.textContent = resources.popularity;
        }
    },

    /**
     * 创建星星评级显示
     * @param {number} stars - 星星数量（1-5）
     * @returns {HTMLElement} 星星元素
     */
    createStarRating(stars) {
        const rating = this.createElement('div', 'star-rating');
        for (let i = 0; i < 5; i++) {
            const star = this.createElement('span', 'star');
            star.textContent = i < stars ? '★' : '☆';
            star.style.color = i < stars ? '#FFD700' : '#8B7355';
            rating.appendChild(star);
        }
        return rating;
    },

    /**
     * 清空元素内容
     * @param {string} elementId - 元素ID
     */
    clearElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.innerHTML = '';
        }
    },

    /**
     * 添加点击事件监听器
     * @param {string} elementId - 元素ID
     * @param {Function} handler - 事件处理函数
     */
    addClickListener(elementId, handler) {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener('click', handler);
            return () => {
                element.removeEventListener('click', handler);
            };
        }
        return null;
    },

    /**
     * 设置元素显示/隐藏
     * @param {string} elementId - 元素ID
     * @param {boolean} visible - 是否显示
     */
    setVisible(elementId, visible) {
        const element = document.getElementById(elementId);
        if (element) {
            if (visible) {
                element.classList.remove('hidden');
            } else {
                element.classList.add('hidden');
            }
        }
    },

    /**
     * 获取元素是否可见
     * @param {string} elementId - 元素ID
     * @returns {boolean} 是否可见
     */
    isVisible(elementId) {
        const element = document.getElementById(elementId);
        return element && !element.classList.contains('hidden');
    },

    /**
     * 资源信息数据（来源与用途）
     */
    _resourceInfoData: {
        coins: {
            icon: '💰',
            name: '铜钱',
            sources: ['工坊产出', '通关奖励', '装饰加成'],
            uses: ['建造工坊', '升级工坊', '购买装饰']
        },
        inspiration: {
            icon: '✨',
            name: '灵感',
            sources: ['通关奖励'],
            uses: ['招募传承人（消耗灵感）']
        },
        scrolls: {
            icon: '📜',
            name: '卷轴',
            sources: ['通关奖励'],
            uses: ['升级工坊（高级升级需要卷轴）']
        },
        popularity: {
            icon: '⭐',
            name: '人气',
            sources: ['击败敌人'],
            uses: ['抽卡（50人气抽一次）']
        }
    },

    /**
     * 显示资源信息 tooltip
     * @param {string} resourceType - 资源类型（coins/inspiration/scrolls/popularity）
     * @param {HTMLElement} anchorElement - 锚点元素（用于定位 tooltip）
     */
    showResourceInfo(resourceType, anchorElement) {
        const info = this._resourceInfoData[resourceType];
        if (!info) return;

        // 移除已存在的 tooltip
        const existing = document.getElementById('resource-info-tooltip');

        // 如果点击的是当前已显示的资源，则关闭（再次点击切换）
        if (existing && existing.dataset.resourceType === resourceType) {
            this._closeResourceInfo();
            return;
        }

        // 移除旧的 tooltip 及其监听器
        if (existing) {
            existing.remove();
            if (this._resourceInfoOutsideHandler) {
                document.removeEventListener('click', this._resourceInfoOutsideHandler);
                this._resourceInfoOutsideHandler = null;
            }
        }

        // 创建 tooltip
        const tooltip = this.createElement('div', 'resource-info-tooltip');
        tooltip.id = 'resource-info-tooltip';
        tooltip.dataset.resourceType = resourceType;

        tooltip.innerHTML = `
            <div class="resource-info-header">
                <span class="resource-info-icon">${info.icon}</span>
                <span class="resource-info-name">${info.name}</span>
            </div>
            <div class="resource-info-section">
                <div class="resource-info-label">来源</div>
                <ul class="resource-info-list">
                    ${info.sources.map(s => `<li>${s}</li>`).join('')}
                </ul>
            </div>
            <div class="resource-info-section">
                <div class="resource-info-label">用途</div>
                <ul class="resource-info-list">
                    ${info.uses.map(u => `<li>${u}</li>`).join('')}
                </ul>
            </div>
        `;

        document.body.appendChild(tooltip);

        // 定位：在锚点元素正下方居中
        if (anchorElement) {
            const rect = anchorElement.getBoundingClientRect();
            let left = rect.left + rect.width / 2;
            // 边界检测：避免 tooltip 超出屏幕左右边缘
            const halfWidth = 130; // max-width 260 的一半
            if (left + halfWidth > window.innerWidth - 8) {
                left = window.innerWidth - halfWidth - 8;
            }
            if (left - halfWidth < 8) {
                left = halfWidth + 8;
            }
            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${rect.bottom + 8}px`;
        }

        // 添加点击外部关闭监听（延迟绑定，避免当前点击事件立即触发关闭）
        setTimeout(() => {
            this._resourceInfoOutsideHandler = (e) => {
                if (!tooltip.contains(e.target) && (!anchorElement || !anchorElement.contains(e.target))) {
                    this._closeResourceInfo();
                }
            };
            document.addEventListener('click', this._resourceInfoOutsideHandler);
        }, 0);
    },

    /**
     * 关闭资源信息 tooltip
     */
    _closeResourceInfo() {
        const tooltip = document.getElementById('resource-info-tooltip');
        if (tooltip) tooltip.remove();
        if (this._resourceInfoOutsideHandler) {
            document.removeEventListener('click', this._resourceInfoOutsideHandler);
            this._resourceInfoOutsideHandler = null;
        }
    }
};

window.UI = UI;