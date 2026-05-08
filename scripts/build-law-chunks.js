/**
 * build-law-chunks.js — 법령 TXT → law-chunks.json 변환
 * 실행: node scripts/build-law-chunks.js
 */

const fs   = require('fs');
const path = require('path');

const LAW_DIR  = path.join(__dirname, '..', 'law');
const OUT_DIR  = path.join(__dirname, '..', 'www', 'data');
const OUT_FILE = path.join(OUT_DIR, 'law-chunks.json');

// ── 카테고리 키워드 매핑 ──────────────────────────────────────────────
const CATEGORY_KEYWORDS = {
  general:      ['사업주', '경영책임자', '안전보건', '산업재해', '위험성평가', '안전관리', '보건관리', '작업중지', '안전보건관리체계'],
  construction: ['건설', '굴착', '비계', '거푸집', '흙막이', '터널', '교량', '철골', '콘크리트', '크레인', '리프트', '고소작업', '가설', '동바리'],
  manufacturing:['기계', '기구', '설비', '방호장치', '프레스', '선반', '컨베이어', '로봇', '협착', '끼임', '절단', '제조', '롤러기', '원심기'],
  chemical:     ['화학물질', '유해물질', '위험물', '폭발', '발화', '인화', '누출', '독성', 'MSDS', '물질안전보건자료', '가스', '증기', '분진', '허가대상', '금지물질'],
  electric:     ['전기', '감전', '전류', '절연', '접지', '누전', '배선', '충전부', '변전', '아크', '전로', '전압', '전선', '전격'],
  fall:         ['추락', '낙하', '안전난간', '개구부', '작업발판', '안전대', '안전망', '방호선반', '고소작업', '사다리', '비계', '가설구조물', '작업대']
};

// ── 카테고리 태깅 최소 매칭 수 ───────────────────────────────────────
const CAT_MIN_MATCH = {
  general: 2, construction: 1, manufacturing: 1,
  chemical: 1, electric: 1, fall: 1
};

// ── 불용어 (TF-IDF 키워드 추출 시 제외) ──────────────────────────────
const STOPWORDS = new Set([
  '및', '등', '의', '을', '를', '이', '가', '은', '는', '에', '에서', '으로', '로',
  '하여', '하고', '하는', '하여야', '하지', '않은', '않는', '않고', '아니',
  '다음', '각', '호', '항', '조', '경우', '때', '위하여', '위한', '관한', '따른',
  '제1항', '제2항', '제3항', '제1호', '제2호', '제3호', '같은', '해당', '관련',
  '사항', '규정', '대통령령', '고용노동부령', '고용노동부', '법제처', '국가법령정보센터',
  '이하', '이상', '미만', '초과', '이내', '이상이고', '이상인', '이하인',
  '한다', '한다다', '있다', '있는', '있어', '없는', '없다', '것', '수', '때',
  '또는', '그', '그의', '그에', '그가', '이를', '그를'
]);

// ── 법령 파일 정보 ────────────────────────────────────────────────────
function findLawFiles() {
  const files = fs.readdirSync(LAW_DIR).filter(f => f.endsWith('.txt'));
  const result = { osha: null, serious: null };

  for (const f of files) {
    if (f.includes('산업안전보건법')) result.osha = f;
    if (f.includes('중대재해'))       result.serious = f;
  }
  return result;
}

// ── 헤더/목차 줄 필터링 ──────────────────────────────────────────────
function cleanText(text) {
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return false;
      // 법제처 헤더 제거
      if (t.includes('법제처') && t.includes('국가법령정보센터')) return false;
      // 페이지 번호만 있는 줄 제거
      if (/^\d+$/.test(t)) return false;
      return true;
    })
    .join('\n');
}

// ── 조항 단위로 분할 ─────────────────────────────────────────────────
// 줄 첫 부분이 "제N조(제목)" 으로 시작하는 줄을 기준으로 분할
function splitArticles(text) {
  const lines = text.split('\n');

  // 조항 헤더: 줄 시작이 제N조( 패턴 (들여쓰기 허용)
  const headerRe = /^(\s*)(제\d+조(?:의\d+)?)(\(([^)]{1,40})\))?(\s|$)/;

  const articles   = [];
  let currentNo    = null;
  let currentTitle = '';
  let currentLines = [];

  const flush = () => {
    if (!currentNo || currentLines.length === 0) return;
    const body = currentLines.join('\n').trim();
    // 목차 항목 제외: 내용이 너무 짧거나 다음 조항 번호만 있는 경우
    if (body.length < 30) return;
    // 본문 없이 헤더만 있는 TOC 항목 제외
    const contentLines = currentLines.filter(l => l.trim() && !l.trim().match(/^제\d+조/));
    if (contentLines.length < 2) return;
    articles.push({ articleNo: currentNo, articleTitle: currentTitle, full_text: body });
  };

  for (const line of lines) {
    const m = line.match(headerRe);
    if (m && !line.trim().startsWith('제1조') === false || m) {
      // 새 조항 시작
      if (m) {
        flush();
        currentNo    = m[2];
        currentTitle = m[4] || '';
        currentLines = [line.trim()];
        continue;
      }
    }
    if (currentNo) currentLines.push(line);
  }
  flush();

  return articles;
}

// ── 키워드 추출 (빈도 기반) ──────────────────────────────────────────
function extractKeywords(text, topN = 15) {
  const words = text
    .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w));

  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

// ── 카테고리 자동 태깅 ──────────────────────────────────────────────
function tagCategories(text) {
  const categories = [];
  const lowerText = text;

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matched = keywords.filter(kw => lowerText.includes(kw));
    if (matched.length >= CAT_MIN_MATCH[cat]) {
      categories.push(cat);
    }
  }

  // 어느 카테고리도 해당 없으면 general
  if (categories.length === 0) categories.push('general');
  return categories;
}

// ── 단일 법령 처리 ──────────────────────────────────────────────────
function processLaw(filename, lawName, statuteNo) {
  const filePath = path.join(LAW_DIR, filename);
  console.log(`\n📖 처리 중: ${lawName}`);
  console.log(`   파일: ${filename}`);

  const rawText  = fs.readFileSync(filePath, 'utf8');
  const cleaned  = cleanText(rawText);
  const articles = splitArticles(cleaned);

  console.log(`   조항 수: ${articles.length}개`);

  const chunks = articles.map(({ articleNo, articleTitle, full_text }) => ({
    law:           lawName,
    statute_no:    statuteNo,
    article_no:    articleNo,
    article_title: articleTitle,
    full_text:     full_text.slice(0, 500), // 최대 500자
    keywords:      extractKeywords(full_text),
    categories:    tagCategories(full_text)
  }));

  return chunks;
}

// ── 메인 ────────────────────────────────────────────────────────────
function main() {
  const files = findLawFiles();

  if (!files.osha && !files.serious) {
    console.error('❌ law/ 폴더에 TXT 파일이 없습니다. extract-pdf.js를 먼저 실행하세요.');
    process.exit(1);
  }

  const allChunks = [];

  if (files.osha) {
    const chunks = processLaw(
      files.osha,
      '산업안전보건법 시행령',
      '대통령령 제36220호'
    );
    allChunks.push(...chunks);
  }

  if (files.serious) {
    const chunks = processLaw(
      files.serious,
      '중대재해처벌법 시행령',
      '대통령령 제35805호'
    );
    allChunks.push(...chunks);
  }

  // 출력 디렉터리 생성
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const output = {
    version:     new Date().toISOString().slice(0, 10),
    total_chunks: allChunks.length,
    laws: [...new Set(allChunks.map(c => c.law))],
    chunks: allChunks
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n✅ 완료!`);
  console.log(`   총 청크: ${allChunks.length}개`);
  console.log(`   출력   : ${OUT_FILE}`);
  console.log(`   파일크기: ${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB`);

  // 카테고리별 통계
  const catStats = {};
  for (const chunk of allChunks) {
    for (const cat of chunk.categories) {
      catStats[cat] = (catStats[cat] || 0) + 1;
    }
  }
  console.log('\n📊 카테고리별 조항 수:');
  for (const [cat, count] of Object.entries(catStats)) {
    console.log(`   ${cat.padEnd(15)}: ${count}개`);
  }
}

main();
