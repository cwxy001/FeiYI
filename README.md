# 非遗古镇 (FeiYiGuZhen)

非遗文化主题的等距经营模拟 + 塔防游戏。以中国十二时辰为关卡骨架，融合 24 项非物质文化遗产工坊、Roguelike 遗物系统、PVP 对战等玩法。

## 技术栈

- 纯原生 HTML5 Canvas + JavaScript（无框架）
- Canvas 2D 等距渲染引擎
- Lottie 动画 + CSS 特效
- localStorage 持久化存档
- Vitest 单元测试

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
# 打开 http://localhost:8080

# 运行测试
npm test
```

## 目录结构

```
FeiYiGuZhen/
├── index.html                # 入口页面
├── css/
│   └── style.css             # 全局样式
├── js/
│   ├── data.js               # 游戏数据（关卡/塔/敌人/装饰物）
│   ├── game-state.js         # 状态管理 + 存档系统
│   ├── isometric-map.js      # 等距地图引擎
│   ├── management.js         # 经营模式（建造/产出/天气/成就）
│   ├── tower-defense.js      # 塔防战斗引擎
│   ├── effects-engine.js     # 粒子特效系统
│   ├── relic-system.js       # Roguelike 遗物系统
│   ├── pvp-system.js         # PVP 对战系统
│   ├── retention-system.js   # 留存系统（日常任务/成就）
│   ├── leaderboard.js        # 排行榜
│   ├── data-integration.js   # 数据桥接层
│   ├── asset-loader.js       # 资源预加载
│   ├── audio.js              # 音频管理
│   ├── lottie-data.js        # Lottie 动画数据
│   ├── ui.js                 # UI 工具
│   ├── analytics.js          # 数据埋点
│   ├── performance.js        # 性能优化
│   └── ad-system.js          # 广告系统
├── assets/
│   ├── images/
│   │   ├── buildings/        # 工坊建筑图（24种）
│   │   ├── enemies/          # 敌人图（16种）
│   │   ├── decorations/       # 装饰物图（12种）
│   │   ├── tiles/            # 地块纹理
│   │   └── ui/               # UI 图标
│   └── lottie/               # Lottie 动画 JSON
├── scripts/                  # 美术资源生成脚本
├── tests/                    # 单元测试
├── docs/                     # 项目文档
├── package.json
└── vitest.config.js
```

## 核心系统

| 系统 | 说明 |
|------|------|
| 经营模式 | 30x30 地图，渐进解锁，工坊建造，装饰物放置，障碍拆除 |
| 塔防战斗 | 30 关主线 + 无尽模式 + 3 种特殊关卡，12 路径类型 |
| 防御塔 | 24 种非遗工坊塔，各具独特攻击机制（溅射/穿透/减速/多目标等） |
| 遗物系统 | 17 个局内遗物 + 5 个永久遗物，三选一抽取 |
| 合并系统 | 4 条合并规则（手3/场3/手1场2/手2场1） |
| PVP | 3 模式（攻守轮换/同步对战/防守竞赛），出战牌组选择 |
| 留存系统 | 每日任务、成就（29 种）、排行榜（100 AI 玩家） |
| 天气系统 | 经营天气（产出影响）+ 关卡天气（时辰匹配视觉特效） |
| 星级评定 | 1 星通关 / 2 星无损 / 3 星限时通关 |

## 美术风格

可爱萌系国风 Q 版卡通，圆润造型，柔和色彩，中国传统水墨晕染风格，透明背景。
