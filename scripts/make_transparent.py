#!/usr/bin/env python3
"""
make_transparent.py - 阶段八图片背景透明化后处理
功能：对 assets/images/ 下所有 PNG 进行背景透明化
算法：
  1. 采样四角 + 四边中点像素，取最常见颜色作为背景色
  2. 用 numpy 计算每个像素与背景色的颜色距离
  3. 距离 < hard_threshold → alpha=0（完全透明）
  4. hard_threshold ~ soft_threshold 之间 → 渐变 alpha（抗锯齿）
  5. 保存为 RGBA PNG（保留 alpha 通道，不 quantize）
用法：python scripts/make_transparent.py
"""
import os
import sys
import numpy as np
from PIL import Image
from collections import Counter

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "images")

# 阈值配置（颜色距离，欧式距离）
HARD_THRESHOLD = 30   # 小于此距离 → 完全透明
SOFT_THRESHOLD = 60   # 此距离以内 → 渐变半透明（抗锯齿）


def sample_background_color(img_array):
    """采样图片四角 + 四边中点，取最常见颜色作为背景色"""
    h, w = img_array.shape[:2]
    # 采样点：四角 + 四边中点 + 边缘均匀采样
    sample_points = [
        img_array[0, 0],           # 左上
        img_array[0, w-1],         # 右上
        img_array[h-1, 0],         # 左下
        img_array[h-1, w-1],       # 右下
        img_array[0, w//2],        # 上中
        img_array[h-1, w//2],      # 下中
        img_array[h//2, 0],        # 左中
        img_array[h//2, w-1],      # 右中
    ]
    # 沿边缘采样更多点
    for x in range(0, w, max(1, w//8)):
        sample_points.append(img_array[0, x])
        sample_points.append(img_array[h-1, x])
    for y in range(0, h, max(1, h//8)):
        sample_points.append(img_array[y, 0])
        sample_points.append(img_array[y, w-1])

    # 取 RGB（忽略 alpha）统计最常见颜色
    rgb_points = [tuple(p[:3]) for p in sample_points]
    counter = Counter(rgb_points)
    bg_color = np.array(counter.most_common(1)[0][0], dtype=np.float32)
    return bg_color


def make_transparent(img_path):
    """对单张图片做背景透明化"""
    try:
        img = Image.open(img_path).convert("RGBA")
        arr = np.array(img, dtype=np.float32)

        # 采样背景色
        bg_color = sample_background_color(arr)
        rgb = arr[:, :, :3]  # H, W, 3

        # 计算每个像素与背景色的颜色距离（欧式距离）
        diff = rgb - bg_color
        distance = np.sqrt(np.sum(diff * diff, axis=2))  # H, W

        # 构建 alpha 通道
        alpha = np.ones_like(distance) * 255  # 默认不透明
        # 完全透明区域
        alpha[distance < HARD_THRESHOLD] = 0
        # 渐变半透明区域（抗锯齿边缘）
        soft_mask = (distance >= HARD_THRESHOLD) & (distance < SOFT_THRESHOLD)
        if np.any(soft_mask):
            # 线性渐变：距离越接近 SOFT_THRESHOLD，alpha 越接近 255
            t = (distance[soft_mask] - HARD_THRESHOLD) / (SOFT_THRESHOLD - HARD_THRESHOLD)
            alpha[soft_mask] = (t * 255).astype(np.float32)

        # 写回 alpha 通道
        arr[:, :, 3] = alpha

        # 保存为 RGBA PNG（不 quantize，保留完整 alpha）
        result = Image.fromarray(arr.astype(np.uint8), mode="RGBA")
        result.save(img_path, "PNG", optimize=True)

        # 统计透明像素占比
        transparent_ratio = np.mean(alpha < 10) * 100
        return True, f"bg={tuple(bg_color.astype(int))}, transparent={transparent_ratio:.1f}%"
    except Exception as e:
        return False, str(e)


def main():
    if not os.path.isdir(ROOT):
        print(f"错误：目录不存在 {ROOT}")
        sys.exit(1)

    # 收集所有 PNG
    pngs = []
    for dirpath, _, filenames in os.walk(ROOT):
        for f in filenames:
            if f.endswith(".png"):
                pngs.append(os.path.join(dirpath, f))

    print(f"=== 共 {len(pngs)} 张图片待透明化 ===", flush=True)
    success = 0
    failed = []

    for i, p in enumerate(pngs, 1):
        rel = os.path.relpath(p, ROOT)
        ok, msg = make_transparent(p)
        if ok:
            print(f"[{i}/{len(pngs)}] OK   {rel} ({msg})", flush=True)
            success += 1
        else:
            print(f"[{i}/{len(pngs)}] FAIL {rel} ({msg})", flush=True)
            failed.append(rel)

    print(f"\n=== 完成: {success}/{len(pngs)} 成功, {len(failed)} 失败 ===", flush=True)
    if failed:
        print("失败列表:")
        for f in failed:
            print(f"  - {f}")


if __name__ == "__main__":
    main()
