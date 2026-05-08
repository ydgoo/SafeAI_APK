/**
 * law-retriever.js — BM25 기반 법령 조항 검색 엔진
 *
 * 사용법:
 *   await LawRetriever.load();
 *   const results = LawRetriever.search(queryText, { category: 'fall', topK: 5 });
 */

const LawRetriever = (() => {

  // ── BM25 파라미터 ────────────────────────────────────────────────────
  const K1 = 1.5;
  const B  = 0.75;

  // ── 상태 ─────────────────────────────────────────────────────────────
  let _chunks      = [];
  let _idf         = {};
  let _avgdl       = 0;
  let _loaded      = false;
  let _loadPromise = null;

  // ── 불용어 ───────────────────────────────────────────────────────────
  const STOPWORDS = new Set([
    '및', '등', '의', '을', '를', '이', '가', '은', '는', '에', '에서',
    '으로', '로', '하여', '하고', '하는', '하여야', '하지', '않은', '않는',
    '않고', '아니', '다음', '각', '호', '항', '조', '경우', '때', '위하여',
    '위한', '관한', '따른', '사항', '규정', '이하', '이상', '미만', '초과',
    '한다', '있다', '있는', '없는', '없다', '것', '수', '또는', '그', '이를',
    '해당', '관련', '같은', '제1항', '제2항', '제3항', '제1호', '제2호',
    '대통령령', '고용노동부령', '법제처', '국가법령정보센터'
  ]);

  // ── 한국어 토크나이저 ────────────────────────────────────────────────
  function _tokenize(text) {
    return text
      .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length >= 2 && !STOPWORDS.has(w));
  }

  // ── IDF 색인 구축 ────────────────────────────────────────────────────
  function _buildIndex(chunks) {
    const N  = chunks.length;
    const df = {};

    for (const chunk of chunks) {
      const terms = new Set(_tokenize(chunk.full_text + ' ' + chunk.article_title));
      for (const term of terms) {
        df[term] = (df[term] || 0) + 1;
      }
    }

    const idf = {};
    for (const [term, freq] of Object.entries(df)) {
      idf[term] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
    }

    const totalLen = chunks.reduce((sum, c) => {
      return sum + _tokenize(c.full_text).length;
    }, 0);

    return { idf, avgdl: totalLen / N };
  }

  // ── BM25 점수 계산 ───────────────────────────────────────────────────
  function _bm25Score(queryTerms, docText, docLen) {
    const tokens = _tokenize(docText);
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

    let score = 0;
    for (const qt of queryTerms) {
      const idfVal = _idf[qt];
      if (!idfVal) continue;
      const tfVal  = tf[qt] || 0;
      if (!tfVal) continue;
      score += idfVal * (tfVal * (K1 + 1))
             / (tfVal + K1 * (1 - B + B * docLen / _avgdl));
    }
    return score;
  }

  // ── 법령 데이터 로드 ─────────────────────────────────────────────────
  async function load() {
    if (_loaded) return true;
    if (_loadPromise) return _loadPromise;

    _loadPromise = fetch('data/law-chunks.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        _chunks = data.chunks || [];
        const idx = _buildIndex(_chunks);
        _idf    = idx.idf;
        _avgdl  = idx.avgdl;
        _loaded = true;
        console.log(`[LawRetriever] ${_chunks.length}개 청크 로드 완료`);
        return true;
      })
      .catch(err => {
        console.warn('[LawRetriever] 로드 실패:', err.message);
        _loadPromise = null;
        return false;
      });

    return _loadPromise;
  }

  // ── 검색 ─────────────────────────────────────────────────────────────
  /**
   * @param {string} queryText   - 검색 쿼리 (1차 분석 결과 텍스트)
   * @param {object} opts
   *   category {string}  - 점검 카테고리 (null이면 전체)
   *   topK     {number}  - 반환할 최대 조항 수 (기본 5)
   *   minScore {number}  - 최소 점수 임계값 (기본 0.3)
   *   laws     {Array}   - 특정 법령만 포함 (null이면 전체)
   * @returns {Array} 점수순 정렬된 청크 배열
   */
  function search(queryText, { category = null, topK = 5, minScore = 0.3, laws = null } = {}) {
    if (!_loaded || !queryText) return [];

    const queryTerms = _tokenize(queryText);
    if (queryTerms.length === 0) return [];

    // 카테고리 사전 필터링
    let candidates = _chunks;
    if (category && category !== 'general') {
      candidates = _chunks.filter(c =>
        c.categories.includes(category) || c.categories.includes('general')
      );
    }

    // 법령 필터
    if (laws && laws.length > 0) {
      candidates = candidates.filter(c =>
        laws.some(l => c.law.includes(l))
      );
    }

    // BM25 점수 계산
    const scored = candidates.map(chunk => {
      const searchText = chunk.full_text + ' ' + chunk.article_title + ' ' + chunk.keywords.join(' ');
      const docLen     = _tokenize(chunk.full_text).length;
      const score      = _bm25Score(queryTerms, searchText, docLen);
      return { ...chunk, _score: score };
    });

    // 정렬 → 필터 → Top-K
    return scored
      .filter(c => c._score >= minScore)
      .sort((a, b) => b._score - a._score)
      .slice(0, topK);
  }

  // ── 법령별 분리 검색 ─────────────────────────────────────────────────
  /**
   * 산업안전보건법 / 중대재해처벌법 각각 Top-K 반환
   */
  function searchByLaw(queryText, { category = null, topKEach = 3 } = {}) {
    if (!_loaded) return { osha: [], serious: [] };
    return {
      osha:    search(queryText, { category, topK: topKEach, laws: ['산업안전보건법'] }),
      serious: search(queryText, { category, topK: topKEach, laws: ['중대재해처벌법'] })
    };
  }

  // ── 로드 상태 확인 ───────────────────────────────────────────────────
  function isLoaded() { return _loaded; }

  return { load, search, searchByLaw, isLoaded };
})();

window.LawRetriever = LawRetriever;
