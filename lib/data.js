/**
 * 统一数据层
 * 优先使用 PostgreSQL（@neondatabase/serverless），无数据库时降级到本地 JSON 文件
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { neon } from '@neondatabase/serverless';

const DATA_DIR = join(process.cwd(), 'data');
const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const USE_DB = !!DB_URL;
let _dbHasData = null;
let _sql = null;

// ====== JSON 缓存 ======
let _jsonCache = {};

function jsonRead(path) {
  if (_jsonCache[path]) return _jsonCache[path];
  const fullPath = join(DATA_DIR, path);
  if (!existsSync(fullPath)) return null;
  _jsonCache[path] = JSON.parse(readFileSync(fullPath, 'utf-8'));
  return _jsonCache[path];
}

// ====== PostgreSQL（@neondatabase/serverless） ======

function getSql() {
  if (!_sql && DB_URL) _sql = neon(DB_URL);
  return _sql;
}

async function dbHasData() {
  if (_dbHasData !== null) return _dbHasData;
  try {
    const sql = getSql();
    if (!sql) { _dbHasData = false; return false; }
    const rows = await sql('SELECT COUNT(*) as cnt FROM score_rank');
    _dbHasData = parseInt(rows[0]?.cnt || '0') > 0;
    return _dbHasData;
  } catch (_) {
    _dbHasData = false;
    return false;
  }
}

async function useDb() {
  return USE_DB && await dbHasData();
}

// 封装 query：保持与 pg 兼容的 { rows } 返回格式
async function pgQuery(text, params) {
  const sql = getSql();
  if (!sql) return { rows: [] };
  const rows = await sql.query(text, params);
  return { rows };
}

// ====== 省份 ======

export async function getProvinces() {
  if (await useDb()) {
    const { rows } = await pgQuery('SELECT DISTINCT province FROM score_rank ORDER BY province');
    return rows.map(r => r.province);
  }
  return jsonRead('provinces.json') || [];
}

export async function getProvinceMeta() {
  if (await useDb()) {
    const { rows } = await pgQuery(
      'SELECT province, year, classify FROM score_rank GROUP BY province, year, classify ORDER BY province, year'
    );
    const meta = {};
    for (const r of rows) {
      if (!meta[r.province]) meta[r.province] = { classifies: {} };
      if (!meta[r.province].classifies[r.year]) meta[r.province].classifies[r.year] = [];
      if (!meta[r.province].classifies[r.year].includes(r.classify)) {
        meta[r.province].classifies[r.year].push(r.classify);
      }
    }
    return meta;
  }
  return jsonRead('province-meta.json') || {};
}

// ====== 一分一段 ======

const _srCache = {};

export async function getScoreRankData(province, year, classify) {
  const key = `${province}_${year}_${classify}`;
  if (_srCache[key]) return _srCache[key];

  if (await useDb()) {
    const { rows } = await pgQuery(
      'SELECT score, "sameScoreNum", "cumulativeRank" FROM score_rank WHERE province=$1 AND year=$2 AND classify=$3 ORDER BY score DESC',
      [province, year, classify]
    );
    _srCache[key] = rows.length ? rows : null;
    return _srCache[key];
  }

  const data = jsonRead(`score_rank/${key}.json`);
  _srCache[key] = data;
  return data;
}

export async function getScoreRankIndex() {
  if (await useDb()) {
    const { rows } = await pgQuery(
      'SELECT province, year, classify FROM score_rank GROUP BY province, year, classify ORDER BY province, year'
    );
    const index = {};
    for (const r of rows) {
      if (!index[r.province]) index[r.province] = {};
      if (!index[r.province][r.year]) index[r.province][r.year] = [];
      index[r.province][r.year].push(r.classify);
    }
    return index;
  }
  return jsonRead('score_rank/_index.json') || {};
}

// ====== 批次线 ======

export async function getBatchLines() {
  if (await useDb()) {
    const { rows } = await pgQuery('SELECT * FROM batch_lines ORDER BY province, year');
    return rows;
  }
  return jsonRead('batch_lines.json') || [];
}

// ====== 录取数据 ======

const _admCache = {};

export async function getAdmissionByProvince(province) {
  if (_admCache[province]) return _admCache[province];

  if (await useDb()) {
    const { rows } = await pgQuery(
      'SELECT * FROM admission WHERE province=$1 ORDER BY year DESC, score_min DESC',
      [province]
    );
    _admCache[province] = rows;
    return rows;
  }

  const data = jsonRead(`admission/${province}.json`);
  _admCache[province] = data || [];
  return _admCache[province];
}

export async function getAdmissionIndex() {
  if (await useDb()) {
    const { rows } = await pgQuery(
      'SELECT province, COUNT(*) as total, COUNT(DISTINCT university) as uni_count FROM admission GROUP BY province'
    );
    const idx = {};
    for (const r of rows) {
      idx[r.province] = { total: parseInt(r.total), university_count: parseInt(r.uni_count) };
    }
    return idx;
  }
  return jsonRead('admission/_index.json') || {};
}

export async function searchUniversity(province, university, major) {
  if (await useDb()) {
    let sql = 'SELECT * FROM admission WHERE province=$1 AND university ILIKE $2';
    const params = [province, `%${university}%`];
    if (major) {
      sql += ' AND major ILIKE $3';
      params.push(`%${major}%`);
    }
    sql += ' ORDER BY year DESC, score_min DESC LIMIT 50';
    const { rows } = await pgQuery(sql, params);
    return rows;
  }
  const records = await getAdmissionByProvince(province);
  if (!records || records.length === 0) return [];
  let matches = records.filter(r => r.university && r.university.includes(university));
  if (major) {
    const majorFiltered = matches.filter(r => (r.major || '').includes(major));
    if (majorFiltered.length > 0) matches = majorFiltered;
  }
  return matches;
}

// ====== 高考模式判断（纯函数，无需 IO） ======

const REFORM = {
  "3+3": { "上海":2017,"浙江":2017,"北京":2020,"天津":2020,"山东":2020,"海南":2020 },
  "3+1+2": {
    "河北":2021,"辽宁":2021,"江苏":2021,"福建":2021,"湖北":2021,"湖南":2021,"广东":2021,"重庆":2021,
    "甘肃":2024,"吉林":2024,"黑龙江":2024,"安徽":2024,"江西":2024,"贵州":2024,"广西":2024,
    "山西":2025,"内蒙古":2025,"河南":2025,"四川":2025,"云南":2025,"陕西":2025,"青海":2025,"宁夏":2025
  }
};

export function getGaokaoMode(province, year) {
  const y = Number(year);
  for (const mode of ["3+1+2", "3+3"]) {
    const m = REFORM[mode];
    if (m && m[province] !== undefined && y >= m[province]) return mode;
  }
  return "old";
}

export function getValidClassifies(province, year) {
  const mode = getGaokaoMode(province, year);
  if (mode === "old") return ["文科", "理科"];
  if (mode === "3+3") return ["综合"];
  return ["物理", "历史"];
}

export function normalizeProvince(name) {
  if (name.includes('广东') || name === '粤') return '广东';
  if (name.includes('北京') || name === '京') return '北京';
  const aliases = {
    "粤":"广东","闽":"福建","湘":"湖南","鄂":"湖北","豫":"河南",
    "冀":"河北","鲁":"山东","苏":"江苏","浙":"浙江","皖":"安徽",
    "赣":"江西","蜀":"四川","川":"四川","渝":"重庆","陕":"陕西",
    "甘":"甘肃","滇":"云南","黔":"贵州","晋":"山西","辽":"辽宁",
    "吉":"吉林","黑":"黑龙江","琼":"海南","沪":"上海","津":"天津","京":"北京",
  };
  if (aliases[name]) return aliases[name];
  const cityMap = {
    "广州":"广东","深圳":"广东","南京":"江苏","杭州":"浙江","成都":"四川",
    "武汉":"湖北","长沙":"湖南","郑州":"河南","济南":"山东","青岛":"山东",
    "福州":"福建","厦门":"福建","合肥":"安徽","西安":"陕西","重庆":"重庆"
  };
  if (cityMap[name]) return cityMap[name];
  return name;
}
