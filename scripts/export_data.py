"""
从 SQLite 导出数据为 JSON，供 Next.js 使用。
用法: python scripts/export_data.py
"""

import json
import os
import sys
import sqlite3

# 将项目根加入路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from data_service.db import get_connection, get_score_rank_stats

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# gaokao_data.db 路径（build_gaokao_db.py 产出的数据库）
GAOKAO_DATA_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'gaokao_data.db')

# 选科名称归一化映射（gaokao_data.db 用词 → 标准名）
CLASSIFY_NORMALIZE = {
    "物理": "物理", "物理类": "物理",
    "历史": "历史", "历史类": "历史",
    "文科": "文科", "文科（不含艺文）": "文科",
    "理科": "理科", "理科（不含艺理、体育": "理科",
    "综合": "综合",
    "体育文": "体育文", "体育理": "体育理", "体育类": "体育类",
    "体育类（历史）": "体育类", "体育类（物理）": "体育类",
    "艺术文": "艺术文", "艺术理": "艺术理", "艺术类": "艺术类",
    "艺术类（历史）": "艺术类", "艺术类（物理）": "艺术类",
    "蒙授文科": "蒙授文科", "蒙授理科": "蒙授理科", "蒙授体育": "蒙授体育",
    "文史": "文科", "理工": "理科",
    "文史类": "文科", "理工类": "理科",
}
def norm_classify(name):
    if not name: return name
    name = name.strip()
    return CLASSIFY_NORMALIZE.get(name, name)

conn = get_connection()

# 1. 一分一段表 — 分组导出
print('导出一分一段表...')
rows = conn.execute("""
    SELECT year, province, classify, score, same_score_num, cumulative_rank
    FROM score_rank
    ORDER BY province, year, classify, score DESC
""").fetchall()

grouped = {}
for r in rows:
    key = f"{r['province']}_{r['year']}_{r['classify']}"
    if key not in grouped:
        grouped[key] = []
    grouped[key].append({
        "score": r["score"],
        "sameScoreNum": r["same_score_num"],
        "cumulativeRank": r["cumulative_rank"],
    })

sr_dir = os.path.join(OUTPUT_DIR, 'score_rank')
os.makedirs(sr_dir, exist_ok=True)

index = {}
for key, records in grouped.items():
    with open(os.path.join(sr_dir, f"{key}.json"), 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False)
    province, year, classify = key.split('_')
    index.setdefault(province, {}).setdefault(year, []).append(classify)

with open(os.path.join(sr_dir, '_index.json'), 'w', encoding='utf-8') as f:
    json.dump(index, f, ensure_ascii=False, indent=2)

print(f"  {len(rows)} 条记录, {len(grouped)} 个分组")

# 1b. 从 gaokao_data.db 补充一分一段数据
if os.path.exists(GAOKAO_DATA_DB):
    conn2 = sqlite3.connect(GAOKAO_DATA_DB)
    conn2.row_factory = sqlite3.Row
    try:
        sd_rows = conn2.execute("""
            SELECT year, province, subject AS classify,
                   score, person_count AS same_score_num,
                   cumulative_count AS cumulative_rank
            FROM score_distribution
            ORDER BY province, year, subject, score DESC
        """).fetchall()
        sd_grouped = {}
        for r in sd_rows:
            cls = norm_classify(r['classify'])
            key = f"{r['province']}_{r['year']}_{cls}"
            if key not in sd_grouped:
                sd_grouped[key] = []
            sd_grouped[key].append({
                "score": r["score"],
                "sameScoreNum": r["same_score_num"],
                "cumulativeRank": r["cumulative_rank"],
            })

        # 合并或覆盖已有分组（gaokao_data.db 的数据优先）
        for key, records in sd_grouped.items():
            if key not in grouped:
                grouped[key] = records
                province, year, classify = key.split('_')
                index.setdefault(province, {}).setdefault(year, []).append(classify)

        # 重写所有分组的 JSON 文件（含补充数据）
        for key, records in grouped.items():
            with open(os.path.join(sr_dir, f"{key}.json"), 'w', encoding='utf-8') as f:
                json.dump(records, f, ensure_ascii=False)

        # 重写索引
        with open(os.path.join(sr_dir, '_index.json'), 'w', encoding='utf-8') as f:
            json.dump(index, f, ensure_ascii=False, indent=2)

        print(f"  从 gaokao_data.db 补充 {len(sd_rows)} 条一分一段数据")
    except Exception as e:
        print(f"  读取 score_distribution 失败: {e}")
    conn2.close()

# 2. 批次线
print('导出批次线...')
bl = conn.execute("SELECT * FROM batch_lines ORDER BY province, year").fetchall()
with open(os.path.join(OUTPUT_DIR, 'batch_lines.json'), 'w', encoding='utf-8') as f:
    json.dump([dict(r) for r in bl], f, ensure_ascii=False)
print(f"  {len(bl)} 条记录")

# 3. 大学录取数据 — 按省份拆分导出（避免单文件过大）
print('导出大学录取数据（按省份拆分）...')

admission_dir = os.path.join(OUTPUT_DIR, 'admission')
os.makedirs(admission_dir, exist_ok=True)

# 从 data_service DB
ar = conn.execute("SELECT * FROM admission_ranks ORDER BY province, university, year").fetchall()
all_records = [dict(r) for r in ar]

# 从 gaokao_data.db 补充专业录取数据（95 万条）
if os.path.exists(GAOKAO_DATA_DB):
    conn2 = sqlite3.connect(GAOKAO_DATA_DB)
    conn2.row_factory = sqlite3.Row
    try:
        rows = conn2.execute("""
            SELECT year, province,
                   school_name AS university,
                   subject,
                   batch,
                   major_name AS major,
                   major_note,
                   selection_requirement,
                   enroll_count AS admit_count,
                   min_score AS score_min,
                   min_rank AS min_rank
            FROM admission_score
            ORDER BY province, school_name, year
        """).fetchall()
        for r in rows:
            d = dict(r)
            d['student_type'] = norm_classify(d.pop('subject', '') or '')
            d['major_group'] = ''
            d['max_rank'] = None
            d['avg_rank'] = None
            d['plan_count'] = None
            d['score_avg'] = None
            d['source'] = 'excel_import'
            d['source_url'] = ''
            d['verified_at'] = None
            d['created_at'] = None
            d['updated_at'] = None
            all_records.append(d)
        print(f"  从 gaokao_data.db 补充 {len(rows)} 条专业录取数据")
    except Exception as e:
        print(f"  读取 gaokao_data.db 失败: {e}")
    conn2.close()
else:
    print(f"  未找到 gaokao_data.db，跳过")

# 按省份分组写入
prov_grouped = {}
prov_uni_index = {}
for r in all_records:
    p = r['province']
    if p not in prov_grouped:
        prov_grouped[p] = []
        prov_uni_index[p] = {}
    prov_grouped[p].append(r)
    u = r['university']
    y = r['year']
    if u not in prov_uni_index[p]:
        prov_uni_index[p][u] = set()
    prov_uni_index[p][u].add(y)

for province, records in prov_grouped.items():
    filepath = os.path.join(admission_dir, f"{province}.json")
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(records, f, ensure_ascii=False)

# 写入索引（含各院校覆盖年份）
admission_index = {}
for province, unis in prov_uni_index.items():
    admission_index[province] = {
        "total": len(prov_grouped[province]),
        "university_count": len(unis),
        "universities": {u: sorted(list(years)) for u, years in unis.items()},
    }

with open(os.path.join(admission_dir, '_index.json'), 'w', encoding='utf-8') as f:
    json.dump(admission_index, f, ensure_ascii=False, indent=2)

print(f"  合计: {len(all_records)} 条, {len(prov_grouped)} 省")

# 4. 省份元数据
from data_service.config import PROVINCES
from data_service.utils.normalize import get_gaokao_mode

meta = {}
for p in PROVINCES:
    meta[p] = {"classifies": {}}
    for y in [2023, 2024, 2025]:
        mode = get_gaokao_mode(p, y)
        if mode == "old":
            cls = ["文科", "理科"]
        elif mode == "3+3":
            cls = ["综合"]
        else:
            cls = ["物理", "历史"]
        meta[p]["classifies"][str(y)] = cls

with open(os.path.join(OUTPUT_DIR, 'provinces.json'), 'w', encoding='utf-8') as f:
    json.dump(PROVINCES, f, ensure_ascii=False)

with open(os.path.join(OUTPUT_DIR, 'province-meta.json'), 'w', encoding='utf-8') as f:
    json.dump(meta, f, ensure_ascii=False, indent=2)

print(f"  {len(PROVINCES)} 个省份元数据")

conn.close()
print('\n导出完成!')
