/**
 * 统一数据层
 * 使用本地 JSON 文件（Vercel 部署时自动包含 score_rank/ 目录）
 * 如需 PostgreSQL，通过独立脚本/服务连接，不走 Next.js webpack 打包
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data');

// ====== JSON 缓存 ======
let _jsonCache = {};

function jsonRead(path) {
  if (_jsonCache[path]) return _jsonCache[path];
  const fullPath = join(DATA_DIR, path);
  if (!existsSync(fullPath)) return null;
  _jsonCache[path] = JSON.parse(readFileSync(fullPath, 'utf-8'));
  return _jsonCache[path];
}

// ====== 省份 ======

export async function getProvinces() {
  return jsonRead('provinces.json') || [];
}

export async function getProvinceMeta() {
  return jsonRead('province-meta.json') || {};
}

// ====== 一分一段 ======

const _srCache = {};

export async function getScoreRankData(province, year, classify) {
  const key = `${province}_${year}_${classify}`;
  if (_srCache[key]) return _srCache[key];

  const data = jsonRead(`score_rank/${key}.json`);
  _srCache[key] = data;
  return data;
}

export async function getScoreRankIndex() {
  return jsonRead('score_rank/_index.json') || {};
}

// ====== 批次线 ======

export async function getBatchLines() {
  return jsonRead('batch_lines.json') || [];
}

// ====== 录取数据 ======

const _admCache = {};

export async function getAdmissionByProvince(province) {
  if (_admCache[province]) return _admCache[province];
  const data = jsonRead(`admission/${province}.json`);
  _admCache[province] = data || [];
  return _admCache[province];
}

export async function getAdmissionIndex() {
  return jsonRead('admission/_index.json') || {};
}

export async function searchUniversity(province, university, major) {
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
