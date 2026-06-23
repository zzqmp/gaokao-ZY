/**
 * 数据加载模块 — 从 JSON 文件读取数据
 * Vercel 部署时 JSON 文件一并上传，无需数据库
 * 后续可通过 scripts/migrate_to_postgres.js 迁移至 PostgreSQL
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');

// 缓存（进程内缓存，Vercel 冷启动时加载一次）
let _provinces = null;
let _provinceMeta = null;
let _batchLines = null;
let _scoreRankIndex = null;
const _srCache = {};
const _admissionCache = {};
let _admissionIndex = null;

export function getProvinces() {
  if (!_provinces) {
    _provinces = JSON.parse(readFileSync(join(DATA_DIR, 'provinces.json'), 'utf-8'));
  }
  return _provinces;
}

export function getProvinceMeta() {
  if (!_provinceMeta) {
    const p = join(DATA_DIR, 'province-meta.json');
    if (existsSync(p)) _provinceMeta = JSON.parse(readFileSync(p, 'utf-8'));
    else _provinceMeta = {};
  }
  return _provinceMeta;
}

export function getScoreRankData(province, year, classify) {
  const key = `${province}_${year}_${classify}`;
  if (_srCache[key]) return _srCache[key];
  const filePath = join(DATA_DIR, 'score_rank', `${key}.json`);
  if (!existsSync(filePath)) return null;
  _srCache[key] = JSON.parse(readFileSync(filePath, 'utf-8'));
  return _srCache[key];
}

export function getScoreRankIndex() {
  if (!_scoreRankIndex) {
    const p = join(DATA_DIR, 'score_rank', '_index.json');
    if (existsSync(p)) _scoreRankIndex = JSON.parse(readFileSync(p, 'utf-8'));
    else _scoreRankIndex = {};
  }
  return _scoreRankIndex;
}

export function getBatchLines() {
  if (!_batchLines) {
    const p = join(DATA_DIR, 'batch_lines.json');
    if (existsSync(p)) _batchLines = JSON.parse(readFileSync(p, 'utf-8'));
    else _batchLines = [];
  }
  return _batchLines;
}

export function getAdmissionByProvince(province) {
  if (_admissionCache[province]) return _admissionCache[province];
  const filePath = join(DATA_DIR, 'admission', `${province}.json`);
  if (!existsSync(filePath)) return [];
  _admissionCache[province] = JSON.parse(readFileSync(filePath, 'utf-8'));
  return _admissionCache[province];
}

export function getAdmissionIndex() {
  if (!_admissionIndex) {
    const p = join(DATA_DIR, 'admission', '_index.json');
    if (existsSync(p)) _admissionIndex = JSON.parse(readFileSync(p, 'utf-8'));
    else _admissionIndex = {};
  }
  return _admissionIndex;
}

export function searchUniversity(province, university, major) {
  const records = getAdmissionByProvince(province);
  if (!records || records.length === 0) return [];
  let matches = records.filter(r => r.university && r.university.includes(university));
  if (major) {
    const majorFiltered = matches.filter(r => (r.major || '').includes(major));
    if (majorFiltered.length > 0) matches = majorFiltered;
  }
  return matches;
}

// ====== 高考模式判断 ======

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

const PROVINCE_ALIASES = {
  "粤":"广东","闽":"福建","湘":"湖南","鄂":"湖北","豫":"河南",
  "冀":"河北","鲁":"山东","苏":"江苏","浙":"浙江","皖":"安徽",
  "赣":"江西","蜀":"四川","川":"四川","渝":"重庆","陕":"陕西",
  "甘":"甘肃","滇":"云南","黔":"贵州","晋":"山西","辽":"辽宁",
  "吉":"吉林","黑":"黑龙江","琼":"海南","沪":"上海","津":"天津","京":"北京",
  "魔都":"上海","首都":"北京","帝都":"北京",
};

export function normalizeProvince(name) {
  if (getProvinces().includes(name)) return name;
  if (PROVINCE_ALIASES[name]) return PROVINCE_ALIASES[name];
  const cityMap = {
    "广州":"广东","深圳":"广东","南京":"江苏","杭州":"浙江","成都":"四川",
    "武汉":"湖北","长沙":"湖南","郑州":"河南","济南":"山东","青岛":"山东",
    "福州":"福建","厦门":"福建","合肥":"安徽","西安":"陕西","重庆":"重庆"
  };
  if (cityMap[name]) return cityMap[name];
  return null;
}
