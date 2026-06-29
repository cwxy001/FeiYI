#!/usr/bin/env python3
"""
agnes_image_generate.py - 通过 Agnes AI (OpenAI 兼容) 生成图片
用法: python agnes_image_generate.py --prompt "..." --output out.png --size 1024x1024
环境变量: AGNES_API_KEY, AGNES_API_BASE (默认 https://apihub.agnes-ai.com/v1)
"""
import argparse
import base64
import os
import sys
import time
import httpx

API_KEY = os.getenv("AGNES_API_KEY") or os.getenv("ARK_API_KEY")
API_BASE = (os.getenv("AGNES_API_BASE") or "https://apihub.agnes-ai.com/v1").rstrip("/")
MODEL = os.getenv("AGNES_IMAGE_MODEL") or "Agnes-Image-2.0"


def parse_size(size_str):
    """1024x1024 -> (1024, 1024)"""
    try:
        w, h = size_str.lower().split("x")
        return int(w), int(h)
    except Exception:
        return 1024, 1024


def generate_one(prompt, output_path, size="1024x1024", timeout=300):
    """生成单张图片并保存到 output_path。返回 (success, msg)"""
    if not API_KEY:
        return False, "AGNES_API_KEY 未设置"

    w, h = parse_size(size)
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }

    # OpenAI 兼容的 images/generations 接口
    # Agnes 不支持 response_format 参数，默认返回 url
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "n": 1,
        "size": f"{w}x{h}",
    }

    url = f"{API_BASE}/images/generations"
    print(f"[REQ] POST {url}")
    print(f"[REQ] model={MODEL} size={w}x{h}")
    print(f"[REQ] prompt={prompt[:80]}...")

    t0 = time.time()
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, headers=headers, json=payload)
        dt = time.time() - t0
        print(f"[RESP] status={resp.status_code} elapsed={dt:.1f}s")

        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}: {resp.text[:500]}"

        data = resp.json()
        items = data.get("data") or []
        if not items:
            return False, f"响应无 data 字段: {json.dumps(data)[:500]}"

        item = items[0]
        if "b64_json" in item and item["b64_json"]:
            img_bytes = base64.b64decode(item["b64_json"])
        elif "url" in item and item["url"]:
            # 如果返回 url，下载图片
            img_url = item["url"]
            print(f"[DOWNLOAD] {img_url}")
            with httpx.Client(timeout=120) as client:
                r = client.get(img_url)
            if r.status_code != 200:
                return False, f"下载图片失败 HTTP {r.status_code}"
            img_bytes = r.content
        else:
            return False, f"响应项无 b64_json 或 url: {json.dumps(item)[:300]}"

        # 确保目录存在
        out_dir = os.path.dirname(output_path)
        if out_dir and not os.path.exists(out_dir):
            os.makedirs(out_dir, exist_ok=True)

        with open(output_path, "wb") as f:
            f.write(img_bytes)

        size_kb = len(img_bytes) / 1024
        print(f"[OK] 已保存: {output_path} ({size_kb:.1f} KB)")
        return True, output_path

    except httpx.TimeoutException:
        return False, f"请求超时 ({timeout}s)"
    except Exception as e:
        return False, f"异常: {type(e).__name__}: {e}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prompt", "-p", required=True, help="图片描述")
    parser.add_argument("--output", "-o", required=True, help="输出文件路径")
    parser.add_argument("--size", "-s", default="1024x1024", help="尺寸，如 1024x1024")
    parser.add_argument("--timeout", "-t", type=int, default=300, help="超时秒数")
    args = parser.parse_args()

    ok, msg = generate_one(args.prompt, args.output, args.size, args.timeout)
    if ok:
        print("=== 生成成功 ===")
        print(msg)
    else:
        print("=== 生成失败 ===")
        print(msg)
        sys.exit(1)


if __name__ == "__main__":
    main()
