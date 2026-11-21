// 일정 수정 = "작업(op)" 목록. 저장할 때 항상 서버의 최신 일정 위에 다시 적용해서
// 두 사람이 동시에 고쳐도 서로의 수정이 지워지지 않게 한다. (같은 op를 두 번 적용해도 결과가 같게 설계)

export const STOP_FIELDS = ['name', 'zh', 'station', 'addr', 'lat', 'lng', 'cat', 'time', 'desc', 'info', 'tmi', 'links', 'move', 'skip', 'review', 'route'];
const DAY_FIELDS = ['title', 'note'];
const TRACK_FIELDS = ['label', 'note'];
const CHECK_FIELDS = ['title', 'date', 'opens', 'who', 'done', 'doneBy', 'doneAt', 'onsite', 'note', 'link'];
const INFO_FIELDS = ['icon', 'title', 'body'];
const TRIP_FIELDS = ['title', 'subtitle', 'wonPerYuan', 'map', 'localLabel', 'localLang', 'taxiPhrase', 'taxiPhraseKo'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && Object.prototype.hasOwnProperty.call(obj, f)) out[f] = obj[f];
  return out;
}

function findDay(d, dayId) {
  return (d.days || []).find(x => x.id === dayId);
}

function findTrack(d, dayId, trackId) {
  const day = findDay(d, dayId);
  return day && (day.tracks || []).find(t => t.id === trackId);
}

function moveAfter(list, id, afterId) {
  const i = list.findIndex(x => x.id === id);
  if (i < 0) return false;
  const [item] = list.splice(i, 1);
  if (afterId == null) {
    list.unshift(item);
    return true;
  }
  const j = list.findIndex(x => x.id === afterId);
  if (j < 0) {
    list.splice(i, 0, item); // 기준 항목이 사라졌으면 제자리
    return true;
  }
  list.splice(j + 1, 0, item);
  return true;
}

function insertAt(list, item, afterId, first) {
  if (list.some(x => x.id === item.id)) return true; // 이미 있음(중복 적용)
  if (first) {
    list.unshift(item);
    return true;
  }
  if (afterId != null) {
    const j = list.findIndex(x => x.id === afterId);
    if (j >= 0) {
      list.splice(j + 1, 0, item);
      return true;
    }
  }
  list.push(item);
  return true;
}

function applyOne(d, op) {
  switch (op.type) {
    case 'stop.update': {
      const t = findTrack(d, op.day, op.track);
      const s = t && t.stops.find(x => x.id === op.stopId);
      if (!s) return false;
      Object.assign(s, pick(op.patch, STOP_FIELDS));
      return true;
    }
    case 'stop.add': {
      const t = findTrack(d, op.day, op.track);
      if (!t) return false;
      return insertAt(t.stops, op.stop, op.after, op.first);
    }
    case 'stop.delete': {
      const t = findTrack(d, op.day, op.track);
      if (!t) return true;
      const i = t.stops.findIndex(x => x.id === op.stopId);
      if (i >= 0) t.stops.splice(i, 1);
      return true;
    }
    case 'stop.move': {
      const t = findTrack(d, op.day, op.track);
      return !!t && moveAfter(t.stops, op.stopId, op.after);
    }
    case 'day.update': {
      const day = findDay(d, op.day);
      if (!day) return false;
      Object.assign(day, pick(op.patch, DAY_FIELDS));
      return true;
    }
    case 'track.update': {
      const t = findTrack(d, op.day, op.track);
      if (!t) return false;
      Object.assign(t, pick(op.patch, TRACK_FIELDS));
      return true;
    }
    case 'check.add':
      d.checklist = d.checklist || [];
      return insertAt(d.checklist, op.item, op.after, op.first);
    case 'check.update': {
      const it = (d.checklist || []).find(x => x.id === op.id);
      if (!it) return false;
      Object.assign(it, pick(op.patch, CHECK_FIELDS));
      return true;
    }
    case 'check.delete': {
      const list = d.checklist || [];
      const i = list.findIndex(x => x.id === op.id);
      if (i >= 0) list.splice(i, 1);
      return true;
    }
    case 'info.add':
      d.info = d.info || [];
      return insertAt(d.info, op.section, op.after, op.first);
    case 'info.update': {
      const it = (d.info || []).find(x => x.id === op.id);
      if (!it) return false;
      Object.assign(it, pick(op.patch, INFO_FIELDS));
      return true;
    }
    case 'info.delete': {
      const list = d.info || [];
      const i = list.findIndex(x => x.id === op.id);
      if (i >= 0) list.splice(i, 1);
      return true;
    }
    case 'info.move':
      return moveAfter(d.info || [], op.id, op.after);
    case 'trip.update':
      d.trip = Object.assign(d.trip || {}, pick(op.patch, TRIP_FIELDS));
      return true;
    default:
      return false;
  }
}

export function applyOps(data, ops) {
  const d = structuredClone(data);
  const rejected = [];
  for (const op of ops || []) {
    let ok = false;
    try {
      ok = applyOne(d, op);
    } catch (e) {
      ok = false;
    }
    if (!ok) rejected.push(op);
  }
  return { data: d, rejected };
}

function dayLabel(d, dayId) {
  const i = (d.days || []).findIndex(x => x.id === dayId);
  return i >= 0 ? `Day${i + 1}` : dayId;
}

function stopName(d, op) {
  if (op.stop) return op.stop.name;
  const t = findTrack(d, op.day, op.track);
  const s = t && t.stops.find(x => x.id === op.stopId);
  return (op.patch && op.patch.name) || (s && s.name) || '장소';
}

export function describeOp(op, d) {
  switch (op.type) {
    case 'stop.update': return `${dayLabel(d, op.day)} ${stopName(d, op)} 수정`;
    case 'stop.add': return `${dayLabel(d, op.day)} ${stopName(d, op)} 추가`;
    case 'stop.delete': return `${dayLabel(d, op.day)} ${stopName(d, op)} 삭제`;
    case 'stop.move': return `${dayLabel(d, op.day)} ${stopName(d, op)} 순서 변경`;
    case 'day.update': return `${dayLabel(d, op.day)} 정보 수정`;
    case 'track.update': return `${dayLabel(d, op.day)} 일정 메모 수정`;
    case 'check.add': return `예약 항목 추가: ${op.item && op.item.title}`;
    case 'check.update': {
      const it = (d.checklist || []).find(x => x.id === op.id);
      const title = (it && it.title) || '항목';
      if (op.patch && 'done' in op.patch && Object.keys(op.patch).length <= 3) return `${title} ${op.patch.done ? '완료' : '완료 취소'}`;
      return `예약 항목 수정: ${title}`;
    }
    case 'check.delete': return '예약 항목 삭제';
    case 'info.add': return `정보 추가: ${op.section && op.section.title}`;
    case 'info.update': return '정보 수정';
    case 'info.delete': return '정보 삭제';
    case 'info.move': return '정보 순서 변경';
    case 'trip.update': return '여행 정보 수정';
    default: return op.type;
  }
}

export function describeOps(ops, d) {
  if (!ops.length) return '수정';
  const first = describeOp(ops[0], d);
  return ops.length > 1 ? `${first} 외 ${ops.length - 1}건` : first;
}
