/**
 * extract-pdf.js — PDF → TXT 추출
 * 실행: node scripts/extract-pdf.js
 */

const fs   = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

const LAW_DIR = path.join(__dirname, '..', 'law');
const OUT_DIR = path.join(__dirname, '..', 'law');

async function extractPdf(filename) {
  const filePath = path.join(LAW_DIR, filename);
  console.log(`\n📄 추출 중: ${filename}`);

  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);

  const outName = filename.replace('.pdf', '.txt');
  const outPath = path.join(OUT_DIR, outName);
  fs.writeFileSync(outPath, data.text, 'utf8');

  console.log(`   페이지 수: ${data.numpages}`);
  console.log(`   글자 수 : ${data.text.length.toLocaleString()}`);
  console.log(`   저장됨  : ${outPath}`);
  return outPath;
}

async function main() {
  const files = fs.readdirSync(LAW_DIR).filter(f => f.endsWith('.pdf'));
  if (files.length === 0) {
    console.error('❌ law/ 폴더에 PDF 파일이 없습니다.');
    process.exit(1);
  }

  console.log(`\n=== PDF 텍스트 추출 시작 (${files.length}개 파일) ===`);
  for (const file of files) {
    await extractPdf(file);
  }
  console.log('\n✅ 추출 완료\n');
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
