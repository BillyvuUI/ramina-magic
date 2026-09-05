// Append-only IDs. Expanding the catalog adds rows; existing ownership needs no migration.
export const WORLD_CATALOG_VERSION = 1;
const rows = [
  ['sun_honey_01','Медовое солнышко','sun',735,100,1,'#ffd278'],
  ['rainbow_pastel_01','Нежная радуга','rainbow',460,200,1,'#efabc8'],
  ['castle_lilac_01','Сиреневый замок','castle',745,322,1,'#c2afe4'],
  ['cloud_rose_01','Розовое облачко','cloud',195,116,.9,'#f3c4d5'],
  ['cloud_pearl_02','Жемчужное облачко','cloud',532,76,.8,'#e4dff5'],
  ['cloud_peach_03','Персиковое облачко','cloud',820,207,.6,'#f7d7be'],
  ['tree_mint_01','Мятное деревце','tree',128,360,1,'#8bbfa8'],
  ['tree_lilac_02','Сказочное деревце','tree',803,404,.7,'#b7add9'],
  ['tree_peach_03','Деревце доброты','tree',72,428,.65,'#eabca8'],
  ['crystal_pink_01','Розовый кристалл','crystal',195,485,.8,'#eab1cc'],
  ['crystal_blue_02','Лунный кристалл','crystal',740,491,.7,'#a3cfdf'],
  ['crystal_lilac_03','Кристалл мечты','crystal',830,506,.6,'#bcace0'],
  ['crystal_gold_04','Солнечный кристалл','crystal',108,519,.5,'#e7c786'],
  ['butterfly_rainbow_01','Радужная бабочка','butterfly',244,205,.8,'#d89cc7'],
  ['butterfly_mint_02','Мятная бабочка','butterfly',675,248,.7,'#96c9bb'],
  ['butterfly_peach_03','Персиковая бабочка','butterfly',118,273,.65,'#edb299'],
  ['butterfly_sky_04','Небесная бабочка','butterfly',789,166,.65,'#a6c8e8'],
  ['butterfly_lilac_05','Бабочка желаний','butterfly',582,164,.55,'#b7a4dd'],
  ['flower_pink_left_01','Розовый цветочек','flower',260,524,.7,'#dc8db3'],
  ['flower_peach_left_02','Персиковый цветочек','flower',300,546,.5,'#eab292'],
  ['flower_gold_left_03','Золотой цветочек','flower',224,554,.5,'#dfbf72'],
  ['flower_lilac_left_04','Сиреневая ромашка','flower',159,557,.6,'#b0a0d2'],
  ['flower_pink_right_05','Цветок радости','flower',651,522,.65,'#d695bc'],
  ['flower_pearl_right_06','Жемчужный цветочек','flower',694,547,.55,'#c9b9db'],
  ['flower_sky_right_07','Голубой цветочек','flower',763,557,.6,'#99bdd9'],
  ['flower_mint_right_08','Цветок дружбы','flower',845,552,.45,'#90baa2'],
  ['flower_rose_front_09','Розовая мечта','flower',362,578,.4,'#dba4b8'],
  ['flower_gold_front_10','Маленькое солнце','flower',563,572,.4,'#e3c87f'],
  ['star_gold_01','Звёздочка желаний','star',323,111,.8,'#e9c783'],
  ['star_pearl_02','Жемчужная звезда','star',619,106,.6,'#d4c4e3'],
  ['star_rose_03','Розовая звезда','star',388,58,.45,'#e4b1c8'],
  ['star_sky_04','Небесная звезда','star',86,167,.45,'#a8ced7'],
  ['star_lilac_05','Звезда волшебства','star',856,111,.5,'#c7b4df'],
  ['star_gold_06','Тёплая звёздочка','star',695,58,.35,'#e6c782'],
  ['ramina_crown_01','Корона Рамины','crown',384,243,.65,'#eac584'],
  ['unicorn_crown_01','Корона единорога','crown',570,276,.48,'#e3c18d'],
  ['ramina_bracelet_01','Браслет добрых дел','bracelet',449,406,.65,'#c59ed8'],
  ['ramina_necklace_01','Ожерелье звёзд','necklace',385,334,.65,'#dba6ca'],
  ['ramina_wand_01','Волшебная палочка','wand',302,367,.8,'#d5b1dc'],
  ['unicorn_ribbon_01','Бантик единорога','bow',603,331,.55,'#dc9cbc']
];
export const WORLD_CATALOG = Object.freeze(rows.map(([id,title,kind,x,y,scale,color]) => Object.freeze({
  id,title,kind,x,y,scale,color,slot:id,layer: ['sun','rainbow','castle','cloud','tree','star'].includes(kind) ? 'background' : 'foreground'
})));
export function expandedPool(previous, catalog = WORLD_CATALOG, version = WORLD_CATALOG_VERSION) {
  const ids = catalog.map(e => e.id);
  if (new Set(ids).size !== ids.length) throw new Error('Catalog IDs must be unique');
  if (previous && (previous.catalogVersion > version || !Array.isArray(previous.knownIds) || !Array.isArray(previous.remainingIds))) throw new Error('Incompatible world pool');
  const known = previous?.knownIds ?? [], remaining = previous?.remainingIds ?? [];
  if (new Set(known).size !== known.length || new Set(remaining).size !== remaining.length
      || remaining.some(id => !known.includes(id)) || known.some(id => !ids.includes(id))) throw new Error('World catalog must be append-only');
  return { catalogVersion: version, knownIds: ids, remainingIds: [...remaining, ...ids.filter(id => !known.includes(id))] };
}
