// 장소 사진 — 위키미디어 공용의 자유 라이선스 사진을 앱에 넣어 둠 (오프라인에서도 보임)
//  match: 장소 중국어 이름(zh)에 맞추는 패턴. 식당·숙소에는 붙이지 않음.
//  출처·라이선스는 사진 아래에 표시 (CC BY/BY-SA는 저작자 표시 필요)
export const PHOTOS = [
  { id: 'bund', match: /^外滩$/, alt: "와이탄", author: "Ermell", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Shanghai_Bund-20150516-RM-173803.jpg" },
  { id: 'pearl', match: /东方明珠/, alt: "동방명주", author: "Ermell", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Shanghai_Oriental_Pearl_Tower-20150516-RM-123453.jpg" },
  { id: 'peoplesq', match: /^人民广场/, alt: "인민광장", author: "kallerna", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Fountain_People%27s_Square_Shanghai.jpg" },
  { id: 'nanjingrd', match: /南京路步行街/, alt: "난징루 보행가", author: "Hermann Luyken", license: "CC0", src: "https://commons.wikimedia.org/wiki/File:2014.11.15.181414_Nanjing_Road_Pedestrian_Zone_Shanghai.jpg" },
  { id: 'cruise', match: /黄浦江/, alt: "황푸강 유람선", author: "David Stanley from Nanaimo, Canada", license: "CC BY 2.0", src: "https://commons.wikimedia.org/wiki/File:Huangpu_River_Boat_(38852714630).jpg" },
  { id: 'yuyuan', match: /^豫园$/, alt: "예원", author: "Stefan Fussan", license: "CC BY-SA 3.0", src: "https://commons.wikimedia.org/wiki/File:Shanghai_-_Yu_Garden_-_0035.jpg" },
  { id: 'shtower', match: /朵云书院|上海中心/, alt: "상하이타워", author: "Stefan Fussan", license: "CC BY-SA 3.0", src: "https://commons.wikimedia.org/wiki/File:Shanghai_-_Shanghai_Tower_-_0002.jpg" },
  { id: 'tianzifang', match: /田子坊/, alt: "티엔즈팡", author: "钉钉", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Tianzifang_3.jpg" },
  { id: 'wukang', match: /武康大楼/, alt: "우캉맨션", author: "N509FZ", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Wukang_Mansion_(20191114161507).jpg" },
  { id: 'roastery', match: /星巴克臻选/, alt: "스타벅스 리저브 로스터리", author: "Codas", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Starbucks_Reserve_Roastery_Shanghai_02.jpg" },
  { id: 'museum', match: /上海博物馆/, alt: "상하이 박물관", author: "Gary Todd", license: "CC0", src: "https://commons.wikimedia.org/wiki/File:2008_Shanghai_People%27s_Square-_Shanghai_Museum_1.jpg" },
  { id: 'sihang', match: /四行仓库/, alt: "사행창고", author: "ScareCriterion12", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Sihang_Warehouse_2017.jpg" },
  { id: 'westlake', match: /西湖/, alt: "서호", author: "User:CatOnMars", license: "CC BY 4.0", src: "https://commons.wikimedia.org/wiki/File:Huanglong_%26_Broken_Bridge_-_Hangzhou_City_%26_West_Lake_near_Broken_Bridge.jpg" },
  { id: 'lingyin', match: /灵隐寺/, alt: "영은사", author: "Tyg728", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Lingyin_Temple,_Hangzhou_20161003.jpg" },
  { id: 'liuhe', match: /六和塔/, alt: "육화탑", author: "Siyuwj", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Liuhe_Pagoda_in_Hangzhou,_2015-03-01_28.jpg" },
  { id: 'zhuozheng', match: /拙政园/, alt: "졸정원", author: "King of Hearts", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Humble_Administrator%27s_Garden_Suzhou_November_2017_008.jpg" },
  { id: 'pingjiang', match: /平江路/, alt: "핑장루", author: "song songroov", license: "CC BY 3.0", src: "https://commons.wikimedia.org/wiki/File:Riverside_of_Pingjiang_Road,_Gusu,_Suzhou,_Jiangsu,_China,_215000.jpg" },
  { id: 'liuyuan', match: /留园/, alt: "유원", author: "Another Believer", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Lingering_Garden,_Suzhou,_China_(2015)_-_07.jpg" },
  { id: 'shantang', match: /山塘/, alt: "산탕제", author: "Windmemories", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:2017-04-17_Shantang_River,_Suzhou_02.jpg" },
  { id: 'gateeast', match: /东方之门/, alt: "동방지문", author: "David290", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Gate_of_the_Orient_DJI_0347_(2).jpg" },
  { id: 'hongqiao', match: /上海虹桥站/, alt: "훙차오역 대합실", author: "Ermell", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Shanghai_Hongqiao_Station_Hall-20150519-RM-102949.jpg" },
  { id: 'shstation', match: /^上海站$/, alt: "상하이역", author: "我乃野云鹤", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Shanghai_Railway_Station_in_2014.jpg" },
  { id: 'hzeast', match: /杭州东站/, alt: "항저우동역 대합실", author: "Staeiou", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Hangzhou_East_railway_station_interior.jpg" },
  { id: 'szstation', match: /^苏州站$/, alt: "쑤저우역 대합실", author: "Chainwit.", license: "CC BY 4.0", src: "https://commons.wikimedia.org/wiki/File:China-Suzhou_(2024)_Suzhou_Railway_Station_%E8%8B%8F%E5%B7%9E%E7%AB%99_-_img_05.jpg" },
  { id: 'pvg', match: /浦东国际机场/, alt: "푸동공항 T1", author: "そらみみ", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Terminal_1_of_Shanghai_Pudong_International_Airport_from_Pudong_International_Airport_Station_(Shanghai_Maglev).jpg" },
  { id: 'hzkpg', match: /杭州旧址/, alt: "항저우 임시정부 구지", author: "Yumeto", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:20230629_Dahan_Minguo_Linshi_Zhengfu_Hangzhou_Jiuzhi_Jinianguan_(103355).jpg" },
  { id: 'hefang', match: /河坊街/, alt: "허팡제", author: "钉钉", license: "CC BY-SA 4.0", src: "https://commons.wikimedia.org/wiki/File:Hefang_Street,_Hangzhou.jpg" },
];

const NO_PHOTO_CAT = new Set(['food', 'hotel', 'transit']);

export function findPhoto(stop) {
  if (!stop || NO_PHOTO_CAT.has(stop.cat)) return null;
  const zh = String(stop.zh || '').trim();
  return zh ? PHOTOS.find(p => p.match.test(zh)) || null : null;
}

export const photoPath = p => `photos/${p.id}.jpg`;
