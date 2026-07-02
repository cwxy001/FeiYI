/* 
 * data.js - 游戏静态数据
 * 功能：定义非遗建筑、怪物、关卡、装饰等所有静态数据
 * 版本：v1.1.0
 * 日期：2026-06-24
 * 更新：渐进式关卡难度（波次配置调整）
 */

const ICH_LIST = [
    {
        id: 'paper-cut',
        name: '剪纸',
        hour: '子时',
        region: '陕西',
        emoji: '✂️',
        description: '剪纸艺术，一把剪刀剪出万千世界',
        lore: '陕西剪纸历史悠久，每逢佳节，家家户户都贴上红彤彤的剪纸，寓意吉祥如意。',
        towerType: '多目标散射',
        towerDamage: 12,
        towerRange: 140,
        towerAttackSpeed: 1.2,
        multiTarget: 3,
        skill: { name: '万剪同花', description: '同时发射多把剪刀，对范围内敌人造成伤害', cooldown: 8 },
        width: 2,
        height: 2,
        rarity: 3,
        buildCost: 100,
        baseOutput: 5,
        upgradeCosts: [
            { coins: 150, scrolls: 1 },
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 }
        ],
        masterCost: 50,
        unlockLevel: 1,
        color: '#C41E3A',
        roofColor: '#8B0000'
    },
    {
        id: 'shadow-play',
        name: '皮影戏',
        hour: '丑时',
        region: '陕西',
        emoji: '🎭',
        description: '光影之间，演绎千古传奇',
        lore: '皮影戏又称影子戏，用灯光将皮影投射在幕布上，配以唱腔，讲述动人故事。',
        towerType: '减速控制',
        towerDamage: 10,
        towerRange: 100,
        towerAttackSpeed: 0.8,
        slowFactor: 0.5,
        slowDuration: 2,
        skill: { name: '双影傀儡', description: '召唤傀儡分身，牵制敌人行动', cooldown: 12 },
        width: 2,
        height: 3,
        rarity: 4,
        buildCost: 200,
        baseOutput: 8,
        upgradeCosts: [
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 },
            { coins: 2400, scrolls: 16 }
        ],
        masterCost: 80,
        unlockLevel: 2,
        color: '#DAA520',
        roofColor: '#B8860B'
    },
    {
        id: 'embroidery',
        name: '刺绣',
        hour: '寅时',
        region: '苏州',
        emoji: '🧵',
        description: '丝线穿梭，绣出锦绣山河',
        lore: '苏绣是中国四大名绣之一，以精细雅洁著称，一根丝线可劈成数十股使用。',
        towerType: '穿透丝线',
        towerDamage: 10,
        towerRange: 120,
        towerAttackSpeed: 1.0,
        pierce: true,
        skill: { name: '金线锁魂', description: '用金线编织护盾，保护友方建筑', cooldown: 10 },
        width: 2,
        height: 2,
        rarity: 4,
        buildCost: 200,
        baseOutput: 8,
        upgradeCosts: [
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 },
            { coins: 2400, scrolls: 16 }
        ],
        masterCost: 80,
        unlockLevel: 3,
        color: '#D4A84D',
        roofColor: '#C49B30'
    },
    {
        id: 'ceramics',
        name: '陶瓷',
        hour: '卯时',
        region: '景德镇',
        emoji: '🏺',
        description: '火与土的艺术，千年传承',
        lore: '景德镇瓷器闻名天下，青花瓷更是中国瓷器的代表，远销海外。',
        towerType: '溅射炮',
        towerDamage: 18,
        towerRange: 130,
        towerAttackSpeed: 0.9,
        splash: 50,
        skill: { name: '窑变烈焰', description: '释放窑炉火焰，对区域内敌人造成持续伤害', cooldown: 15 },
        width: 3,
        height: 2,
        rarity: 5,
        buildCost: 500,
        baseOutput: 15,
        upgradeCosts: [
            { coins: 500, scrolls: 5 },
            { coins: 1000, scrolls: 10 },
            { coins: 2000, scrolls: 20 },
            { coins: 4000, scrolls: 40 }
        ],
        masterCost: 120,
        unlockLevel: 4,
        color: '#8B4513',
        roofColor: '#A0522D'
    },
    {
        id: 'lion-dance',
        name: '舞狮',
        hour: '辰时',
        region: '广东',
        emoji: '🦁',
        description: '锣鼓喧天，醒狮起舞',
        lore: '南狮起源于广东，每逢节庆，醒狮表演总能引来阵阵喝彩，驱邪纳福。',
        towerType: '近战爆发',
        towerDamage: 18,
        towerRange: 60,
        towerAttackSpeed: 1.3,
        splash: 30,
        skill: { name: '醒狮怒吼', description: '发出怒吼，震慑周围敌人', cooldown: 8 },
        width: 3,
        height: 3,
        rarity: 4,
        buildCost: 300,
        baseOutput: 12,
        upgradeCosts: [
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 },
            { coins: 2400, scrolls: 16 }
        ],
        masterCost: 100,
        unlockLevel: 5,
        color: '#FFD700',
        roofColor: '#DAA520'
    },
    {
        id: 'peking-opera',
        name: '京剧',
        hour: '巳时',
        region: '北京',
        emoji: '🎭',
        description: '唱念做打，国粹精华',
        lore: '京剧是中国影响最大的戏曲剧种，融合唱、念、做、打，被誉为东方歌剧。',
        towerType: '暴击脸谱',
        towerDamage: 15,
        towerRange: 110,
        towerAttackSpeed: 1.3,
        critRate: 0.3,
        skill: { name: '变脸绝技', description: '快速切换脸谱，改变攻击属性', cooldown: 10 },
        width: 3,
        height: 3,
        rarity: 5,
        buildCost: 500,
        baseOutput: 15,
        upgradeCosts: [
            { coins: 500, scrolls: 5 },
            { coins: 1000, scrolls: 10 },
            { coins: 2000, scrolls: 20 },
            { coins: 4000, scrolls: 40 }
        ],
        masterCost: 120,
        unlockLevel: 6,
        color: '#C41E3A',
        roofColor: '#1E90FF'
    },
    {
        id: 'martial-arts',
        name: '武术',
        hour: '午时',
        region: '少林',
        emoji: '👊',
        description: '强身健体，弘扬武魂',
        lore: '少林武术博大精深，讲究禅武合一，是中华武术的重要流派。',
        towerType: '多段连击',
        towerDamage: 16,
        towerRange: 70,
        towerAttackSpeed: 1.5,
        critRate: 0.15,
        skill: { name: '金刚伏魔', description: '连续攻击，造成多段伤害', cooldown: 6 },
        width: 3,
        height: 3,
        rarity: 4,
        buildCost: 300,
        baseOutput: 12,
        upgradeCosts: [
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 },
            { coins: 2400, scrolls: 16 }
        ],
        masterCost: 100,
        unlockLevel: 7,
        color: '#2F4F4F',
        roofColor: '#3C2415'
    },
    {
        id: 'tea-art',
        name: '茶艺',
        hour: '未时',
        region: '福建',
        emoji: '🍵',
        description: '品茗悟道，禅茶一味',
        lore: '福建茶文化源远流长，铁观音、大红袍等名茶享誉天下。',
        towerType: '减速射线',
        towerDamage: 7,
        towerRange: 150,
        towerAttackSpeed: 1.1,
        slowFactor: 0.3,
        slowDuration: 3,
        skill: { name: '禅茶一味', description: '释放茶香，提升周围建筑攻速', cooldown: 12 },
        width: 2,
        height: 2,
        rarity: 3,
        buildCost: 100,
        baseOutput: 5,
        upgradeCosts: [
            { coins: 150, scrolls: 1 },
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 }
        ],
        masterCost: 50,
        unlockLevel: 8,
        color: '#556B2F',
        roofColor: '#6B8E23'
    },
    {
        id: 'four-treasures',
        name: '文房四宝',
        hour: '申时',
        region: '安徽',
        emoji: '✒️',
        description: '笔墨纸砚，书写千年',
        lore: '文房四宝是中国传统的书写工具，安徽的宣纸、徽墨更是闻名遐迩。',
        towerType: '法术穿透',
        towerDamage: 14,
        towerRange: 160,
        towerAttackSpeed: 1.0,
        ignoreShield: true,
        skill: { name: '泼墨成阵', description: '挥洒墨水，形成伤害区域', cooldown: 10 },
        width: 2,
        height: 2,
        rarity: 4,
        buildCost: 200,
        baseOutput: 10,
        upgradeCosts: [
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 },
            { coins: 2400, scrolls: 16 }
        ],
        masterCost: 80,
        unlockLevel: 9,
        color: '#2C2C2C',
        roofColor: '#3C2415'
    },
    {
        id: 'cuisine',
        name: '非遗美食',
        hour: '酉时',
        region: '四川',
        emoji: '🥢',
        description: '八方珍馐，美味传承',
        lore: '川菜以麻辣鲜香著称，火锅、麻辣烫更是风靡全国。',
        towerType: '全图闪电链',
        towerDamage: 12,
        towerRange: 200,
        towerAttackSpeed: 0.8,
        multiTarget: 5,
        skill: { name: '八方珍馐', description: '制作美食，为所有建筑恢复生命', cooldown: 20 },
        width: 3,
        height: 2,
        rarity: 5,
        buildCost: 500,
        baseOutput: 18,
        upgradeCosts: [
            { coins: 500, scrolls: 5 },
            { coins: 1000, scrolls: 10 },
            { coins: 2000, scrolls: 20 },
            { coins: 4000, scrolls: 40 }
        ],
        masterCost: 120,
        unlockLevel: 10,
        color: '#CD853F',
        roofColor: '#8B4513'
    },
    {
        id: 'tcm',
        name: '中医',
        hour: '戌时',
        region: '全国',
        emoji: '🌿',
        description: '悬壶济世，治病救人',
        lore: '中医博大精深，望闻问切，辨证论治，守护华夏儿女健康。',
        towerType: '毒素爆发',
        towerDamage: 10,
        towerRange: 100,
        towerAttackSpeed: 0.9,
        poisonDps: 5,
        skill: { name: '悬壶济世', description: '为单个建筑恢复大量生命', cooldown: 8 },
        width: 2,
        height: 3,
        rarity: 4,
        buildCost: 300,
        baseOutput: 12,
        upgradeCosts: [
            { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 },
            { coins: 2400, scrolls: 16 }
        ],
        masterCost: 100,
        unlockLevel: 11,
        color: '#228B22',
        roofColor: '#006400'
    },
    {
        id: 'ultimate',
        name: '终极融合',
        hour: '亥时',
        region: '星辰',
        emoji: '⭐',
        description: '融合十二非遗，成就终极之力',
        lore: '集十二种非遗技艺之大成，融会贯通，达到天人合一之境界。',
        towerType: '全能轰炸',
        towerDamage: 50,
        towerRange: 300,
        towerAttackSpeed: 2.0,
        splash: 80,
        multiTarget: 3,
        critRate: 0.2,
        skill: { name: '万法归一', description: '释放所有非遗之力，造成毁灭性伤害', cooldown: 30 },
        width: 4,
        height: 4,
        rarity: 5,
        buildCost: 2000,
        baseOutput: 50,
        upgradeCosts: [
            { coins: 3000, scrolls: 20 },
            { coins: 6000, scrolls: 40 },
            { coins: 12000, scrolls: 80 },
            { coins: 24000, scrolls: 160 }
        ],
        masterCost: 200,
        unlockLevel: 12,
        color: '#9400D3',
        roofColor: '#4B0082'
    },

    // ===== 阶段九：新增 12 种非遗工坊（追加到数组末尾）=====
    // 升级费用规则：3星 150/1、300/2、600/4、1200/8；4星 300/2、600/4、1200/8、2400/16；5星 500/5、1000/10、2000/20、4000/40
    {
        id: 'tie-dye',
        name: '扎染',
        hour: '辰时',
        region: '云南·大理',
        emoji: '🌀',
        description: '靛蓝扎染，布上生花，束缚敌人行动',
        lore: '大理白族扎染以板蓝根为染料，图案古朴典雅，是国家级非遗。',
        towerType: '减速射线',
        towerDamage: 8,
        towerRange: 120,
        towerAttackSpeed: 0.9,
        slowFactor: 0.5,
        slowDuration: 2,
        skill: { name: '靛蓝束缚', description: '范围内敌人定身 2 秒', cooldown: 12 },
        width: 2, height: 2, rarity: 3,
        buildCost: 150, baseOutput: 6,
        upgradeCosts: [
            { coins: 150, scrolls: 1 }, { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 }, { coins: 1200, scrolls: 8 }
        ],
        masterCost: 60, unlockLevel: 4,
        color: '#4169E1', roofColor: '#191970'
    },
    {
        id: 'wood-carving',
        name: '木雕',
        hour: '寅时',
        region: '浙江·东阳',
        emoji: '🪵',
        description: '东阳木雕，千木连击，近战重击',
        lore: '东阳木雕位列中国四大木雕之首，以浮雕见长，层次丰富。',
        towerType: '蓄力重击',
        towerDamage: 25, towerRange: 50, towerAttackSpeed: 1.0,
        critRate: 0.25,
        skill: { name: '千木连击', description: '连续攻击 3 次，每次伤害 +50%', cooldown: 15 },
        width: 2, height: 2, rarity: 4,
        buildCost: 250, baseOutput: 10,
        upgradeCosts: [
            { coins: 300, scrolls: 2 }, { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 }, { coins: 2400, scrolls: 16 }
        ],
        masterCost: 100, unlockLevel: 7,
        color: '#DEB887', roofColor: '#8B4513'
    },
    {
        id: 'sugar-painting',
        name: '糖画',
        hour: '午时',
        region: '四川·成都',
        emoji: '🍭',
        description: '糖勺绘物，甜蜜陷阱，范围减速',
        lore: '糖画以糖为墨、以勺为笔，绘出飞禽走兽，可观可食。',
        towerType: '溅射减速',
        towerDamage: 6, towerRange: 100, towerAttackSpeed: 1.1,
        splash: 40, slowFactor: 0.4, slowDuration: 2,
        skill: { name: '甜蜜陷阱', description: '地面留糖浆区域减速 60% 持续 3 秒', cooldown: 10 },
        width: 2, height: 2, rarity: 3,
        buildCost: 150, baseOutput: 6,
        upgradeCosts: [
            { coins: 150, scrolls: 1 }, { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 }, { coins: 1200, scrolls: 8 }
        ],
        masterCost: 60, unlockLevel: 5,
        color: '#FFD700', roofColor: '#DAA520'
    },
    {
        id: 'kite',
        name: '风筝',
        hour: '卯时',
        region: '山东·潍坊',
        emoji: '🪁',
        description: '潍坊风筝，乘风破浪，远程空袭',
        lore: '潍坊是世界风筝之都，风筝技艺代代相传，造型万千。',
        towerType: '全图空袭',
        towerDamage: 10, towerRange: 180, towerAttackSpeed: 0.8,
        multiTarget: 5,
        skill: { name: '乘风破浪', description: '召唤风筝对全图随机 5 个敌人造成伤害', cooldown: 14 },
        width: 2, height: 2, rarity: 3,
        buildCost: 150, baseOutput: 6,
        upgradeCosts: [
            { coins: 150, scrolls: 1 }, { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 }, { coins: 1200, scrolls: 8 }
        ],
        masterCost: 60, unlockLevel: 6,
        color: '#87CEEB', roofColor: '#4682B4'
    },
    {
        id: 'oil-umbrella',
        name: '油纸伞',
        hour: '巳时',
        region: '四川·泸州',
        emoji: '☂️',
        description: '泸州油纸伞，遮风挡雨，防御增益',
        lore: '泸州油纸伞工艺精湛，伞骨竹制，伞面刷桐油，坚韧耐用。',
        towerType: '辅助防御',
        towerDamage: 5, towerRange: 100, towerAttackSpeed: 1.0,
        skill: { name: '遮风挡雨', description: '范围内友方塔获得护盾吸收 100 伤害持续 5 秒', cooldown: 18 },
        width: 2, height: 2, rarity: 4,
        buildCost: 250, baseOutput: 10,
        upgradeCosts: [
            { coins: 300, scrolls: 2 }, { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 }, { coins: 2400, scrolls: 16 }
        ],
        masterCost: 100, unlockLevel: 8,
        color: '#C41E3A', roofColor: '#8B0000'
    },
    {
        id: 'lantern-art',
        name: '花灯',
        hour: '酉时',
        region: '江苏·南京',
        emoji: '🏮',
        description: '秦淮花灯，华灯初上，范围照明',
        lore: '南京秦淮灯会享誉天下，花灯工艺精巧，照亮夜空。',
        towerType: '破隐真伤',
        towerDamage: 15, towerRange: 130, towerAttackSpeed: 1.0,
        ignoreShield: true,
        skill: { name: '华灯初上', description: '照亮全场，破除隐身敌人', cooldown: 14 },
        width: 2, height: 2, rarity: 3,
        buildCost: 150, baseOutput: 6,
        upgradeCosts: [
            { coins: 150, scrolls: 1 }, { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 }, { coins: 1200, scrolls: 8 }
        ],
        masterCost: 60, unlockLevel: 9,
        color: '#FF6347', roofColor: '#FF4500'
    },
    {
        id: 'lacquerware',
        name: '漆器',
        hour: '未时',
        region: '福建·福州',
        emoji: '🪔',
        description: '福州脱胎漆器，大漆侵蚀，毒素持续',
        lore: '福州脱胎漆器轻巧坚牢，色彩瑰丽，与北京景泰蓝、景德镇瓷器并称"三宝"。',
        towerType: '毒素持续',
        towerDamage: 12, towerRange: 110, towerAttackSpeed: 0.9,
        skill: { name: '大漆侵蚀', description: '目标中毒每秒受到攻击力 50% 伤害持续 5 秒可叠加', cooldown: 15 },
        width: 2, height: 2, rarity: 4,
        buildCost: 250, baseOutput: 10,
        upgradeCosts: [
            { coins: 300, scrolls: 2 }, { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 }, { coins: 2400, scrolls: 16 }
        ],
        masterCost: 100, unlockLevel: 10,
        color: '#8B0000', roofColor: '#2F0000'
    },
    {
        id: 'kesi',
        name: '缂丝',
        hour: '辰时',
        region: '苏州·苏州',
        emoji: '🧶',
        description: '通经断纬，穿透攻击，丝缕不绝',
        lore: '缂丝又称"刻丝"，是中国丝织工艺的巅峰，有"一寸缂丝一寸金"之说。',
        towerType: '穿透攻击',
        towerDamage: 16, towerRange: 150, towerAttackSpeed: 1.0,
        skill: { name: '通经断纬', description: '攻击穿透所有敌人并造成流血效果持续 3 秒', cooldown: 20 },
        width: 2, height: 2, rarity: 5,
        buildCost: 500, baseOutput: 15,
        upgradeCosts: [
            { coins: 500, scrolls: 5 }, { coins: 1000, scrolls: 10 },
            { coins: 2000, scrolls: 20 }, { coins: 4000, scrolls: 40 }
        ],
        masterCost: 150, unlockLevel: 13,
        color: '#9370DB', roofColor: '#483D8B'
    },
    {
        id: 'guqin',
        name: '古琴',
        hour: '午时',
        region: '江苏·常熟',
        emoji: '🎼',
        description: '高山流水，音波 AOE，琴音涤荡',
        lore: '常熟虞山琴派是中国古琴重要流派，琴音清微淡远，意境深远。',
        towerType: '全图音波',
        towerDamage: 14, towerRange: 160, towerAttackSpeed: 0.8,
        splash: 100,
        skill: { name: '高山流水', description: '全图音波冲击所有敌人受到 200 点伤害并眩晕 1 秒', cooldown: 25 },
        width: 3, height: 2, rarity: 5,
        buildCost: 500, baseOutput: 15,
        upgradeCosts: [
            { coins: 500, scrolls: 5 }, { coins: 1000, scrolls: 10 },
            { coins: 2000, scrolls: 20 }, { coins: 4000, scrolls: 40 }
        ],
        masterCost: 150, unlockLevel: 15,
        color: '#2F4F4F', roofColor: '#0F0F0F'
    },
    {
        id: 'bronze-mirror',
        name: '铜镜',
        hour: '申时',
        region: '陕西·西安',
        emoji: '🪞',
        description: '明镜高悬，反射伤害，以彼之道',
        lore: '西安出土的唐代铜镜工艺精湛，镜面光可照人，背饰瑞兽花鸟。',
        towerType: '聚光灼烧',
        towerDamage: 18, towerRange: 80, towerAttackSpeed: 2.0,
        poisonDps: 6,
        skill: { name: '明镜高悬', description: '聚焦阳光灼烧敌人，持续灼伤', cooldown: 16 },
        width: 2, height: 2, rarity: 4,
        buildCost: 250, baseOutput: 10,
        upgradeCosts: [
            { coins: 300, scrolls: 2 }, { coins: 600, scrolls: 4 },
            { coins: 1200, scrolls: 8 }, { coins: 2400, scrolls: 16 }
        ],
        masterCost: 100, unlockLevel: 18,
        color: '#CD7F32', roofColor: '#8B4513'
    },
    {
        id: 'new-year-painting',
        name: '年画',
        hour: '未时',
        region: '天津·杨柳青',
        emoji: '🎨',
        description: '门神镇宅，召唤增援，纸人助阵',
        lore: '杨柳青年画是中国四大年画之一，色彩鲜艳，寓意吉祥。',
        towerType: '多目标散射',
        towerDamage: 8, towerRange: 120, towerAttackSpeed: 1.0,
        multiTarget: 3,
        skill: { name: '门神镇宅', description: '召唤 2 个临时纸人塔协助战斗 10 秒', cooldown: 20 },
        width: 2, height: 2, rarity: 3,
        buildCost: 150, baseOutput: 6,
        upgradeCosts: [
            { coins: 150, scrolls: 1 }, { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 }, { coins: 1200, scrolls: 8 }
        ],
        masterCost: 60, unlockLevel: 21,
        color: '#C41E3A', roofColor: '#FFD700'
    },
    {
        id: 'clay-figurine',
        name: '泥人',
        hour: '申时',
        region: '江苏·无锡',
        emoji: '🧸',
        description: '惠山泥人，泥牛入海，嘲讽吸引',
        lore: '无锡惠山泥人以"大阿福"最为著名，造型质朴憨态可掬。',
        towerType: '自爆冲击',
        towerDamage: 30, towerRange: 60, towerAttackSpeed: 0.5,
        splash: 70,
        skill: { name: '泥牛入海', description: '冲入敌群范围自爆，造成巨额伤害', cooldown: 14 },
        width: 2, height: 2, rarity: 3,
        buildCost: 150, baseOutput: 6,
        upgradeCosts: [
            { coins: 150, scrolls: 1 }, { coins: 300, scrolls: 2 },
            { coins: 600, scrolls: 4 }, { coins: 1200, scrolls: 8 }
        ],
        masterCost: 60, unlockLevel: 24,
        color: '#D2B48C', roofColor: '#8B7355'
    }
];

const ENEMY_DATA = {
    normal: [
        { id: 'rat-soldier', name: '遗忘鼠兵', hp: 15, speed: 1.0, attack: 1, reward: { coins: 5, popularity: 5 }, color: '#808080' },
        { id: 'lamp-ghost', name: '执念灯鬼', hp: 45, speed: 1.2, attack: 1, skill: '闪烁', reward: { coins: 8, popularity: 8 }, color: '#FFA500' },
        { id: 'ox-minion', name: '牛头怪', hp: 60, speed: 0.6, attack: 2, reward: { coins: 10, popularity: 10 }, color: '#8B4513' },
        { id: 'moon-rabbit', name: '月影兔', hp: 40, speed: 1.5, attack: 1, skill: '闪避', reward: { coins: 8, popularity: 8 }, color: '#FFFFFF' },
        { id: 'phantom-snake', name: '幻影蛇', hp: 55, speed: 0.9, attack: 2, skill: '中毒', reward: { coins: 10, popularity: 10 }, color: '#00FF00' },
        { id: 'monkey-demon', name: '猴妖', hp: 70, speed: 1.3, attack: 2, skill: '快速攻击', reward: { coins: 12, popularity: 12 }, color: '#8B4513' },
        { id: 'hellhound', name: '地狱犬', hp: 90, speed: 0.8, attack: 3, reward: { coins: 15, popularity: 14 }, color: '#2F2F2F' }
    ],
    elite: [
        { id: 'tiger-demon', name: '虎妖', hp: 130, speed: 0.7, attack: 3, skill: '死亡分裂', reward: { coins: 30, popularity: 25 }, color: '#DC143C' },
        { id: 'dragon-guard', name: '青龙守卫', hp: 260, speed: 0.5, attack: 4, skill: '范围攻击', reward: { coins: 40, popularity: 30 }, color: '#1E90FF' },
        { id: 'horse-elite', name: '马面精英', hp: 220, speed: 1.4, attack: 3, skill: '冲锋', reward: { coins: 35, popularity: 28 }, color: '#8B0000' },
        { id: 'sheep-priest', name: '羊灵祭祀', hp: 180, speed: 0.6, attack: 2, skill: '治疗光环', reward: { coins: 35, popularity: 28 }, color: '#F5DEB3' },
        { id: 'golden-guard', name: '金羽卫', hp: 300, speed: 0.7, attack: 3, skill: '群体增益', reward: { coins: 45, popularity: 35 }, color: '#FFD700' }
    ],
    boss: [
        { id: 'boss-rat', name: '子鼠·遗忘鼠王', hp: 150, speed: 0.8, attack: 2, skill: '召唤鼠群', reward: { coins: 100, popularity: 40, scrolls: 1, inspiration: 5 }, color: '#808080' },
        { id: 'boss-ox', name: '丑牛·执念蛮牛', hp: 300, speed: 0.6, attack: 3, skill: '冲撞眩晕', reward: { coins: 200, popularity: 45, scrolls: 2, inspiration: 8 }, color: '#8B4513' },
        { id: 'boss-tiger', name: '寅虎·画皮虎妖', hp: 450, speed: 0.7, attack: 4, skill: '分裂', reward: { coins: 300, popularity: 50, scrolls: 3, inspiration: 10 }, color: '#DC143C' },
        { id: 'boss-rabbit', name: '卯兔·月影兔魔', hp: 260, speed: 1.2, attack: 3, skill: '闪避+远程', reward: { coins: 350, popularity: 50, scrolls: 3, inspiration: 12 }, color: '#DDA0DD' },
        { id: 'boss-dragon', name: '辰龙·墨韵青龙', hp: 600, speed: 0.5, attack: 5, skill: 'AOE+水柱', reward: { coins: 400, popularity: 55, scrolls: 4, inspiration: 15 }, color: '#1E90FF' },
        { id: 'boss-snake', name: '巳蛇·幻影蛇姬', hp: 380, speed: 0.9, attack: 3, skill: '中毒+隐身', reward: { coins: 450, popularity: 55, scrolls: 4, inspiration: 15 }, color: '#00FF00' },
        { id: 'boss-horse', name: '午马·铁蹄马魂', hp: 520, speed: 1.0, attack: 4, skill: '冲锋+践踏', reward: { coins: 500, popularity: 60, scrolls: 5, inspiration: 18 }, color: '#8B4513' },
        { id: 'boss-sheep', name: '未羊·祭祀羊灵', hp: 450, speed: 0.6, attack: 3, skill: '治疗+护盾', reward: { coins: 550, popularity: 60, scrolls: 5, inspiration: 20 }, color: '#F5DEB3' },
        { id: 'boss-monkey', name: '申猴·灵猴妖将', hp: 600, speed: 1.1, attack: 5, skill: '分身', reward: { coins: 600, popularity: 65, scrolls: 6, inspiration: 22 }, color: '#8B4513' },
        { id: 'boss-rooster', name: '酉鸡·金羽凤鸡', hp: 680, speed: 0.7, attack: 5, skill: '群体增益+火焰', reward: { coins: 700, popularity: 70, scrolls: 7, inspiration: 25 }, color: '#FFD700' },
        { id: 'boss-dog', name: '戌狗·地狱犬王', hp: 820, speed: 0.8, attack: 6, skill: '三头攻击', reward: { coins: 800, popularity: 75, scrolls: 8, inspiration: 28 }, color: '#2F2F2F' },
        { id: 'boss-pig', name: '亥猪·混沌吞噬兽', hp: 1500, speed: 0.4, attack: 8, skill: '全屏AOE+万象', reward: { coins: 1000, popularity: 100, scrolls: 10, inspiration: 35 }, color: '#8A2BE2' }
    ]
};

// ===== 阶段九：30 关（每时辰拆分为初/中/末 3 子关）=====
// id: 字符串 ID（如 level-1-1）；index: 数字序号 1-30（存档/解锁/工坊解锁用）
// 子类型：initial(初,HP0.8,波次60%) / middle(中,HP1.0,波次80%) / final(末,HP1.3,BOSS1.2,波次100%)
// 奖励倍率：初0.4 / 中0.6 / 末1.0（第30关再翻倍）
// 原时辰奖励基准（来自阶段八 12 关）：
const _BASE_REWARDS = {
    '子时': { coins: 200, scrolls: 2, inspiration: 10 },
    '丑时': { coins: 350, scrolls: 3, inspiration: 15 },
    '寅时': { coins: 500, scrolls: 5, inspiration: 20 },
    '卯时': { coins: 650, scrolls: 6, inspiration: 25 },
    '辰时': { coins: 800, scrolls: 8, inspiration: 30 },
    '巳时': { coins: 950, scrolls: 10, inspiration: 35 },
    '午时': { coins: 1100, scrolls: 12, inspiration: 40 },
    '未时': { coins: 1250, scrolls: 14, inspiration: 45 },
    '申时': { coins: 1400, scrolls: 16, inspiration: 50 },
    '酉时': { coins: 1600, scrolls: 18, inspiration: 55 },
    '亥时': { coins: 5000, scrolls: 30, inspiration: 100 }
};

function _scaleReward(hour, subMul) {
    const base = _BASE_REWARDS[hour] || { coins: 200, scrolls: 2, inspiration: 10 };
    return {
        coins: Math.max(50, Math.round(base.coins * subMul)),
        scrolls: Math.max(1, Math.round(base.scrolls * subMul)),
        inspiration: Math.max(5, Math.round(base.inspiration * subMul))
    };
}

// 30 关完整定义（pathPoints 在 tower-defense.js LEVEL_PATHS 中按 index 复用）
const LEVELS = [
    // 子时（原第1关）—— boss-rat，夜雾弥漫
    { id: 'level-1-1',  index: 1,  name: '子时·初', hour: '子时', subType: 'initial', boss: 'boss-rat',     waves: 2,  pathType: 'straight', difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('子时', 0.4), unlockLevel: 1,  isFinal: false, weather: 'fog' },
    { id: 'level-1-2',  index: 2,  name: '子时·中', hour: '子时', subType: 'middle',   boss: 'boss-rat',     waves: 3,  pathType: 'L-shape',  difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('子时', 0.6), unlockLevel: 2,  isFinal: false, weather: 'fog' },
    { id: 'level-1-3',  index: 3,  name: '子时·末', hour: '子时', subType: 'final',    boss: 'boss-rat',     waves: 3,  pathType: 'S-shape',  difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('子时', 1.0), unlockLevel: 3,  isFinal: false, weather: 'fog' },
    // 丑时（原第2关）—— boss-ox，浓雾深锁
    { id: 'level-2-1',  index: 4,  name: '丑时·初', hour: '丑时', subType: 'initial', boss: 'boss-ox',      waves: 3,  pathType: 'straight', difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('丑时', 0.4), unlockLevel: 4,  isFinal: false, weather: 'fog' },
    { id: 'level-2-2',  index: 5,  name: '丑时·中', hour: '丑时', subType: 'middle',   boss: 'boss-ox',      waves: 3,  pathType: 'zigzag',   difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('丑时', 0.6), unlockLevel: 5,  isFinal: false, weather: 'fog' },
    { id: 'level-2-3',  index: 6,  name: '丑时·末', hour: '丑时', subType: 'final',    boss: 'boss-ox',      waves: 4,  pathType: 'fork',     difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('丑时', 1.0), unlockLevel: 6,  isFinal: false, weather: 'fog' },
    // 寅时（原第3关）—— boss-tiger，晨雾渐散
    { id: 'level-3-1',  index: 7,  name: '寅时·初', hour: '寅时', subType: 'initial', boss: 'boss-tiger',   waves: 3,  pathType: 'L-shape',  difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('寅时', 0.4), unlockLevel: 7,  isFinal: false, weather: 'fog' },
    { id: 'level-3-2',  index: 8,  name: '寅时·中', hour: '寅时', subType: 'middle',   boss: 'boss-tiger',   waves: 4,  pathType: 'S-shape',  difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('寅时', 0.6), unlockLevel: 8,  isFinal: false, weather: 'fog' },
    { id: 'level-3-3',  index: 9,  name: '寅时·末', hour: '寅时', subType: 'final',    boss: 'boss-tiger',   waves: 5,  pathType: 'spiral',   difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('寅时', 1.0), unlockLevel: 9,  isFinal: false, weather: 'fog' },
    // 卯时（原第4关）—— boss-rabbit，晨曦花瓣
    { id: 'level-4-1',  index: 10, name: '卯时·初', hour: '卯时', subType: 'initial', boss: 'boss-rabbit',  waves: 3,  pathType: 'straight', difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('卯时', 0.4), unlockLevel: 10, isFinal: false, weather: 'petal' },
    { id: 'level-4-2',  index: 11, name: '卯时·中', hour: '卯时', subType: 'middle',   boss: 'boss-rabbit',  waves: 4,  pathType: 'fork',     difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('卯时', 0.6), unlockLevel: 11, isFinal: false, weather: 'petal' },
    { id: 'level-4-3',  index: 12, name: '卯时·末', hour: '卯时', subType: 'final',    boss: 'boss-rabbit',  waves: 5,  pathType: 'dual',     difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('卯时', 1.0), unlockLevel: 12, isFinal: false, weather: 'petal' },
    // 辰时（原第5关）—— boss-dragon，晴空万里
    { id: 'level-5-1',  index: 13, name: '辰时·初', hour: '辰时', subType: 'initial', boss: 'boss-dragon',  waves: 4,  pathType: 'L-shape',  difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('辰时', 0.4), unlockLevel: 13, isFinal: false, weather: null },
    { id: 'level-5-2',  index: 14, name: '辰时·中', hour: '辰时', subType: 'middle',   boss: 'boss-dragon',  waves: 5,  pathType: 'ring',     difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('辰时', 0.6), unlockLevel: 14, isFinal: false, weather: null },
    { id: 'level-5-3',  index: 15, name: '辰时·末', hour: '辰时', subType: 'final',    boss: 'boss-dragon',  waves: 6,  pathType: 'spiral',   difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('辰时', 1.0), unlockLevel: 15, isFinal: false, weather: null },
    // 巳时（原第6关）—— boss-snake，细雨绵绵
    { id: 'level-6-1',  index: 16, name: '巳时·初', hour: '巳时', subType: 'initial', boss: 'boss-snake',   waves: 4,  pathType: 'S-shape',  difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('巳时', 0.4), unlockLevel: 16, isFinal: false, weather: 'rain' },
    { id: 'level-6-2',  index: 17, name: '巳时·中', hour: '巳时', subType: 'middle',   boss: 'boss-snake',   waves: 5,  pathType: 'dual',     difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('巳时', 0.6), unlockLevel: 17, isFinal: false, weather: 'rain' },
    { id: 'level-6-3',  index: 18, name: '巳时·末', hour: '巳时', subType: 'final',    boss: 'boss-snake',   waves: 6,  pathType: 'maze',     difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('巳时', 1.0), unlockLevel: 18, isFinal: false, weather: 'rain' },
    // 午时（原第7关）—— boss-horse，烈日当空
    { id: 'level-7-1',  index: 19, name: '午时·初', hour: '午时', subType: 'initial', boss: 'boss-horse',   waves: 5,  pathType: 'straight', difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('午时', 0.4), unlockLevel: 19, isFinal: false, weather: null },
    { id: 'level-7-2',  index: 20, name: '午时·中', hour: '午时', subType: 'middle',   boss: 'boss-horse',   waves: 5,  pathType: 'zigzag',   difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('午时', 0.6), unlockLevel: 20, isFinal: false, weather: null },
    { id: 'level-7-3',  index: 21, name: '午时·末', hour: '午时', subType: 'final',    boss: 'boss-horse',   waves: 7,  pathType: 'spiral',   difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('午时', 1.0), unlockLevel: 21, isFinal: false, weather: null },
    // 未时（原第8关）—— boss-sheep，阵雨初歇
    { id: 'level-8-1',  index: 22, name: '未时·初', hour: '未时', subType: 'initial', boss: 'boss-sheep',   waves: 5,  pathType: 'L-shape',  difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('未时', 0.4), unlockLevel: 22, isFinal: false, weather: 'rain' },
    { id: 'level-8-2',  index: 23, name: '未时·中', hour: '未时', subType: 'middle',   boss: 'boss-sheep',   waves: 5,  pathType: 'fork',     difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('未时', 0.6), unlockLevel: 23, isFinal: false, weather: 'rain' },
    { id: 'level-8-3',  index: 24, name: '未时·末', hour: '未时', subType: 'final',    boss: 'boss-sheep',   waves: 7,  pathType: 'zigzag',   difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('未时', 1.0), unlockLevel: 24, isFinal: false, weather: 'rain' },
    // 申时（原第9关）—— boss-monkey，秋高气爽
    { id: 'level-9-1',  index: 25, name: '申时·初', hour: '申时', subType: 'initial', boss: 'boss-monkey',  waves: 5,  pathType: 'S-shape',  difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('申时', 0.4), unlockLevel: 25, isFinal: false, weather: null },
    { id: 'level-9-2',  index: 26, name: '申时·中', hour: '申时', subType: 'middle',   boss: 'boss-monkey',  waves: 6,  pathType: 'grid',     difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('申时', 0.6), unlockLevel: 26, isFinal: false, weather: null },
    { id: 'level-9-3',  index: 27, name: '申时·末', hour: '申时', subType: 'final',    boss: 'boss-monkey',  waves: 8,  pathType: 'maze',     difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('申时', 1.0), unlockLevel: 27, isFinal: false, weather: null },
    // 酉时（原第10关）—— boss-rooster，华灯初上
    { id: 'level-10-1', index: 28, name: '酉时·初', hour: '酉时', subType: 'initial', boss: 'boss-rooster', waves: 5,  pathType: 'ring',     difficultyMultiplier: 0.8, bossHpMultiplier: 1.0, reward: _scaleReward('酉时', 0.4), unlockLevel: 28, isFinal: false, weather: 'lantern' },
    { id: 'level-10-2', index: 29, name: '酉时·中', hour: '酉时', subType: 'middle',   boss: 'boss-rooster', waves: 6,  pathType: 'fullmap',  difficultyMultiplier: 1.0, bossHpMultiplier: 1.0, reward: _scaleReward('酉时', 0.6), unlockLevel: 29, isFinal: false, weather: 'lantern' },
    // 亥时·末（原第12关终极，跳过戌时）—— boss-pig，夜雾灯火
    { id: 'level-11-3', index: 30, name: '亥时·末', hour: '亥时', subType: 'final',    boss: 'boss-pig',     waves: 10, pathType: 'fullmap',  difficultyMultiplier: 1.3, bossHpMultiplier: 1.2, reward: _scaleReward('亥时', 2.0), unlockLevel: 30, isFinal: true, weather: 'lantern' }
];

// 旧版 12 关 ID（1-12）→ 新版对应末关 index 映射（戌时第11关映射到末位以避免数据丢失）
// 旧 1(子时) → 新末关 index 3；旧 2(丑时) → 6；... 旧 11(戌时) → 27(申时末,作为兼容位)；旧 12(亥时) → 30
const LEVELS_LEGACY_MAP = {
    1: 3, 2: 6, 3: 9, 4: 12, 5: 15, 6: 18,
    7: 21, 8: 24, 9: 27, 10: 29, 11: 27, 12: 30
};

// ===== 阶段九：特殊关卡配置（每周轮换一个）=====
const SPECIAL_LEVELS = {
    'boss-rush': {
        id: 'boss-rush',
        name: 'BOSS Rush · 十二生肖连战',
        icon: '💀',
        description: '连续挑战 12 生肖 BOSS，无小怪波次',
        mapLevelIndex: 30,
        bossOrder: ['boss-rat','boss-ox','boss-tiger','boss-rabbit','boss-dragon','boss-snake','boss-horse','boss-sheep','boss-monkey','boss-rooster','boss-dog','boss-pig'],
        bossHpMul: 0.8,
        healOnKill: 0.2,
        reward: { coins: 2000, scrolls: 10, inspiration: 100, relic: 'rare' }
    },
    'tower-restriction': {
        id: 'tower-restriction',
        name: '限制造型 · 塔种限制',
        icon: '⛓️',
        description: '只能使用指定类型的塔（每周轮换）',
        mapLevelIndex: 15,
        towerTypes: ['远程','近战','辅助','AOE'],
        reward: { coins: 1000, scrolls: 5, inspiration: 50 }
    },
    'resource-restriction': {
        id: 'resource-restriction',
        name: '资源限制 · 紧缺挑战',
        icon: '🪙',
        description: '初始铜钱减半、人气获取减半',
        mapLevelIndex: 18,
        coinsMul: 0.5,
        popularityMul: 0.5,
        reward: { coins: 1500, scrolls: 8, inspiration: 80 }
    }
};

// ===== 阶段九：无尽模式配置 =====
const ENDLESS_CONFIG = {
    MAX_ENEMIES: 200,
    RESUME_THRESHOLD: 150,
    bossInterval: 5,
    relicInterval: 10,
    baseEnemyHp: 20,
    baseEnemyCount: 5,
    maxPerWave: 30,
    hpStep: 0.2,        // 每 5 波 HP +20%
    countStep: 1,       // 每 5 波 数量 +1
    initialResources: { coins: 500, popularity: 100 },
    waveReward: { coins: 50, popularity: 10 },
    multiBossWave50: 2, // 第 50 波起 2 BOSS
    multiBossWave100: 3,// 第 100 波起 3 BOSS
    cleanupInterval: 10
};

const DECORATIONS = [
    { id: 'stone-bridge', name: '石拱桥', emoji: '🌉', cost: 200, bonus: 10, range: 2 },
    { id: 'wooden-pavilion', name: '木凉亭', emoji: '🏡', cost: 300, bonus: 15, range: 2 },
    { id: 'stone-lion', name: '石狮子', emoji: '🦁', cost: 500, bonus: 20, range: 3 },
    { id: 'lantern', name: '红灯笼', emoji: '🏮', cost: 150, bonus: 8, range: 1 },
    { id: 'bamboo', name: '翠竹林', emoji: '🎋', cost: 400, bonus: 18, range: 2 },
    { id: 'lotus-pond', name: '荷花池', emoji: '🪷', cost: 600, bonus: 25, range: 3 }
];

window.GameData = {
    ICH_LIST,
    ENEMY_DATA,
    LEVELS,
    DECORATIONS,
    LEVELS_LEGACY_MAP,
    SPECIAL_LEVELS,
    ENDLESS_CONFIG
};