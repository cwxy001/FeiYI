#!/usr/bin/env python3
"""
batch_generate_assets.py - 批量生成非遗古镇阶段八美术资产
- 调用 Agnes AI (agnes-image-2.1-flash) 生成 47 张图片
- 生成尺寸: 建筑/敌人 512x512, BOSS 768x768, UI 256x256
- 下载后用 Pillow 压缩为 8-bit 调色板 PNG
- 保存到 assets/images/buildings|enemies|ui/
"""
import os, sys, time, json, base64, httpx
from PIL import Image

API_KEY = os.getenv("AGNES_API_KEY") or ""
API_BASE = "https://apihub.agnes-ai.com/v1"
MODEL = "agnes-image-2.1-flash"
ROOT = r"d:\FeiYiGuZhen\FeiYiGuZhen\assets\images"

# 统一风格前缀（中国古镇风）
STYLE = "Traditional Chinese ancient town style, warm color palette (red, gold, ink black, ochre), hand-painted illustration, transparent background, PNG with alpha channel, game asset, high quality"

# ===== 资产清单 =====
# 12 建筑（heritageId, 中文名, 英文描述）
BUILDINGS = [
    ("paper-cut", "剪纸坊", "paper-cutting workshop with red paper decorations and scissors"),
    ("shadow-play", "皮影戏台", "shadow puppet theater with white screen and leather puppets"),
    ("embroidery", "刺绣工坊", "embroidery workshop with silk threads and embroidery frame"),
    ("ceramics", "陶瓷窑", "ceramic kiln with pottery and porcelain vases"),
    ("lion-dance", "醒狮馆", "lion dance hall with red and golden lion heads"),
    ("peking-opera", "京剧戏楼", "Peking opera tower with painted masks and stage"),
    ("martial-arts", "武馆", "martial arts hall with weapons rack and training ground"),
    ("tea-art", "茶艺馆", "tea art house with tea set and bamboo tables"),
    ("four-treasures", "文房四宝", "study with brush, ink, paper, inkstone four treasures"),
    ("cuisine", "美食坊", "traditional cuisine kitchen with steam and dishes"),
    ("tcm", "中药铺", "traditional Chinese medicine shop with herb cabinets"),
    ("ultimate", "传承圣殿", "grand heritage temple with golden roof and lanterns"),
]

# 25 敌人（id, 中文名, 英文描述, 是否BOSS）
ENEMIES = [
    # 普通 7
    ("rat-soldier", "遗忘鼠兵", "rat soldier in gray armor holding small blade", False),
    ("lamp-ghost", "执念灯鬼", "ghostly spirit lantern with orange flame floating", False),
    ("ox-minion", "牛头怪", "ox-head demon minion with brown hide and axe", False),
    ("moon-rabbit", "月影兔", "white moon rabbit spirit with glowing eyes", False),
    ("phantom-snake", "幻影蛇", "green phantom snake with translucent body", False),
    ("monkey-demon", "猴妖", "brown monkey demon with sharp teeth and staff", False),
    ("hellhound", "地狱犬", "dark hellhound with glowing red eyes and fire", False),
    # 精英 5
    ("tiger-demon", "虎妖", "crimson tiger demon elite with stripes and claws", False),
    ("dragon-guard", "青龙守卫", "blue dragon guard with scales and spear", False),
    ("horse-elite", "马面精英", "dark horse-face elite with halberd charging", False),
    ("sheep-priest", "羊灵祭祀", "cream-colored sheep spirit priest with staff", False),
    ("golden-guard", "金羽卫", "golden feathered guard with wings and sword", False),
    # BOSS 12（十二生肖）
    ("boss-rat", "子鼠·遗忘鼠王", "boss rat king with crown and gray fur, menacing", True),
    ("boss-ox", "丑牛·执念蛮牛", "boss ox demon with huge horns and brown armor", True),
    ("boss-tiger", "寅虎·画皮虎妖", "boss tiger demon with painted face and crimson stripes", True),
    ("boss-rabbit", "卯兔·月影兔魔", "boss rabbit demon with moonlight aura and pink fur", True),
    ("boss-dragon", "辰龙·墨韵青龙", "boss ink dragon coiled with blue scales and whiskers", True),
    ("boss-snake", "巳蛇·幻影蛇姬", "boss snake queen with green coils and hypnotic eyes", True),
    ("boss-horse", "午马·铁蹄马魂", "boss horse spirit with iron hooves and dark mane", True),
    ("boss-sheep", "未羊·祭祀羊灵", "boss sheep priest with golden bells and wool", True),
    ("boss-monkey", "申猴·灵猴妖将", "boss monkey general with golden staff and armor", True),
    ("boss-rooster", "酉鸡·金羽凤鸡", "boss golden phoenix rooster with flaming feathers", True),
    ("boss-dog", "戌狗·地狱犬王", "boss three-headed hellhound king with fire", True),
    ("boss-pig", "亥猪·混沌吞噬兽", "boss chaos pig behemoth with purple aura and tusks", True),
]

# 10 UI 图标（id, 中文名, 英文描述）
UI_ICONS = [
    ("coin", "铜钱", "ancient Chinese copper coin with square hole, gold metallic"),
    ("inspiration", "灵感", "glowing inspiration star with golden sparkles"),
    ("scroll", "卷轴", "ancient bamboo scroll partially unrolled, ink strokes"),
    ("popularity", "人气", "red popularity seal stamp with golden star"),
    ("build", "建造", "build hammer and wooden plank icon, construction"),
    ("battle", "闯关", "crossed swords battle icon, steel blades"),
    ("collection", "图鉴", "open book collection icon with bookmark"),
    ("pause", "暂停", "pause icon two vertical bars, golden"),
    ("speed", "加速", "speed icon double arrow forward, golden"),
    ("exit", "退出", "exit door icon with arrow, golden"),
]


def generate_one(prompt, output_path, size="512x512", timeout=180, retries=2):
    """生成单张图片并保存（原始尺寸），返回 (success, msg)。失败重试 retries 次"""
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    payload = {"model": MODEL, "prompt": prompt, "n": 1, "size": size}
    url = f"{API_BASE}/images/generations"

    last_err = ""
    for attempt in range(1, retries + 2):
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(url, headers=headers, json=payload)
            if resp.status_code != 200:
                last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
                if attempt <= retries:
                    time.sleep(5)
                    continue
                return False, last_err

            data = resp.json()
            items = data.get("data") or []
            if not items:
                last_err = f"无 data: {json.dumps(data)[:200]}"
                if attempt <= retries:
                    time.sleep(5)
                    continue
                return False, last_err

            item = items[0]
            if item.get("b64_json"):
                img_bytes = base64.b64decode(item["b64_json"])
            elif item.get("url"):
                with httpx.Client(timeout=120) as client:
                    r = client.get(item["url"])
                if r.status_code != 200:
                    last_err = f"下载失败 {r.status_code}"
                    if attempt <= retries:
                        time.sleep(5)
                        continue
                    return False, last_err
                img_bytes = r.content
            else:
                return False, f"无 b64_json/url: {json.dumps(item)[:200]}"

            out_dir = os.path.dirname(output_path)
            if out_dir and not os.path.exists(out_dir):
                os.makedirs(out_dir, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(img_bytes)
            return True, f"{len(img_bytes)//1024}KB"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            if attempt <= retries:
                time.sleep(5)
                continue
            return False, last_err
    return False, last_err


def compress_png(src_path, target_size=None):
    """用 Pillow 压缩为 8-bit 调色板 PNG（保留 alpha 通道）。target_size=(w,h) 可选缩放"""
    try:
        img = Image.open(src_path).convert("RGBA")
        if target_size:
            img = img.resize(target_size, Image.LANCZOS)
        # 转 8-bit 调色板：先分离 alpha，quantize RGB，再合并 alpha
        # （直接 quantize 会丢失 alpha 通道，导致背景不透明）
        alpha = img.split()[3]
        quantized = img.convert("RGB").quantize(colors=256, method=Image.FASTOCTREE, dither=Image.NONE)
        quantized.putalpha(alpha)
        quantized.save(src_path, "PNG", optimize=True)
        return True, os.path.getsize(src_path) // 1024
    except Exception as e:
        return False, str(e)


def main():
    os.makedirs(f"{ROOT}/buildings", exist_ok=True)
    os.makedirs(f"{ROOT}/enemies", exist_ok=True)
    os.makedirs(f"{ROOT}/ui", exist_ok=True)

    tasks = []
    # 建筑 512x512
    for bid, _, desc in BUILDINGS:
        tasks.append((f"{ROOT}/buildings/{bid}.png", f"{desc}, isometric 2D building view, {STYLE}", "512x512", (128, 128)))
    # 普通敌人 512x512 -> 64x64, BOSS 768x768 -> 128x128
    for eid, _, desc, is_boss in ENEMIES:
        if is_boss:
            tasks.append((f"{ROOT}/enemies/{eid}.png", f"{desc}, character portrait, {STYLE}", "768x768", (128, 128)))
        else:
            tasks.append((f"{ROOT}/enemies/{eid}.png", f"{desc}, character portrait, {STYLE}", "512x512", (64, 64)))
    # UI 256x256 -> 32x32
    for uid, _, desc in UI_ICONS:
        tasks.append((f"{ROOT}/ui/{uid}.png", f"{desc}, flat icon, simple, {STYLE}", "256x256", (32, 32)))

    total = len(tasks)
    print(f"=== 共 {total} 张图片待生成 ===", flush=True)
    success = 0
    failed = []
    progress_log = f"{ROOT}/_progress.log"

    for i, (out_path, prompt, gen_size, target) in enumerate(tasks, 1):
        rel = os.path.relpath(out_path, ROOT)
        # 跳过已存在
        if os.path.exists(out_path):
            msg = f"[{i}/{total}] SKIP {rel}"
            print(msg, flush=True)
            with open(progress_log, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
            success += 1
            continue

        msg = f"[{i}/{total}] GEN {rel}"
        print(msg, flush=True)
        with open(progress_log, "a", encoding="utf-8") as f:
            f.write(msg + " ...\n")
        t0 = time.time()
        ok, gmsg = generate_one(prompt, out_path, gen_size)
        dt = time.time() - t0
        if not ok:
            msg = f"    FAIL ({dt:.0f}s): {gmsg}"
            print(msg, flush=True)
            with open(progress_log, "a", encoding="utf-8") as f:
                f.write(msg + "\n")
            failed.append((rel, gmsg))
            time.sleep(2)
            continue

        # 压缩
        cok, cmsg = compress_png(out_path, target)
        if cok:
            msg = f"    OK ({dt:.0f}s) -> {cmsg}KB"
        else:
            msg = f"    OK gen ({dt:.0f}s) but compress fail: {cmsg}"
        print(msg, flush=True)
        with open(progress_log, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
        success += 1
        time.sleep(1)

    summary = f"\n=== 完成: {success}/{total} 成功, {len(failed)} 失败 ==="
    print(summary, flush=True)
    with open(progress_log, "a", encoding="utf-8") as f:
        f.write(summary + "\n")
    if failed:
        with open(f"{ROOT}/_failed.json", "w", encoding="utf-8") as f:
            json.dump(failed, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
